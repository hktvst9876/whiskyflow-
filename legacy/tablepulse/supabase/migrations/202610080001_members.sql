-- Customer identities are private; public membership numbers are lookup references.
alter table public.customers add column auth_user_id uuid generated always as ((data->>'authUserId')::uuid) stored references auth.users(id);
alter table public.customers add column membership_id text generated always as (data->>'membershipId') stored;
create unique index unique_member_identity on public.customers(venue_id,auth_user_id) where auth_user_id is not null;
create unique index unique_member_number on public.customers(venue_id,membership_id) where membership_id is not null;
alter table public.customers add constraint membership_format check(membership_id is null or membership_id ~ '^TP-[A-HJ-NP-Z2-9]{10}$');

create table public.member_checkins (
 id uuid primary key, venue_id uuid not null references public.venues(id),
 customer_id uuid not null references public.customers(id), session_id uuid not null,
 data jsonb not null, foreign key(venue_id,session_id) references public.table_sessions(venue_id,id)
);
alter table public.member_checkins enable row level security;
revoke all on public.member_checkins from public,anon,authenticated;
grant all on public.member_checkins to service_role;

-- Durable fixed-window budgets limit SMS pumping across server instances.
create table public.member_auth_limits (
 venue_id uuid not null references public.venues(id), scope text not null, bucket bigint not null,
 attempts integer not null, touched_at timestamptz not null default now(), primary key(venue_id,scope,bucket)
);
alter table public.member_auth_limits enable row level security;
revoke all on public.member_auth_limits from public,anon,authenticated;
grant all on public.member_auth_limits to service_role;
create function public.tablepulse_auth_allow(p_venue uuid,p_scope text,p_window integer,p_limit integer)
 returns boolean language plpgsql security definer set search_path=public as $$
declare used integer; slot bigint;
begin
 if p_window<60 or p_limit<1 or length(p_scope)>160 then raise exception 'Invalid rate budget'; end if;
 slot:=floor(extract(epoch from now())/p_window);
 insert into member_auth_limits(venue_id,scope,bucket,attempts) values(p_venue,p_scope,slot,1)
 on conflict(venue_id,scope,bucket) do update set attempts=member_auth_limits.attempts+1,touched_at=now()
 returning attempts into used;
 delete from member_auth_limits where venue_id=p_venue and touched_at<now()-interval '2 days';
 return used<=p_limit;
end $$;
revoke all on function public.tablepulse_auth_allow(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.tablepulse_auth_allow(uuid,text,integer,integer) to service_role;

-- Extend the repository without breaking already-deployed V1 migrations.
alter function public.tablepulse_snapshot(uuid) rename to tablepulse_snapshot_v1;
create function public.tablepulse_snapshot(p_venue uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select public.tablepulse_snapshot_v1(p_venue) || jsonb_build_object('memberCheckins',coalesce((select jsonb_agg(data order by id) from public.member_checkins where venue_id=p_venue),'[]'::jsonb));
$$;
alter function public.tablepulse_commit(uuid,bigint,jsonb) rename to tablepulse_commit_v1;
create function public.tablepulse_commit(p_venue uuid,p_revision bigint,p_state jsonb) returns bigint language plpgsql security definer set search_path=public as $$
declare x jsonb; old_data jsonb; next_revision bigint;
begin
 perform 1 from venues where id=p_venue for update;
 for x in select value from jsonb_array_elements(p_state->'customers') loop
  select data into old_data from customers where id=(x->>'id')::uuid and venue_id=p_venue;
  if old_data->>'authUserId' is not null and x->>'authUserId' is distinct from old_data->>'authUserId' then raise exception 'Member identity is immutable'; end if;
  if old_data->>'membershipId' is not null and x->>'membershipId' is distinct from old_data->>'membershipId' then raise exception 'Membership number is immutable'; end if;
 end loop;
 for x in select value from jsonb_array_elements(p_state->'sessions') loop
  select data into old_data from table_sessions where id=(x->>'id')::uuid and venue_id=p_venue;
  if old_data->>'rewardAttemptedAt' is not null and x->>'rewardAttemptedAt' is distinct from old_data->>'rewardAttemptedAt' then raise exception 'Cannot reset reward opportunity'; end if;
  if coalesce((old_data->>'customerVerified')::boolean,false) and x->>'customerId' is distinct from old_data->>'customerId' then raise exception 'Cannot replace verified visit recipient'; end if;
 end loop;
 if exists (
  select s->>'customerId' from jsonb_array_elements(p_state->'instances') i
  join jsonb_array_elements(p_state->'sessions') s on s->>'id'=i->>'sessionId'
  where i->>'status'='active' and (i->>'expiresAt')::timestamptz>now() and s->>'customerId' is not null
  group by s->>'customerId' having count(*)>1
 ) then raise exception 'Customer already has an active reward'; end if;
 next_revision:=public.tablepulse_commit_v1(p_venue,p_revision,p_state);
 for x in select value from jsonb_array_elements(p_state->'customers') loop
  if x->>'consentVersion' is not null then
   update customer_consents set purpose='history_based_personalisation',version=x->>'consentVersion' where customer_id=(x->>'id')::uuid and venue_id=p_venue;
  end if;
 end loop;
 for x in select value from jsonb_array_elements(coalesce(p_state->'memberCheckins','[]'::jsonb)) loop
  select data into old_data from member_checkins where id=(x->>'id')::uuid;
  if old_data is not null and (
   old_data->>'customerId' is distinct from x->>'customerId' or old_data->>'sessionId' is distinct from x->>'sessionId' or
   old_data->>'codeHash' is distinct from x->>'codeHash' or old_data->>'expiresAt' is distinct from x->>'expiresAt' or
   (old_data->>'consumedAt' is not null and old_data->>'consumedAt' is distinct from x->>'consumedAt')
  ) then raise exception 'Check-in identity and token are immutable'; end if;
  if not exists(select 1 from customers where id=(x->>'customerId')::uuid and venue_id=p_venue and auth_user_id is not null) then raise exception 'Check-in requires member'; end if;
  insert into member_checkins(id,venue_id,customer_id,session_id,data) values((x->>'id')::uuid,p_venue,(x->>'customerId')::uuid,(x->>'sessionId')::uuid,x)
   on conflict(id) do update set data=excluded.data;
 end loop;
 delete from member_checkins where venue_id=p_venue and (data->>'expiresAt')::timestamptz<now()-interval '1 day';
 return next_revision;
end $$;
revoke all on function public.tablepulse_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.tablepulse_commit(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.tablepulse_snapshot(uuid) to service_role;
grant execute on function public.tablepulse_commit(uuid,bigint,jsonb) to service_role;
