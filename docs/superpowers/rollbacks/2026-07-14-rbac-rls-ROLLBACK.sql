-- ⚠️ EMERGENCY ROLLBACK — NOT A MIGRATION. Do NOT place in supabase/migrations/.
-- Reverts the RBAC capability RLS swap (20260714130300 + the kitchen fix 20260714130400)
-- back to the exact pre-swap role-string policies. Apply MANUALLY via the Management API
-- only if the capability model must be undone. Captured verbatim from pg_policies before
-- the swap. Preserves the multisite site-scope (can_see_site_row) on compliance tables and
-- the business-level kitchen (recipes/suppliers have NO site scope — reverted earlier).
-- Does NOT touch entitlement_write_gate_*, incidents, deliveries, or the roles/has_capability
-- objects (those stay; they are harmless once policies read get_my_role again).
begin;

-- checklist_templates / items / four_weekly_reviews / notification_rules  (manage_checklists → owner+manager)
drop policy if exists "Managers can manage templates" on checklist_templates;
create policy "Managers can manage templates" on checklist_templates for all
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])) and can_see_site_row(site_id))
  with check ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])) and can_see_site_row(site_id));

drop policy if exists "Managers can manage items" on checklist_template_items;
create policy "Managers can manage items" on checklist_template_items for all
  using ((template_id in (select checklist_templates.id from checklist_templates where checklist_templates.business_id = get_my_business_id())) and (get_my_role() = any (array['owner','manager'])));

drop policy if exists "Managers can manage reviews" on four_weekly_reviews;
create policy "Managers can manage reviews" on four_weekly_reviews for all
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])));

drop policy if exists "Managers can manage rules" on notification_rules;
create policy "Managers can manage rules" on notification_rules for all
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])));

-- checklist_completions delete (sign_off)
drop policy if exists "Delete own or managed completions" on checklist_completions;
create policy "Delete own or managed completions" on checklist_completions for delete
  using ((business_id = get_my_business_id()) and can_see_site_row(site_id) and ((completed_by = auth.uid()) or (get_my_role() = any (array['owner','manager']))));

-- recipes / recipe_ingredients / recipe_tags / ingredients / menu_items / tags  (manage_recipes → owner+manager+chef); kitchen is BUSINESS-level (no site scope)
drop policy if exists "Chefs can manage recipes" on recipes;
create policy "Chefs can manage recipes" on recipes for all
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager','chef'])));

drop policy if exists "Chefs can manage recipe ingredients" on recipe_ingredients;
create policy "Chefs can manage recipe ingredients" on recipe_ingredients for all
  using ((recipe_id in (select recipes.id from recipes where recipes.business_id = get_my_business_id())) and (get_my_role() = any (array['owner','manager','chef'])));

drop policy if exists "Recipe writers manage recipe_tags" on recipe_tags;
create policy "Recipe writers manage recipe_tags" on recipe_tags for all
  using ((get_my_role() = any (array['owner','manager','chef'])) and (recipe_id in (select recipes.id from recipes where recipes.business_id = get_my_business_id())))
  with check ((get_my_role() = any (array['owner','manager','chef'])) and (recipe_id in (select recipes.id from recipes where recipes.business_id = get_my_business_id())) and (tag_id in (select tags.id from tags where tags.business_id = get_my_business_id())));

drop policy if exists "Chefs can manage ingredients" on ingredients;
create policy "Chefs can manage ingredients" on ingredients for all
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager','chef'])));

drop policy if exists "Managers can manage menu" on menu_items;
create policy "Managers can manage menu" on menu_items for all
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager','chef'])));

drop policy if exists "Recipe writers manage tags" on tags;
create policy "Recipe writers manage tags" on tags for all
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager','chef'])))
  with check ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager','chef'])));

-- invites / profiles / training_records  (manage_team → owner+manager)
drop policy if exists "Managers can manage invites" on invites;
create policy "Managers can manage invites" on invites for all
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])));

drop policy if exists "Admins can manage member profiles" on profiles;
create policy "Admins can manage member profiles" on profiles for update
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])))
  with check (business_id = get_my_business_id());

drop policy if exists "Managers can manage training" on training_records;
create policy "Managers can manage training" on training_records for all
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])));

-- suppliers  (manage_suppliers → owner+manager); BUSINESS-level (no site scope)
drop policy if exists "Managers can manage suppliers" on suppliers;
create policy "Managers can manage suppliers" on suppliers for all
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])));

-- sites  (manage_sites → owner)
drop policy if exists sites_write on sites;
create policy sites_write on sites for all
  using ((business_id = get_my_business_id()) and (get_my_role() = 'owner'))
  with check ((business_id = get_my_business_id()) and (get_my_role() = 'owner'));

-- documents (×5) + document_access (×2) — preserve the access_level logic
drop policy if exists documents_select on documents;
create policy documents_select on documents for select
  using ((business_id = get_my_business_id()) and ((get_my_role() = 'owner') or (access_level = 'all') or ((access_level = 'managers_only') and (get_my_role() = any (array['owner','manager']))) or ((access_level = 'owner_only') and (get_my_role() = 'owner')) or ((access_level = 'custom') and ((get_my_role() = 'owner') or (auth.uid() in (select da.profile_id from document_access da where da.document_id = documents.id))))));
drop policy if exists documents_insert on documents;
create policy documents_insert on documents for insert
  with check ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])));
drop policy if exists documents_update_owner_manager on documents;
create policy documents_update_owner_manager on documents for update
  using ((business_id = get_my_business_id()) and (get_my_role() = any (array['owner','manager'])))
  with check (business_id = get_my_business_id());
drop policy if exists documents_update on documents;
create policy documents_update on documents for update
  using ((business_id = get_my_business_id()) and ((get_my_role() = 'owner') or (uploaded_by = auth.uid())));
drop policy if exists documents_delete on documents;
create policy documents_delete on documents for delete
  using ((business_id = get_my_business_id()) and (get_my_role() = 'owner'));

drop policy if exists document_access_insert on document_access;
create policy document_access_insert on document_access for insert
  with check (get_my_role() = any (array['owner','manager']));
drop policy if exists document_access_delete on document_access;
create policy document_access_delete on document_access for delete
  using (get_my_role() = 'owner');

commit;
