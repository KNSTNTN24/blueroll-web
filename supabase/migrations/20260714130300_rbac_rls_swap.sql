set search_path = public;
begin;

-- manage_checklists group
drop policy if exists "Managers can manage templates" on checklist_templates;
create policy "Managers can manage templates" on checklist_templates for all
  using (business_id = get_my_business_id() and has_capability('manage_checklists') and can_see_site_row(site_id))
  with check (business_id = get_my_business_id() and has_capability('manage_checklists') and can_see_site_row(site_id));

drop policy if exists "Managers can manage items" on checklist_template_items;
create policy "Managers can manage items" on checklist_template_items for all
  using (template_id in (select id from checklist_templates where business_id = get_my_business_id()) and has_capability('manage_checklists'));

drop policy if exists "Managers can manage reviews" on four_weekly_reviews;
create policy "Managers can manage reviews" on four_weekly_reviews for all
  using (business_id = get_my_business_id() and has_capability('manage_checklists'));

drop policy if exists "Managers can manage rules" on notification_rules;
create policy "Managers can manage rules" on notification_rules for all
  using (business_id = get_my_business_id() and has_capability('manage_checklists'));

-- sign_off
drop policy if exists "Delete own or managed completions" on checklist_completions;
create policy "Delete own or managed completions" on checklist_completions for delete
  using (business_id = get_my_business_id() and can_see_site_row(site_id) and (completed_by = auth.uid() or has_capability('sign_off')));

-- manage_recipes group (owner+manager+chef)
drop policy if exists "Chefs can manage recipes" on recipes;
create policy "Chefs can manage recipes" on recipes for all
  using (business_id = get_my_business_id() and has_capability('manage_recipes'))
  with check (business_id = get_my_business_id() and has_capability('manage_recipes'));

drop policy if exists "Chefs can manage recipe ingredients" on recipe_ingredients;
create policy "Chefs can manage recipe ingredients" on recipe_ingredients for all
  using (recipe_id in (select id from recipes where business_id = get_my_business_id()) and has_capability('manage_recipes'));

drop policy if exists "Recipe writers manage recipe_tags" on recipe_tags;
create policy "Recipe writers manage recipe_tags" on recipe_tags for all
  using (has_capability('manage_recipes') and recipe_id in (select id from recipes where business_id = get_my_business_id()))
  with check (has_capability('manage_recipes') and recipe_id in (select id from recipes where business_id = get_my_business_id()) and tag_id in (select id from tags where business_id = get_my_business_id()));

drop policy if exists "Chefs can manage ingredients" on ingredients;
create policy "Chefs can manage ingredients" on ingredients for all
  using (business_id = get_my_business_id() and has_capability('manage_recipes'));

drop policy if exists "Managers can manage menu" on menu_items;
create policy "Managers can manage menu" on menu_items for all
  using (business_id = get_my_business_id() and has_capability('manage_recipes'));

drop policy if exists "Recipe writers manage tags" on tags;
create policy "Recipe writers manage tags" on tags for all
  using (business_id = get_my_business_id() and has_capability('manage_recipes'))
  with check (business_id = get_my_business_id() and has_capability('manage_recipes'));

-- manage_team
drop policy if exists "Managers can manage invites" on invites;
create policy "Managers can manage invites" on invites for all
  using (business_id = get_my_business_id() and has_capability('manage_team'));

drop policy if exists "Admins can manage member profiles" on profiles;
create policy "Admins can manage member profiles" on profiles for update
  using (business_id = get_my_business_id() and has_capability('manage_team'))
  with check (business_id = get_my_business_id());

drop policy if exists "Managers can manage training" on training_records;
create policy "Managers can manage training" on training_records for all
  using (business_id = get_my_business_id() and has_capability('manage_team'));

-- manage_suppliers (business-level; kitchen reverted from site-scope earlier)
drop policy if exists "Managers can manage suppliers" on suppliers;
create policy "Managers can manage suppliers" on suppliers for all
  using (business_id = get_my_business_id() and has_capability('manage_suppliers'))
  with check (business_id = get_my_business_id() and has_capability('manage_suppliers'));

-- manage_sites (owner-only today)
drop policy if exists sites_write on sites;
create policy sites_write on sites for all
  using (business_id = get_my_business_id() and has_capability('manage_sites'))
  with check (business_id = get_my_business_id() and has_capability('manage_sites'));

-- documents + document_access: preserve exact access sets.
--   owner-string  → has_capability('view_documents')   (owner-only preset)
--   owner+manager → has_capability('manage_documents')  (owner+manager preset)
drop policy if exists documents_select on documents;
create policy documents_select on documents for select
  using (business_id = get_my_business_id() and (
    has_capability('view_documents')
    or access_level = 'all'
    or (access_level = 'managers_only' and has_capability('manage_documents'))
    or (access_level = 'owner_only' and has_capability('view_documents'))
    or (access_level = 'custom' and (has_capability('view_documents') or auth.uid() in (select da.profile_id from document_access da where da.document_id = documents.id)))
  ));
drop policy if exists documents_insert on documents;
create policy documents_insert on documents for insert
  with check (business_id = get_my_business_id() and has_capability('manage_documents'));
drop policy if exists documents_update_owner_manager on documents;
create policy documents_update_owner_manager on documents for update
  using (business_id = get_my_business_id() and has_capability('manage_documents'))
  with check (business_id = get_my_business_id());
drop policy if exists documents_update on documents;
create policy documents_update on documents for update
  using (business_id = get_my_business_id() and (has_capability('view_documents') or uploaded_by = auth.uid()));
drop policy if exists documents_delete on documents;
create policy documents_delete on documents for delete
  using (business_id = get_my_business_id() and has_capability('view_documents'));

drop policy if exists document_access_insert on document_access;
create policy document_access_insert on document_access for insert
  with check (has_capability('manage_documents'));
drop policy if exists document_access_delete on document_access;
create policy document_access_delete on document_access for delete
  using (has_capability('view_documents'));

commit;
