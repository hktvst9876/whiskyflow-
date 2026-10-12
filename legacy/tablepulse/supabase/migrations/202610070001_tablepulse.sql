-- TablePulse V1: normalized relational records, private payloads and atomic commits.
-- gen_random_uuid(), md5() and hashtextextended() are built into Postgres 17.
create type public.venue_role as enum ('platform_admin','manager','staff');
create type public.menu_category as enum ('food','beer','wine','cocktail','zero_alcohol','snack');
create table public.venues (
 id uuid primary key default gen_random_uuid(), name text not null, location text not null,
 settings jsonb not null default '{"minProfit":2.5,"minScore":65,"allocationProbability":0.78,"controlPercent":15,"paused":false}',
 revision bigint not null default 0, created_at timestamptz not null default now()
);
create table public.venue_users (
 venue_id uuid not null references public.venues(id), user_id uuid not null references auth.users(id) on delete cascade,
 role public.venue_role not null, primary key(venue_id,user_id)
);
create table public.customers (
 id uuid primary key, venue_id uuid not null references public.venues(id), data jsonb not null,
 opted_in boolean generated always as ((data->>'optedIn')::boolean) stored
);
create table public.customer_consents (
 customer_id uuid primary key references public.customers(id), venue_id uuid not null references public.venues(id),
 granted boolean not null, purpose text not null default 'optional_venue_rewards', version text not null default 'v1',
 granted_at timestamptz, revoked_at timestamptz
);
create table public.tables (
 id uuid primary key, venue_id uuid not null references public.venues(id), data jsonb not null,
 name text generated always as (data->>'name') stored, unique(venue_id,name), unique(venue_id,id)
);
create table public.table_sessions (
 id uuid primary key, venue_id uuid not null references public.venues(id), table_id uuid not null,
 customer_id uuid references public.customers(id), data jsonb not null,
 foreign key(venue_id,table_id) references public.tables(venue_id,id), unique(venue_id,id)
);
create unique index one_open_session_per_table on public.table_sessions(table_id) where data->>'closedAt' is null;
create table public.menu_items (
 id uuid primary key, venue_id uuid not null references public.venues(id), data jsonb not null,
 name text generated always as (data->>'name') stored,
 category text generated always as (data->>'category') stored check(category in ('food','beer','wine','cocktail','zero_alcohol','snack')),
 selling_price numeric(12,2) generated always as ((data->>'price')::numeric) stored check(selling_price >= 0),
 alcohol boolean generated always as ((data->>'alcohol')::boolean) stored,
 eligible_age integer generated always as ((data->>'age')::integer) stored,
 promotion_eligible boolean generated always as ((data->>'promotionEligible')::boolean) stored,
 unique(venue_id,id), check(not alcohol or eligible_age >= 18)
);
create table public.menu_item_costs (
 menu_item_id uuid primary key references public.menu_items(id), venue_id uuid not null references public.venues(id),
 item_cost numeric(12,2) not null check(item_cost >= 0), updated_at timestamptz not null default now()
);
create table public.inventory_availability (
 menu_item_id uuid primary key references public.menu_items(id), venue_id uuid not null references public.venues(id),
 units integer not null check(units>=0), in_stock boolean generated always as (units>0) stored,
 updated_at timestamptz not null default now()
);
create table public.orders (
 id uuid primary key, venue_id uuid not null references public.venues(id), session_id uuid not null,
 external_id text not null, data jsonb not null,
 foreign key(venue_id,session_id) references public.table_sessions(venue_id,id), unique(venue_id,external_id), unique(venue_id,id)
);
create table public.order_items (
 order_id uuid not null references public.orders(id), position integer not null, venue_id uuid not null references public.venues(id),
 menu_item_id uuid not null references public.menu_items(id), quantity integer not null check(quantity>0), unit_price numeric(12,2) not null check(unit_price>=0),
 primary key(order_id,position)
);
create table public.offers (
 id uuid primary key, venue_id uuid not null references public.venues(id), menu_item_id uuid not null, data jsonb not null,
 name text generated always as (data->>'name') stored,
 daily_cap integer generated always as ((data->>'dailyCap')::integer) stored check(daily_cap>=0),
 offer_price numeric(12,2) generated always as ((data->>'price')::numeric) stored check(offer_price>=0),
 foreign key(venue_id,menu_item_id) references public.menu_items(venue_id,id), unique(venue_id,id)
);
create table public.offer_rules (
 offer_id uuid primary key references public.offers(id), venue_id uuid not null references public.venues(id),
 rule_type text not null, constraints jsonb not null, weights jsonb not null default '{"relevance":30,"profit":25,"inventory":15,"frequency":10,"priority":10,"random":10}'
);
create table public.offer_eligibility_logs (
 id uuid primary key, venue_id uuid not null references public.venues(id), session_id uuid not null references public.table_sessions(id),
 outcome text not null check(outcome in ('shown','withheld','control')), reasons jsonb not null, data jsonb not null, created_at timestamptz not null
);
create table public.offer_instances (
 id uuid primary key, venue_id uuid not null references public.venues(id), session_id uuid not null, offer_id uuid not null,
 data jsonb not null, status text not null check(status in ('active','redeemed','cancelled')), created_at timestamptz not null, expires_at timestamptz not null,
 foreign key(venue_id,session_id) references public.table_sessions(venue_id,id), foreign key(venue_id,offer_id) references public.offers(venue_id,id),
 unique(session_id), unique(venue_id,id), check(expires_at>created_at)
);
create table public.offer_redemptions (
 id uuid primary key, venue_id uuid not null references public.venues(id), instance_id uuid not null unique, session_id uuid not null,
 revenue numeric(12,2) not null, estimated_profit numeric(12,2) not null, discount_cost numeric(12,2) not null,
 data jsonb not null, created_at timestamptz not null,
 foreign key(venue_id,instance_id) references public.offer_instances(venue_id,id), foreign key(venue_id,session_id) references public.table_sessions(venue_id,id)
);
create table public.customer_reward_history (
 id uuid primary key, venue_id uuid not null references public.venues(id), customer_id uuid not null references public.customers(id), offer_id uuid not null references public.offers(id),
 created_at timestamptz not null, redeemed_at timestamptz, data jsonb not null
);
create index customer_frequency on public.customer_reward_history(customer_id,redeemed_at desc);
create index repeat_promotion on public.customer_reward_history(customer_id,offer_id,created_at desc);
create index daily_allocation on public.offer_instances(venue_id,offer_id,created_at);
create index order_session on public.orders(session_id);
create table public.audit_logs (
 id uuid primary key, venue_id uuid not null references public.venues(id), actor text not null, action text not null,
 detail text not null, data jsonb not null, created_at timestamptz not null
);
create view public.menu_margins with (security_invoker=true) as
 select m.id,m.venue_id,m.name,m.category,m.selling_price,c.item_cost,m.selling_price-c.item_cost as gross_profit,
 round(100*(m.selling_price-c.item_cost)/nullif(m.selling_price,0),2) as gross_margin_percent,
 i.in_stock,i.units,m.alcohol,m.eligible_age,m.promotion_eligible
 from public.menu_items m join public.menu_item_costs c on c.menu_item_id=m.id join public.inventory_availability i on i.menu_item_id=m.id;

