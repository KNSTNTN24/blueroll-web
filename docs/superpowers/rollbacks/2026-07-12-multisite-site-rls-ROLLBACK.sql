-- ⚠️ EMERGENCY ROLLBACK — NOT A MIGRATION. Do NOT place in supabase/migrations/.
-- Reverts the site-scoped RLS swap (20260712100200 + 100300) back to the original
-- business-level policies. Apply MANUALLY via the Management API ONLY if the site
-- isolation must be undone. Applied migrations here are run by raw SQL API, not the
-- Supabase CLI — so this file lives outside migrations/ to keep `supabase db push`
-- from silently reverting production. Does NOT touch entitlement_write_gate_* policies.

set search_path = public;
begin;

-- checklist_completions
drop policy if exists "Business members can view completions" on checklist_completions;
create policy "Business members can view completions" on checklist_completions for select using (business_id = get_my_business_id());
drop policy if exists "Business members can create completions" on checklist_completions;
create policy "Business members can create completions" on checklist_completions for insert with check ((completed_by = auth.uid()) and (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid())));
drop policy if exists "Users can sign off completions" on checklist_completions;
create policy "Users can sign off completions" on checklist_completions for update using (business_id = get_my_business_id()) with check (business_id = get_my_business_id());
drop policy if exists "Delete own or managed completions" on checklist_completions;
create policy "Delete own or managed completions" on checklist_completions for delete using ((business_id = get_my_business_id()) and ((completed_by = auth.uid()) or (get_my_role() = any (array['owner','manager']))));

-- checklist_instances
drop policy if exists "ci_select" on checklist_instances;
create policy "ci_select" on checklist_instances for select using (business_id = get_my_business_id());

-- checklist_templates
drop policy if exists "Business members can view templates" on checklist_templates;
create policy "Business members can view templates" on checklist_templates for select using (business_id = get_my_business_id());
drop policy if exists "Managers can manage templates" on checklist_templates;
create policy "Managers can manage templates" on checklist_templates for all using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])));

-- incidents
drop policy if exists "Business members can view incidents" on incidents;
create policy "Business members can view incidents" on incidents for select using (business_id = get_my_business_id());
drop policy if exists "Business members can create incidents" on incidents;
create policy "Business members can create incidents" on incidents for insert with check ((reported_by = auth.uid()) and (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid())));
drop policy if exists "incidents_update" on incidents;
create policy "incidents_update" on incidents for update using (business_id = get_my_business_id()) with check (business_id = get_my_business_id());

-- deliveries
drop policy if exists "Users can view deliveries in their business" on deliveries;
create policy "Users can view deliveries in their business" on deliveries for select using (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));
drop policy if exists "Users can insert deliveries in their business" on deliveries;
create policy "Users can insert deliveries in their business" on deliveries for insert with check (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));
drop policy if exists "Users can update deliveries in their business" on deliveries;
create policy "Users can update deliveries in their business" on deliveries for update using (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));
drop policy if exists "Users can delete deliveries in their business" on deliveries;
create policy "Users can delete deliveries in their business" on deliveries for delete using (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));

-- diary_entries
drop policy if exists "Business members can view diary" on diary_entries;
create policy "Business members can view diary" on diary_entries for select using (business_id = get_my_business_id());
drop policy if exists "Business members can manage diary" on diary_entries;
create policy "Business members can manage diary" on diary_entries for all using (business_id = get_my_business_id());

-- staff_checkins
drop policy if exists "Users can view own business checkins" on staff_checkins;
create policy "Users can view own business checkins" on staff_checkins for select using (business_id = get_my_business_id());
drop policy if exists "Users can check in" on staff_checkins;
create policy "Users can check in" on staff_checkins for insert with check ((user_id = auth.uid()) and (business_id = get_my_business_id()));

-- haccp_pack_data
drop policy if exists "Users can read own business haccp data" on haccp_pack_data;
create policy "Users can read own business haccp data" on haccp_pack_data for select using (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));
drop policy if exists "Users can insert own business haccp data" on haccp_pack_data;
create policy "Users can insert own business haccp data" on haccp_pack_data for insert with check (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));
drop policy if exists "Users can update own business haccp data" on haccp_pack_data;
create policy "Users can update own business haccp data" on haccp_pack_data for update using (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));
drop policy if exists "Users can delete own business haccp data" on haccp_pack_data;
create policy "Users can delete own business haccp data" on haccp_pack_data for delete using (business_id in (select profiles.business_id from profiles where profiles.id = auth.uid()));

-- haccp_signoffs
drop policy if exists "haccp_signoffs_select" on haccp_signoffs;
create policy "haccp_signoffs_select" on haccp_signoffs for select using (business_id = get_my_business_id());
drop policy if exists "haccp_signoffs_write" on haccp_signoffs;
create policy "haccp_signoffs_write" on haccp_signoffs for all using (business_id = get_my_business_id()) with check (business_id = get_my_business_id());

-- recipes
drop policy if exists "Business members can view recipes" on recipes;
create policy "Business members can view recipes" on recipes for select using (business_id = get_my_business_id());
drop policy if exists "Chefs can manage recipes" on recipes;
create policy "Chefs can manage recipes" on recipes for all using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager','chef'])));

-- suppliers
drop policy if exists "Business members can view suppliers" on suppliers;
create policy "Business members can view suppliers" on suppliers for select using (business_id = get_my_business_id());
drop policy if exists "Managers can manage suppliers" on suppliers;
create policy "Managers can manage suppliers" on suppliers for all using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])));

commit;
