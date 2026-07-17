-- HOTFIX for a live regression from 20260712100300 (kitchen site RLS):
-- every recipe/supplier has site_id = NULL (kitchen was intentionally left shared,
-- and there is no UI to assign a recipe/supplier to a site). can_write_kitchen_row(NULL)
-- collapses to am_i_group_admin(), so non-admin chefs/managers could no longer
-- create or edit ANY recipe/supplier (incl. single-site real clients, e.g. Plan B London).
-- Revert recipes + suppliers to the original business-level policies (owner/manager/chef
-- manage the group's kitchen). Per-site kitchen ownership is deferred to a future phase
-- that ships the assign-to-site UI + backfill together. Compliance-table isolation is
-- unaffected. Does NOT touch the entitlement_write_gate_* RESTRICTIVE policies.
begin;
drop policy if exists "Business members can view recipes" on recipes;
create policy "Business members can view recipes" on recipes
  for select using (business_id = get_my_business_id());
drop policy if exists "Chefs can manage recipes" on recipes;
create policy "Chefs can manage recipes" on recipes
  for all using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager','chef'])));

drop policy if exists "Business members can view suppliers" on suppliers;
create policy "Business members can view suppliers" on suppliers
  for select using (business_id = get_my_business_id());
drop policy if exists "Managers can manage suppliers" on suppliers;
create policy "Managers can manage suppliers" on suppliers
  for all using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])));
commit;
