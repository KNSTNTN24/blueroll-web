-- FIX for a Task-5 (20260714130300) regression: the RLS swap wrongly re-added
-- `can_write_kitchen_row(site_id)` to the recipes/suppliers manage policies. The
-- kitchen was deliberately reverted to business-level earlier (20260713102000,
-- Plan B London incident: every recipe/supplier has site_id NULL, and
-- can_write_kitchen_row(NULL) = am_i_group_admin(), so non-admin chefs/managers
-- were blocked from creating/editing recipes & suppliers). Restore business-level
-- manage (has_capability only, no site scope). Compliance tables stay site-scoped;
-- only kitchen (recipes/suppliers) is business-level.
begin;
drop policy if exists "Chefs can manage recipes" on recipes;
create policy "Chefs can manage recipes" on recipes for all
  using (business_id = get_my_business_id() and has_capability('manage_recipes'))
  with check (business_id = get_my_business_id() and has_capability('manage_recipes'));
drop policy if exists "Managers can manage suppliers" on suppliers;
create policy "Managers can manage suppliers" on suppliers for all
  using (business_id = get_my_business_id() and has_capability('manage_suppliers'))
  with check (business_id = get_my_business_id() and has_capability('manage_suppliers'));
commit;
