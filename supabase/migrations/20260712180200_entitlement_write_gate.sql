-- RESTRICTIVE write-gate: unentitled (unpaid / expired) businesses can no longer
-- INSERT or UPDATE data. Reads (SELECT) and DELETE are deliberately left open so
-- existing data stays visible and removable after a subscription lapses.
--
-- These are AS RESTRICTIVE policies (separate objects). Restrictive policies
-- AND-compose with the permissive write policies already on each table (the old
-- get_my_business_id()/get_my_role() ones, and Maria's future per-site ones) and
-- never clobber them: a write must satisfy the permissive policy(ies) AND every
-- restrictive one. We do NOT touch any existing permissive policy.
--
-- The gate is public.is_business_entitled(uuid) (Task 1), SECURITY DEFINER, which
-- returns true for active / live-trial / within-grace businesses and false for
-- expired-trial / canceled / soft-deleted ones.
--
-- Idempotent: drop-if-exists before every create.
--
-- Table set was derived live from pg_policies (tables with a direct business_id
-- and a user-writable INSERT/UPDATE/ALL policy), plus the five child tables that
-- carry no business_id and are gated through their parent's business_id.

-- ============================================================================
-- Direct business_id tables
-- ============================================================================

-- recipes
drop policy if exists entitlement_write_gate_ins on public.recipes;
create policy entitlement_write_gate_ins on public.recipes
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.recipes;
create policy entitlement_write_gate_upd on public.recipes
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- menu_items
drop policy if exists entitlement_write_gate_ins on public.menu_items;
create policy entitlement_write_gate_ins on public.menu_items
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.menu_items;
create policy entitlement_write_gate_upd on public.menu_items
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- tags
drop policy if exists entitlement_write_gate_ins on public.tags;
create policy entitlement_write_gate_ins on public.tags
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.tags;
create policy entitlement_write_gate_upd on public.tags
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- checklist_templates
drop policy if exists entitlement_write_gate_ins on public.checklist_templates;
create policy entitlement_write_gate_ins on public.checklist_templates
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.checklist_templates;
create policy entitlement_write_gate_upd on public.checklist_templates
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- checklist_completions
drop policy if exists entitlement_write_gate_ins on public.checklist_completions;
create policy entitlement_write_gate_ins on public.checklist_completions
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.checklist_completions;
create policy entitlement_write_gate_upd on public.checklist_completions
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- checklist_drafts
drop policy if exists entitlement_write_gate_ins on public.checklist_drafts;
create policy entitlement_write_gate_ins on public.checklist_drafts
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.checklist_drafts;
create policy entitlement_write_gate_upd on public.checklist_drafts
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- documents
drop policy if exists entitlement_write_gate_ins on public.documents;
create policy entitlement_write_gate_ins on public.documents
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.documents;
create policy entitlement_write_gate_upd on public.documents
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- incidents
drop policy if exists entitlement_write_gate_ins on public.incidents;
create policy entitlement_write_gate_ins on public.incidents
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.incidents;
create policy entitlement_write_gate_upd on public.incidents
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- diary_entries
drop policy if exists entitlement_write_gate_ins on public.diary_entries;
create policy entitlement_write_gate_ins on public.diary_entries
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.diary_entries;
create policy entitlement_write_gate_upd on public.diary_entries
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- suppliers
drop policy if exists entitlement_write_gate_ins on public.suppliers;
create policy entitlement_write_gate_ins on public.suppliers
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.suppliers;
create policy entitlement_write_gate_upd on public.suppliers
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- deliveries
drop policy if exists entitlement_write_gate_ins on public.deliveries;
create policy entitlement_write_gate_ins on public.deliveries
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.deliveries;
create policy entitlement_write_gate_upd on public.deliveries
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- staff_checkins
drop policy if exists entitlement_write_gate_ins on public.staff_checkins;
create policy entitlement_write_gate_ins on public.staff_checkins
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.staff_checkins;
create policy entitlement_write_gate_upd on public.staff_checkins
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- haccp_pack_data
drop policy if exists entitlement_write_gate_ins on public.haccp_pack_data;
create policy entitlement_write_gate_ins on public.haccp_pack_data
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.haccp_pack_data;
create policy entitlement_write_gate_upd on public.haccp_pack_data
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- four_weekly_reviews
drop policy if exists entitlement_write_gate_ins on public.four_weekly_reviews;
create policy entitlement_write_gate_ins on public.four_weekly_reviews
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.four_weekly_reviews;
create policy entitlement_write_gate_upd on public.four_weekly_reviews
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- haccp_signoffs
drop policy if exists entitlement_write_gate_ins on public.haccp_signoffs;
create policy entitlement_write_gate_ins on public.haccp_signoffs
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.haccp_signoffs;
create policy entitlement_write_gate_upd on public.haccp_signoffs
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- training_records
drop policy if exists entitlement_write_gate_ins on public.training_records;
create policy entitlement_write_gate_ins on public.training_records
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.training_records;
create policy entitlement_write_gate_upd on public.training_records
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- notification_rules
drop policy if exists entitlement_write_gate_ins on public.notification_rules;
create policy entitlement_write_gate_ins on public.notification_rules
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.notification_rules;
create policy entitlement_write_gate_upd on public.notification_rules
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- sites
drop policy if exists entitlement_write_gate_ins on public.sites;
create policy entitlement_write_gate_ins on public.sites
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.sites;
create policy entitlement_write_gate_upd on public.sites
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- invites
drop policy if exists entitlement_write_gate_ins on public.invites;
create policy entitlement_write_gate_ins on public.invites
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.invites;
create policy entitlement_write_gate_upd on public.invites
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- profiles
drop policy if exists entitlement_write_gate_ins on public.profiles;
create policy entitlement_write_gate_ins on public.profiles
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.profiles;
create policy entitlement_write_gate_upd on public.profiles
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- ingredients (business_id is nullable in schema, but 0 rows are NULL in practice
-- and the permissive policy is business-scoped; a NULL would evaluate to false and
-- be denied, which is the intended default-deny for an unowned client write)
drop policy if exists entitlement_write_gate_ins on public.ingredients;
create policy entitlement_write_gate_ins on public.ingredients
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.ingredients;
create policy entitlement_write_gate_upd on public.ingredients
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));