-- No client can grant itself a role or change commercial records.
create function public.venue_member(v uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.venue_users where venue_id=v and user_id=auth.uid());
$$;
create function public.venue_manager(v uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.venue_users where venue_id=v and user_id=auth.uid() and role in ('platform_admin','manager'));
$$;
alter table public.venues enable row level security;
create policy read_venue on public.venues for select to authenticated using(public.venue_member(id));
alter table public.venue_users enable row level security;
create policy read_own_membership on public.venue_users for select to authenticated using(user_id=auth.uid());
do $$ declare t text; begin
 foreach t in array array['tables','table_sessions','menu_items','menu_item_costs','inventory_availability','orders','order_items','offers','offer_rules','offer_instances','offer_redemptions','offer_eligibility_logs','audit_logs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy read_member on public.%I for select to authenticated using(public.venue_member(venue_id))',t);
 end loop;
 foreach t in array array['customers','customer_consents','customer_reward_history'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy read_manager on public.%I for select to authenticated using(public.venue_manager(venue_id))',t);
 end loop;
end $$;
grant select on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
revoke insert,update,delete on all tables in schema public from authenticated;

create function public.tablepulse_snapshot(p_venue uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('revision',v.revision,'venue',jsonb_build_object('id',v.id,'name',v.name,'location',v.location),'settings',v.settings,
 'menu',coalesce((select jsonb_agg(m.data || jsonb_build_object('cost',c.item_cost,'stock',i.units) order by m.id) from menu_items m join menu_item_costs c on c.menu_item_id=m.id join inventory_availability i on i.menu_item_id=m.id where m.venue_id=v.id),'[]'::jsonb),
 'tables',coalesce((select jsonb_agg(data order by id) from tables where venue_id=v.id),'[]'::jsonb),
 'sessions',coalesce((select jsonb_agg(data order by data->>'startedAt') from table_sessions where venue_id=v.id),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(data order by data->>'createdAt') from orders where venue_id=v.id),'[]'::jsonb),
 'offers',coalesce((select jsonb_agg(data order by id) from offers where venue_id=v.id),'[]'::jsonb),
 'instances',coalesce((select jsonb_agg(data order by created_at) from offer_instances where venue_id=v.id),'[]'::jsonb),
 'decisions',coalesce((select jsonb_agg(data order by created_at) from offer_eligibility_logs where venue_id=v.id),'[]'::jsonb),
 'customers',coalesce((select jsonb_agg(data order by id) from customers where venue_id=v.id),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(data order by created_at) from customer_reward_history where venue_id=v.id),'[]'::jsonb),
 'audits',coalesce((select jsonb_agg(data order by created_at) from audit_logs where venue_id=v.id),'[]'::jsonb),
 'redemptions',coalesce((select jsonb_agg(data order by created_at) from offer_redemptions where venue_id=v.id),'[]'::jsonb)) from venues v where v.id=p_venue;
