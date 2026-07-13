-- Correction to 20260712100200: haccp_pack_data is ONE-ROW-PER-BUSINESS
-- (UNIQUE(business_id); per-site HACCP is explicitly deferred per the foundation
-- migration). Site-scoping its RLS would hide the single business-level HACCP pack
-- from non-admin members whose home site != the row's site. Revert this one table
-- to business-level (group-wide) access; the other 8 compliance tables stay
-- site-scoped. site_id column stays (vestigial) for the future per-site HACCP phase.
begin;
drop policy if exists "Users can read own business haccp data" on haccp_pack_data;
create policy "Users can read own business haccp data" on haccp_pack_data
  for select using (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));
drop policy if exists "Users can insert own business haccp data" on haccp_pack_data;
create policy "Users can insert own business haccp data" on haccp_pack_data
  for insert with check (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));
drop policy if exists "Users can update own business haccp data" on haccp_pack_data;
create policy "Users can update own business haccp data" on haccp_pack_data
  for update using (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));
drop policy if exists "Users can delete own business haccp data" on haccp_pack_data;
create policy "Users can delete own business haccp data" on haccp_pack_data
  for delete using (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));
commit;