-- ============================================================================
-- Child tables (no business_id) — gated through their parent's business_id
-- ============================================================================

-- recipe_ingredients -> recipes (recipe_id -> recipes.id)
drop policy if exists entitlement_write_gate_ins on public.recipe_ingredients;
create policy entitlement_write_gate_ins on public.recipe_ingredients
  as restrictive for insert to authenticated
  with check (public.is_business_entitled((select r.business_id from public.recipes r where r.id = recipe_id)));
drop policy if exists entitlement_write_gate_upd on public.recipe_ingredients;
create policy entitlement_write_gate_upd on public.recipe_ingredients
  as restrictive for update to authenticated
  using (public.is_business_entitled((select r.business_id from public.recipes r where r.id = recipe_id)))
  with check (public.is_business_entitled((select r.business_id from public.recipes r where r.id = recipe_id)));

-- recipe_tags -> recipes (recipe_id -> recipes.id)
drop policy if exists entitlement_write_gate_ins on public.recipe_tags;
create policy entitlement_write_gate_ins on public.recipe_tags
  as restrictive for insert to authenticated
  with check (public.is_business_entitled((select r.business_id from public.recipes r where r.id = recipe_id)));
drop policy if exists entitlement_write_gate_upd on public.recipe_tags;
create policy entitlement_write_gate_upd on public.recipe_tags
  as restrictive for update to authenticated
  using (public.is_business_entitled((select r.business_id from public.recipes r where r.id = recipe_id)))
  with check (public.is_business_entitled((select r.business_id from public.recipes r where r.id = recipe_id)));

-- checklist_template_items -> checklist_templates (template_id -> checklist_templates.id)
drop policy if exists entitlement_write_gate_ins on public.checklist_template_items;
create policy entitlement_write_gate_ins on public.checklist_template_items
  as restrictive for insert to authenticated
  with check (public.is_business_entitled((select t.business_id from public.checklist_templates t where t.id = template_id)));
drop policy if exists entitlement_write_gate_upd on public.checklist_template_items;
create policy entitlement_write_gate_upd on public.checklist_template_items
  as restrictive for update to authenticated
  using (public.is_business_entitled((select t.business_id from public.checklist_templates t where t.id = template_id)))
  with check (public.is_business_entitled((select t.business_id from public.checklist_templates t where t.id = template_id)));

-- checklist_responses -> checklist_completions (completion_id -> checklist_completions.id)
drop policy if exists entitlement_write_gate_ins on public.checklist_responses;
create policy entitlement_write_gate_ins on public.checklist_responses
  as restrictive for insert to authenticated
  with check (public.is_business_entitled((select c.business_id from public.checklist_completions c where c.id = completion_id)));
drop policy if exists entitlement_write_gate_upd on public.checklist_responses;
create policy entitlement_write_gate_upd on public.checklist_responses
  as restrictive for update to authenticated
  using (public.is_business_entitled((select c.business_id from public.checklist_completions c where c.id = completion_id)))
  with check (public.is_business_entitled((select c.business_id from public.checklist_completions c where c.id = completion_id)));

-- delivery_photos -> deliveries (delivery_id -> deliveries.id)
drop policy if exists entitlement_write_gate_ins on public.delivery_photos;
create policy entitlement_write_gate_ins on public.delivery_photos
  as restrictive for insert to authenticated
  with check (public.is_business_entitled((select d.business_id from public.deliveries d where d.id = delivery_id)));
drop policy if exists entitlement_write_gate_upd on public.delivery_photos;
create policy entitlement_write_gate_upd on public.delivery_photos
  as restrictive for update to authenticated
  using (public.is_business_entitled((select d.business_id from public.deliveries d where d.id = delivery_id)))
  with check (public.is_business_entitled((select d.business_id from public.deliveries d where d.id = delivery_id)));
