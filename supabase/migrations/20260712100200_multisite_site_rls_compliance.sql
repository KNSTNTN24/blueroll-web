set search_path = public;
begin;

-- checklist_completions
drop policy if exists "Business members can view completions" on checklist_completions;
create policy "Business members can view completions" on checklist_completions
  for select using (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Business members can create completions" on checklist_completions;
create policy "Business members can create completions" on checklist_completions
  for insert with check (completed_by = auth.uid() and business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Users can sign off completions" on checklist_completions;
create policy "Users can sign off completions" on checklist_completions
  for update using (business_id = get_my_business_id() and can_see_site_row(site_id))
  with check (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Delete own or managed completions" on checklist_completions;
create policy "Delete own or managed completions" on checklist_completions
  for delete using (business_id = get_my_business_id() and can_see_site_row(site_id)
    and (completed_by = auth.uid() or get_my_role() = any (array['owner','manager'])));

-- checklist_instances (SELECT only exists today)
drop policy if exists "ci_select" on checklist_instances;
create policy "ci_select" on checklist_instances
  for select using (business_id = get_my_business_id() and can_see_site_row(site_id));

-- checklist_templates
drop policy if exists "Business members can view templates" on checklist_templates;
create policy "Business members can view templates" on checklist_templates
  for select using (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Managers can manage templates" on checklist_templates;
create policy "Managers can manage templates" on checklist_templates
  for all using (business_id = get_my_business_id() and get_my_role() = any (array['owner','manager']) and can_see_site_row(site_id))
  with check (business_id = get_my_business_id() and get_my_role() = any (array['owner','manager']) and can_see_site_row(site_id));

-- incidents
drop policy if exists "Business members can view incidents" on incidents;
create policy "Business members can view incidents" on incidents
  for select using (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Business members can create incidents" on incidents;
create policy "Business members can create incidents" on incidents
  for insert with check (reported_by = auth.uid() and business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "incidents_update" on incidents;
create policy "incidents_update" on incidents
  for update using (business_id = get_my_business_id() and can_see_site_row(site_id))
  with check (business_id = get_my_business_id() and can_see_site_row(site_id));

-- deliveries
drop policy if exists "Users can view deliveries in their business" on deliveries;
create policy "Users can view deliveries in their business" on deliveries
  for select using (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Users can insert deliveries in their business" on deliveries;
create policy "Users can insert deliveries in their business" on deliveries
  for insert with check (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Users can update deliveries in their business" on deliveries;
create policy "Users can update deliveries in their business" on deliveries
  for update using (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Users can delete deliveries in their business" on deliveries;
create policy "Users can delete deliveries in their business" on deliveries
  for delete using (business_id = get_my_business_id() and can_see_site_row(site_id));

-- diary_entries
drop policy if exists "Business members can view diary" on diary_entries;
create policy "Business members can view diary" on diary_entries
  for select using (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Business members can manage diary" on diary_entries;
create policy "Business members can manage diary" on diary_entries
  for all using (business_id = get_my_business_id() and can_see_site_row(site_id))
  with check (business_id = get_my_business_id() and can_see_site_row(site_id));

-- staff_checkins
drop policy if exists "Users can view own business checkins" on staff_checkins;
create policy "Users can view own business checkins" on staff_checkins
  for select using (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Users can check in" on staff_checkins;
create policy "Users can check in" on staff_checkins
  for insert with check (user_id = auth.uid() and business_id = get_my_business_id() and can_see_site_row(site_id));
-- "Users can check out" (UPDATE, user_id = auth.uid()) unchanged — self-scoped already.

-- haccp_pack_data
drop policy if exists "Users can read own business haccp data" on haccp_pack_data;
create policy "Users can read own business haccp data" on haccp_pack_data
  for select using (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Users can insert own business haccp data" on haccp_pack_data;
create policy "Users can insert own business haccp data" on haccp_pack_data
  for insert with check (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Users can update own business haccp data" on haccp_pack_data;
create policy "Users can update own business haccp data" on haccp_pack_data
  for update using (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "Users can delete own business haccp data" on haccp_pack_data;
create policy "Users can delete own business haccp data" on haccp_pack_data
  for delete using (business_id = get_my_business_id() and can_see_site_row(site_id));

-- haccp_signoffs
drop policy if exists "haccp_signoffs_select" on haccp_signoffs;
create policy "haccp_signoffs_select" on haccp_signoffs
  for select using (business_id = get_my_business_id() and can_see_site_row(site_id));
drop policy if exists "haccp_signoffs_write" on haccp_signoffs;
create policy "haccp_signoffs_write" on haccp_signoffs
  for all using (business_id = get_my_business_id() and can_see_site_row(site_id))
  with check (business_id = get_my_business_id() and can_see_site_row(site_id));

commit;