$$;

-- This service-only RPC serializes a venue's decisions and persists the entire mutation
-- atomically in normalized tables. Revision conflicts are retried by the repository.
create function public.tablepulse_commit(p_venue uuid,p_revision bigint,p_state jsonb) returns bigint
 language plpgsql security definer set search_path=public as $$
declare current_revision bigint; x jsonb; y jsonb; sess jsonb; campaign jsonb; item jsonb; old_status text; customer uuid; pos integer; is_new boolean; actual_profit numeric;
begin
 select revision into current_revision from venues where id=p_venue for update;
 if not found then raise exception 'Venue not found'; end if;
 if current_revision<>p_revision then raise exception 'Concurrent venue update' using errcode='40001'; end if;
 if (p_state->'venue'->>'id')::uuid<>p_venue then raise exception 'Wrong venue'; end if;
 if (p_state->'settings'->>'minProfit')::numeric<0 or (p_state->'settings'->>'minScore')::numeric not between 0 and 100 then raise exception 'Invalid venue floors'; end if;

 -- Guard state transitions before writing any records.
 for x in select value from jsonb_array_elements(p_state->'instances') loop
  select status into old_status from offer_instances where id=(x->>'id')::uuid;
  is_new := not found;
  if not is_new and old_status in ('redeemed','cancelled') and x->>'status'<>old_status then raise exception 'Terminal reward cannot be reopened'; end if;
  if is_new or (old_status='active' and x->>'status'='redeemed') then
   select value into sess from jsonb_array_elements(p_state->'sessions') where value->>'id'=x->>'sessionId';
   select value into campaign from jsonb_array_elements(p_state->'offers') where value->>'id'=x->>'offerId';
   select value into item from jsonb_array_elements(p_state->'menu') where value->>'id'=campaign->>'itemId';
   customer := (sess->>'customerId')::uuid;
   if sess is null or campaign is null or item is null then raise exception 'Missing offer context'; end if;
   if customer is null or not coalesce((sess->>'customerVerified')::boolean,false) then raise exception 'Verified customer reference required'; end if;
   if sess->>'closedAt' is not null or (sess->>'blocked')::boolean or (p_state->'settings'->>'paused')::boolean then raise exception 'Table rewards blocked'; end if;
   if not (campaign->>'enabled')::boolean or not (item->>'promotionEligible')::boolean then raise exception 'Campaign unavailable'; end if;
   if (item->>'alcohol')::boolean and (not (sess->>'ageVerified')::boolean or (sess->>'intoxicated')::boolean) then raise exception 'Alcohol safety check failed'; end if;
   actual_profit:=((campaign->>'price')::numeric-(item->>'cost')::numeric)*(campaign->>'quantity')::integer;
   if actual_profit<=(p_state->'settings'->>'minProfit')::numeric then raise exception 'Incremental margin floor not met'; end if;
   if is_new and (item->>'stock')::integer<(campaign->>'quantity')::integer then raise exception 'Insufficient inventory'; end if;
   if not exists(select 1 from jsonb_array_elements(p_state->'orders') o where o->>'sessionId'=sess->>'id' and (o->>'organic')::boolean and not (o->>'discount')::boolean and not (o->>'voided')::boolean) then raise exception 'No organic qualifying order'; end if;
   if exists(select 1 from jsonb_array_elements(p_state->'orders') o where o->>'sessionId'=sess->>'id' and (o->>'discount')::boolean and not (o->>'voided')::boolean and o->>'externalId'<>'reward-'||(x->>'id')) then raise exception 'Cannot stack discounts'; end if;
   if exists(select 1 from jsonb_array_elements_text(x->'qualifyingOrderIds') q where not exists(select 1 from jsonb_array_elements(p_state->'orders') o where o->>'id'=q and not (o->>'voided')::boolean)) then raise exception 'Qualifying items missing'; end if;
   if customer is not null then
    perform pg_advisory_xact_lock(hashtextextended(customer::text,0));
    if exists(select 1 from customer_reward_history where customer_id=customer and redeemed_at>now()-interval '30 days') then raise exception '30-day customer reward cap'; end if;
   end if;
   if is_new then
    if (sess->>'control')::boolean then raise exception 'Control visits cannot receive offers'; end if;
    if exists(select 1 from offer_instances where session_id=(sess->>'id')::uuid) then raise exception 'One reward per visit'; end if;
    if (x->>'score')::numeric<=(p_state->'settings'->>'minScore')::numeric then raise exception 'Score threshold not met'; end if;
    if customer is not null and exists(select 1 from customer_reward_history where customer_id=customer and offer_id=(campaign->>'id')::uuid and created_at>now()-interval '60 days') then raise exception '60-day promotion repeat cap'; end if;
    if (select count(*) from jsonb_array_elements(p_state->'instances') a where a->>'offerId'=campaign->>'id' and ((a->>'createdAt')::timestamptz at time zone 'Asia/Singapore')::date=((x->>'createdAt')::timestamptz at time zone 'Asia/Singapore')::date)>(campaign->>'dailyCap')::integer then raise exception 'Daily campaign cap'; end if;
   elsif (x->>'expiresAt')::timestamptz<=now() then raise exception 'Reward expired';
   end if;
  end if;
 end loop;

 for x in select value from jsonb_array_elements(p_state->'customers') loop
  insert into customers(id,venue_id,data) values((x->>'id')::uuid,p_venue,x) on conflict(id) do update set data=excluded.data;
  insert into customer_consents(customer_id,venue_id,granted,granted_at,revoked_at) values((x->>'id')::uuid,p_venue,(x->>'optedIn')::boolean,case when (x->>'optedIn')::boolean then now() end,case when not (x->>'optedIn')::boolean then now() end)
   on conflict(customer_id) do update set granted=excluded.granted,granted_at=case when excluded.granted and not customer_consents.granted then now() else customer_consents.granted_at end,revoked_at=case when not excluded.granted and customer_consents.granted then now() else customer_consents.revoked_at end;
 end loop;
 for x in select value from jsonb_array_elements(p_state->'tables') loop
  insert into tables(id,venue_id,data) values((x->>'id')::uuid,p_venue,x) on conflict(id) do update set data=excluded.data;
 end loop;
 -- Closed sessions first, so a fresh visit may safely reuse the same physical table.
 for x in select value from jsonb_array_elements(p_state->'sessions') order by value->>'closedAt' nulls last loop
  if exists(select 1 from table_sessions where id=(x->>'id')::uuid and (data->>'offerReceived')::boolean and not (x->>'offerReceived')::boolean) then raise exception 'Cannot reset a visit reward'; end if;
  insert into table_sessions(id,venue_id,table_id,customer_id,data) values((x->>'id')::uuid,p_venue,(x->>'tableId')::uuid,(x->>'customerId')::uuid,x) on conflict(id) do update set customer_id=excluded.customer_id,data=excluded.data;
 end loop;
 for x in select value from jsonb_array_elements(p_state->'menu') loop
  insert into menu_items(id,venue_id,data) values((x->>'id')::uuid,p_venue,x) on conflict(id) do update set data=excluded.data;
  insert into menu_item_costs(menu_item_id,venue_id,item_cost) values((x->>'id')::uuid,p_venue,(x->>'cost')::numeric) on conflict(menu_item_id) do update set item_cost=excluded.item_cost,updated_at=now();
  insert into inventory_availability(menu_item_id,venue_id,units) values((x->>'id')::uuid,p_venue,(x->>'stock')::integer) on conflict(menu_item_id) do update set units=excluded.units,updated_at=now();
 end loop;
 for x in select value from jsonb_array_elements(p_state->'orders') loop
  insert into orders(id,venue_id,session_id,external_id,data) values((x->>'id')::uuid,p_venue,(x->>'sessionId')::uuid,x->>'externalId',x) on conflict(id) do update set data=excluded.data;
  pos:=0;
  for y in select value from jsonb_array_elements(x->'items') loop
   insert into order_items(order_id,position,venue_id,menu_item_id,quantity,unit_price) values((x->>'id')::uuid,pos,p_venue,(y->>'menuItemId')::uuid,(y->>'quantity')::integer,coalesce((y->>'unitPrice')::numeric,(select selling_price from menu_items where id=(y->>'menuItemId')::uuid))) on conflict(order_id,position) do nothing;
   pos:=pos+1;
  end loop;
 end loop;
 for x in select value from jsonb_array_elements(p_state->'offers') loop
  insert into offers(id,venue_id,menu_item_id,data) values((x->>'id')::uuid,p_venue,(x->>'itemId')::uuid,x) on conflict(id) do update set data=excluded.data;
  insert into offer_rules(offer_id,venue_id,rule_type,constraints) values((x->>'id')::uuid,p_venue,x->>'kind',jsonb_build_object('requiredItemIds',x->'requiredItemIds','duration',x->'duration','quantity',x->'quantity')) on conflict(offer_id) do update set constraints=excluded.constraints;
 end loop;
 for x in select value from jsonb_array_elements(p_state->'instances') loop
  insert into offer_instances(id,venue_id,session_id,offer_id,data,status,created_at,expires_at) values((x->>'id')::uuid,p_venue,(x->>'sessionId')::uuid,(x->>'offerId')::uuid,x,x->>'status',(x->>'createdAt')::timestamptz,(x->>'expiresAt')::timestamptz) on conflict(id) do update set status=excluded.status,data=excluded.data;
 end loop;
 for x in select value from jsonb_array_elements(p_state->'decisions') loop
  insert into offer_eligibility_logs values((x->>'id')::uuid,p_venue,(x->>'sessionId')::uuid,x->>'outcome',x->'reasons',x,(x->>'createdAt')::timestamptz) on conflict(id) do nothing;
 end loop;
 for x in select value from jsonb_array_elements(p_state->'redemptions') loop
  insert into offer_redemptions values((x->>'id')::uuid,p_venue,(x->>'instanceId')::uuid,(x->>'sessionId')::uuid,(x->>'revenue')::numeric,(x->>'profit')::numeric,(x->>'discount')::numeric,x,(x->>'createdAt')::timestamptz) on conflict(id) do nothing;
 end loop;
 for x in select value from jsonb_array_elements(p_state->'history') loop
  insert into customer_reward_history values(md5((x->>'customerId')||(x->>'offerId')||(x->>'createdAt'))::uuid,p_venue,(x->>'customerId')::uuid,(x->>'offerId')::uuid,(x->>'createdAt')::timestamptz,(x->>'redeemedAt')::timestamptz,x) on conflict(id) do update set redeemed_at=excluded.redeemed_at,data=excluded.data;
 end loop;
 for x in select value from jsonb_array_elements(p_state->'audits') loop
  insert into audit_logs values((x->>'id')::uuid,p_venue,x->>'actor',x->>'action',x->>'detail',x,(x->>'createdAt')::timestamptz) on conflict(id) do nothing;
 end loop;
 update venues set settings=p_state->'settings',revision=revision+1 where id=p_venue;
 return current_revision+1;
end $$;
revoke all on function public.tablepulse_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.tablepulse_commit(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.tablepulse_snapshot(uuid) to service_role;
grant execute on function public.tablepulse_commit(uuid,bigint,jsonb) to service_role;
-- Public screens use a server-verified table token, never anonymous table SELECT.
alter publication supabase_realtime add table public.offer_instances, public.table_sessions, public.inventory_availability;
