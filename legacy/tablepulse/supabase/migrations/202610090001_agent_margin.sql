-- Add a venue-controlled percentage margin floor and enforce it transactionally.
alter table public.venues alter column settings set default
 '{"minProfit":2.5,"minMarginPercent":30,"minScore":65,"allocationProbability":0.78,"controlPercent":15,"paused":false}'::jsonb;
update public.venues
 set settings=jsonb_set(settings,'{minMarginPercent}','30'::jsonb,true)
 where settings->'minMarginPercent' is null;

alter function public.tablepulse_commit(uuid,bigint,jsonb) rename to tablepulse_commit_v2;
create function public.tablepulse_commit(p_venue uuid,p_revision bigint,p_state jsonb) returns bigint
 language plpgsql security definer set search_path=public as $$
declare x jsonb; campaign jsonb; item jsonb; old_status text; revenue numeric; margin_percent numeric; next_revision bigint;
begin
 if p_state->'settings'->>'minMarginPercent' is null or
    (p_state->'settings'->>'minMarginPercent')::numeric not between 0 and 95 then
  raise exception 'Invalid incremental margin floor';
 end if;
 for x in select value from jsonb_array_elements(p_state->'instances') loop
  select status into old_status from public.offer_instances where id=(x->>'id')::uuid;
  if x->>'status'='active' or (old_status='active' and x->>'status'='redeemed') then
   select value into campaign from jsonb_array_elements(p_state->'offers') where value->>'id'=x->>'offerId';
   select value into item from jsonb_array_elements(p_state->'menu') where value->>'id'=campaign->>'itemId';
   if campaign is null or item is null then raise exception 'Missing margin context'; end if;
   revenue:=(campaign->>'price')::numeric*(campaign->>'quantity')::integer;
   if revenue<=0 then raise exception 'Offer revenue must be positive'; end if;
   margin_percent:=100*(((campaign->>'price')::numeric-(item->>'cost')::numeric)*(campaign->>'quantity')::integer)/revenue;
   if margin_percent<(p_state->'settings'->>'minMarginPercent')::numeric then
    raise exception 'Incremental percentage margin floor not met';
   end if;
  end if;
 end loop;
 next_revision:=public.tablepulse_commit_v2(p_venue,p_revision,p_state);
 return next_revision;
end $$;
revoke all on function public.tablepulse_commit_v2(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.tablepulse_commit_v2(uuid,bigint,jsonb) to service_role;
revoke all on function public.tablepulse_commit(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.tablepulse_commit(uuid,bigint,jsonb) to service_role;
