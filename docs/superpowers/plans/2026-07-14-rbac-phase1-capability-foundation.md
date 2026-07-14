# RBAC Phase 1 — Capability Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move RLS enforcement from hardcoded role-name strings onto `has_capability()`, seeding per-business preset roles whose capability sets equal today's behavior exactly. Zero behavior change; unlocks custom role names (Phase 3) and per-member grants (Phase 4).

**Architecture:** Additive-on-prod. Add `roles` + `profiles.role_id` + `has_capability()` + triggers and backfill (all no-ops for access), gate on verification, then swap every role-gated policy inside one transaction. `profiles.role` (text) is preserved and kept in sync for the published mobile app.

**Tech Stack:** Supabase Postgres (SQL applied via the Management API, NOT the CLI), branch `KNS/multisite-rls` in worktree `~/HACCP/web-integrate`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-rbac-phase1-capability-foundation-design.md`.
- **DB = shared production** `rszrggreuarvodcqeqrj`; staging sits on it. Every SQL step touches live data — additive only until the gated swap.
- Access token from `~/Secrets/blueroll/supabase-access-token.txt` (`sbp_…`). Never inline it.
- Apply SQL with this helper (send JSON body directly; never `curl -f`). Run Bash with `dangerouslyDisableSandbox: true` (network to api.supabase.com):
  ```bash
  apply_sql() { local SBP; SBP=$(grep -oE "sbp_[A-Za-z0-9]+" ~/Secrets/blueroll/supabase-access-token.txt | head -1)
    python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' "$1" | curl -s -m 60 -X POST "https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/database/query" -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" --data @- ; echo ; }
  run_sql()  { local SBP; SBP=$(grep -oE "sbp_[A-Za-z0-9]+" ~/Secrets/blueroll/supabase-access-token.txt | head -1)
    python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1" | curl -s -m 60 -X POST "https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/database/query" -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" --data @- ; echo ; }
  ```
  Success DDL/`do`/`update` returns `[]`; a query returns rows; any `"error"` key = FAILURE (stop, report, do not improvise).
- **Capability catalog (14):** `manage_checklists, complete_checklists, sign_off, manage_recipes, manage_documents, view_documents, manage_incidents, manage_deliveries, manage_suppliers, manage_team, manage_roles, manage_sites, manage_billing, view_reports`.
- **Preset capability sets** (base for seeding):
  - all-members baseline (every preset gets these): `complete_checklists, view_reports, manage_incidents, manage_deliveries`
  - **owner** = ALL 14 (super-role, `is_system`, `base_tier='owner'`).
  - **manager** = baseline + `manage_checklists, sign_off, manage_recipes, manage_documents, manage_suppliers, manage_team`.
  - **chef** = baseline + `manage_recipes`.
  - **kitchen_staff** = baseline.
  - **front_of_house** = baseline.
- `manage_incidents`/`manage_deliveries` are **unenforced in Phase 1** (those tables are member-level today; granted to all presets as future placeholders — do NOT add policies for them).
- Do NOT touch: the multisite site-scope predicates (`can_see_site_row`, `can_write_kitchen_row`), the paywall RESTRICTIVE `entitlement_write_gate_*`, or `incidents`/`deliveries` policies.
- Commit each migration `.sql` for the record even though applied via API. Emergency rollback file lives OUTSIDE `supabase/migrations/`.

---

### Task 1: Schema — capabilities catalog, roles, profiles.role_id

**Files:** Create `supabase/migrations/20260714130000_rbac_schema.sql`

**Interfaces:**
- Produces: table `public.roles`, `public.capability_catalog`, columns `profiles.role_id` + (unchanged) `profiles.role`, validation.

- [ ] **Step 1: Write the migration**

```sql
set search_path = public;

-- Canonical capability catalog (reference table = typo guard for roles.capabilities).
create table if not exists public.capability_catalog (cap text primary key);
insert into public.capability_catalog(cap) values
  ('manage_checklists'),('complete_checklists'),('sign_off'),('manage_recipes'),
  ('manage_documents'),('view_documents'),('manage_incidents'),('manage_deliveries'),
  ('manage_suppliers'),('manage_team'),('manage_roles'),('manage_sites'),
  ('manage_billing'),('view_reports')
on conflict do nothing;

create table if not exists public.roles (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null,
  base_tier    text not null check (base_tier in ('owner','manager','chef','kitchen_staff','front_of_house')),
  capabilities text[] not null default '{}',
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (business_id, name)
);
create index if not exists idx_roles_business on public.roles(business_id);
alter table public.roles enable row level security;

-- Validate every capability string against the catalog (defensive trigger).
create or replace function public.validate_role_capabilities()
returns trigger language plpgsql set search_path = public as $$
declare bad text;
begin
  select c into bad from unnest(new.capabilities) c
  where c not in (select cap from public.capability_catalog) limit 1;
  if bad is not null then raise exception 'unknown capability: %', bad; end if;
  return new;
end $$;
drop trigger if exists trg_validate_role_caps on public.roles;
create trigger trg_validate_role_caps before insert or update on public.roles
  for each row execute function public.validate_role_capabilities();

-- profiles.role_id (profiles.role text stays for mobile back-compat).
alter table public.profiles add column if not exists role_id uuid references public.roles(id) on delete set null;
create index if not exists idx_profiles_role_id on public.profiles(role_id);

-- RLS for roles: members see their business's roles; managing needs manage_roles
-- (helper created in Task 3 — this policy references it, so this migration is applied
--  AFTER Task 3's function exists; see ordering note). For now (pre-helper) create a
-- provisional owner-only manage policy that Task 3 replaces.
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated
  using (business_id = public.get_my_business_id());
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
  using (business_id = public.get_my_business_id() and public.get_my_role() = 'owner')
  with check (business_id = public.get_my_business_id() and public.get_my_role() = 'owner');
```

- [ ] **Step 2: Apply**  `apply_sql supabase/migrations/20260714130000_rbac_schema.sql` → `[]`.
- [ ] **Step 3: Verify** `run_sql "select (select count(*) from capability_catalog) caps, (select count(*) from information_schema.columns where table_name='roles' and table_schema='public') role_cols, (select count(*) from information_schema.columns where table_name='profiles' and column_name='role_id') has_role_id;"` → caps=14, role_cols≈7, has_role_id=1.
- [ ] **Step 4: Commit** `git add supabase/migrations/20260714130000_rbac_schema.sql && git commit -m "rbac: capability catalog + roles table + profiles.role_id"`

---

### Task 2: Seed preset roles per business + backfill profiles.role_id

**Files:** Create `supabase/migrations/20260714130100_rbac_seed_presets.sql`

**Interfaces:**
- Consumes: Task 1.
- Produces: 5 preset `roles` rows for every non-deleted business; every member's `role_id` set.

- [ ] **Step 1: Write the migration**

```sql
set search_path = public;

-- Seed 5 presets for every business that lacks them. Capability sets per the plan.
do $$
declare b record;
  base text[] := array['complete_checklists','view_reports','manage_incidents','manage_deliveries'];
  owner_caps text[] := array['manage_checklists','complete_checklists','sign_off','manage_recipes','manage_documents','view_documents','manage_incidents','manage_deliveries','manage_suppliers','manage_team','manage_roles','manage_sites','manage_billing','view_reports'];
  mgr_caps text[];
  chef_caps text[];
begin
  mgr_caps := base || array['manage_checklists','sign_off','manage_recipes','manage_documents','manage_suppliers','manage_team'];
  chef_caps := base || array['manage_recipes'];
  for b in select id from public.businesses where deleted_at is null loop
    insert into public.roles (business_id, name, base_tier, capabilities, is_system) values
      (b.id, 'Owner',          'owner',          owner_caps, true),
      (b.id, 'Manager',        'manager',        mgr_caps,   true),
      (b.id, 'Chef',           'chef',           chef_caps,  true),
      (b.id, 'Kitchen Staff',  'kitchen_staff',  base,       true),
      (b.id, 'Front of House', 'front_of_house', base,       true)
    on conflict (business_id, name) do nothing;
  end loop;
end $$;

-- Backfill every member's role_id from their legacy profiles.role (matched by base_tier).
update public.profiles p
set role_id = r.id
from public.roles r
where p.role_id is null
  and r.business_id = p.business_id
  and r.base_tier = p.role;
```

- [ ] **Step 2: Apply** → `[]`.
- [ ] **Step 3: Verify seeding + backfill**
  `run_sql "select (select count(*) from businesses b where b.deleted_at is null and (select count(*) from roles r where r.business_id=b.id)<>5) as biz_missing_presets, (select count(*) from profiles p join businesses b on b.id=p.business_id where b.deleted_at is null and p.role_id is null) as members_without_role;"` → both `0`. If `members_without_role`>0, inspect those profiles' `role` values (a role string outside the 5 tiers) before proceeding.
- [ ] **Step 4: Commit** `... commit -m "rbac: seed 5 preset roles per business + backfill profiles.role_id"`

---

### Task 3: has_capability() + role sync trigger + new-business seed + roles.write policy

**Files:** Create `supabase/migrations/20260714130200_rbac_functions.sql`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `has_capability(text)->bool`, `sync_profile_role_text()` trigger, `seed_business_roles()` trigger, `roles_write` policy switched to `manage_roles`.

- [ ] **Step 1: Write the migration**

```sql
set search_path = public;

-- Effective capability check (Phase 1: role caps only; owner short-circuits). Definer.
create or replace function public.has_capability(cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and (r.base_tier = 'owner' or cap = any(r.capabilities))
  )
$$;
grant execute on function public.has_capability(text) to authenticated;

-- Keep profiles.role (text) in sync with the assigned role's base_tier (mobile back-compat).
create or replace function public.sync_profile_role_text()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role_id is not null then
    select base_tier into new.role from public.roles where id = new.role_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_profile_role on public.profiles;
create trigger trg_sync_profile_role before insert or update of role_id on public.profiles
  for each row execute function public.sync_profile_role_text();

-- New businesses auto-seed the 5 presets (compose with existing create_default_site).
create or replace function public.seed_business_roles()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text[] := array['complete_checklists','view_reports','manage_incidents','manage_deliveries'];
begin
  insert into public.roles (business_id, name, base_tier, capabilities, is_system) values
    (new.id, 'Owner','owner', array['manage_checklists','complete_checklists','sign_off','manage_recipes','manage_documents','view_documents','manage_incidents','manage_deliveries','manage_suppliers','manage_team','manage_roles','manage_sites','manage_billing','view_reports'], true),
    (new.id, 'Manager','manager', base || array['manage_checklists','sign_off','manage_recipes','manage_documents','manage_suppliers','manage_team'], true),
    (new.id, 'Chef','chef', base || array['manage_recipes'], true),
    (new.id, 'Kitchen Staff','kitchen_staff', base, true),
    (new.id, 'Front of House','front_of_house', base, true)
  on conflict (business_id, name) do nothing;
  return new;
end $$;
drop trigger if exists trg_seed_business_roles on public.businesses;
create trigger trg_seed_business_roles after insert on public.businesses
  for each row execute function public.seed_business_roles();

-- Switch roles management from owner-string to the capability.
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
  using (business_id = public.get_my_business_id() and public.has_capability('manage_roles'))
  with check (business_id = public.get_my_business_id() and public.has_capability('manage_roles'));
```

- [ ] **Step 2: Apply** → `[]`.
- [ ] **Step 3: Verify has_capability returns the matrix** (impersonate one member per tier). Example for an owner and a chef of The Green Kitchen (business `d472de8e-2354-4a28-a184-e8a192dda023`):
  ```
  run_sql "begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where business_id='d472de8e-2354-4a28-a184-e8a192dda023' and role='chef' limit 1))::text, true); select has_capability('manage_recipes') should_be_true, has_capability('manage_checklists') should_be_false, has_capability('manage_billing') should_be_false; rollback;"
  ```
  Expect `t, f, f`. Repeat for an owner (all true) and kitchen_staff (`complete_checklists` true, `manage_recipes` false).
- [ ] **Step 4: Confirm mobile back-compat** — profiles.role unchanged after the trigger exists: `run_sql "select role, count(*) from profiles group by 1 order by 1;"` matches the pre-migration distribution (no NULLs, same 5 values).
- [ ] **Step 5: Commit** `... commit -m "rbac: has_capability() + role-text sync + new-business seed + roles_write on manage_roles"`

---

### Task 4: Verification gate (GO/NO-GO before the swap)

**Files:** none (queries only).

- [ ] **Step 1: Run the gate**
  ```
  run_sql "select
    (select count(*) from businesses b where b.deleted_at is null and (select count(*) from roles r where r.business_id=b.id)<>5) as biz_bad_presets,
    (select count(*) from profiles p join businesses b on b.id=p.business_id where b.deleted_at is null and p.role_id is null) as members_no_role,
    (select count(*) from roles r, unnest(r.capabilities) c where c not in (select cap from capability_catalog)) as bad_caps,
    (select count(*) from profiles p join roles r on r.id=p.role_id where p.role <> r.base_tier) as role_text_mismatch;"
  ```
  ALL must be `0`. Any non-zero → STOP and fix before the swap.

---

### Task 5: Swap RLS — role strings → has_capability()

**Files:** Create `supabase/migrations/20260714130300_rbac_rls_swap.sql`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: every role-gated policy checks `has_capability()`; all other predicates (business scope, `can_see_site_row`/`can_write_kitchen_row`, ownership) preserved verbatim.

Mapping (owner+manager→cap, owner+manager+chef→`manage_recipes`, owner→`view_documents` for documents-owner or `manage_sites` for sites):

- [ ] **Step 1: Write the migration**

```sql
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
  using (business_id = get_my_business_id() and has_capability('manage_recipes') and can_write_kitchen_row(site_id))
  with check (business_id = get_my_business_id() and has_capability('manage_recipes') and can_write_kitchen_row(site_id));

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

-- manage_suppliers (kitchen table — keep can_write_kitchen_row)
drop policy if exists "Managers can manage suppliers" on suppliers;
create policy "Managers can manage suppliers" on suppliers for all
  using (business_id = get_my_business_id() and has_capability('manage_suppliers') and can_write_kitchen_row(site_id))
  with check (business_id = get_my_business_id() and has_capability('manage_suppliers') and can_write_kitchen_row(site_id));

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
```

- [ ] **Step 2: Apply** → `[]`. If `error`, STOP — the transaction rolled back, prod unchanged.
- [ ] **Step 3: Confirm no policy still references get_my_role()**
  `run_sql "select tablename, policyname from pg_policies where schemaname='public' and (coalesce(qual,'') like '%get_my_role%' or coalesce(with_check,'') like '%get_my_role%');"` → **0 rows** (all role-string checks gone).
- [ ] **Step 4: Commit** `... commit -m "rbac: swap all role-gated RLS onto has_capability()"`

---

### Task 6: Behavior-equivalence verification (the acceptance bar)

**Files:** none.

- [ ] **Step 1: Per-tier access is unchanged.** For one representative member of each of the 5 tiers in a multi-member business, impersonate and assert visible/writable counts match a business-level expectation. Concretely, for each tier confirm `has_capability` gates align with a spot write-check on a key table (templates/recipes/suppliers/documents). Example (chef must NOT manage checklists but MUST manage recipes):
  ```
  run_sql "begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','<CHEF_UID>')::text, true);
    select has_capability('manage_recipes') recipes_ok, has_capability('manage_checklists') checklists_denied,
           (select count(*) from recipes) can_see_recipes; rollback;"
  ```
  Assert recipes_ok=t, checklists_denied=f. Do the analogous check for owner (all caps), manager (manage_checklists t, manage_sites f, manage_billing f, view_documents f), kitchen_staff (only baseline).
- [ ] **Step 2: documents access set preserved** — pick a business with documents at different `access_level`s; impersonate an owner and a manager and confirm the SELECT-visible document sets equal the pre-swap sets (owner sees all; manager sees `all`+`managers_only`+`custom`-granted, NOT `owner_only`).
- [ ] **Step 3: New-business trigger** — verify a business inserted (or the most recent one) has exactly the 5 presets and its owner profile has role_id→owner preset with `manage_billing`.
- [ ] **Step 4: profiles.role intact** — distribution matches pre-migration (Task 3 Step 4). Mobile unaffected.

If any check fails, apply the rollback (Task 7) and re-investigate.

---

### Task 7: Rollback migration (verbatim pre-swap policies) — write + parse-check only

**Files:** Create `docs/superpowers/rollbacks/2026-07-14-rbac-rls-ROLLBACK.sql` (OUTSIDE `supabase/migrations/`).

**Interfaces:** Emergency-only down-migration restoring the exact pre-swap role-string policies.

- [ ] **Step 1: Write the rollback** — recreate each policy from the "current policy inventory" captured in this plan's development (verbatim `get_my_role()` versions), dropping the `has_capability` versions first. Include a header: `-- ⚠️ EMERGENCY ROLLBACK — NOT A MIGRATION. Apply manually via Management API only.` Use the exact USING/CHECK text captured from `pg_policies` for: checklist_templates, checklist_template_items, four_weekly_reviews, notification_rules, checklist_completions(delete), recipes, recipe_ingredients, recipe_tags, ingredients, menu_items, tags, invites, profiles(update), training_records, suppliers, sites, documents(×5), document_access(×2). (The controller pastes the verbatim text from the Task-5 development snapshot; every restored predicate must byte-match the pre-swap version.)
- [ ] **Step 2: Parse-check WITHOUT applying** (swap trailing `commit;`→`rollback;`, same technique as the multisite rollback): body runs in a transaction that rolls back; expect `[]`, no `error`, and confirm the live swap is still intact afterward (`select count(*) from pg_policies where tablename='sites' and policyname='sites_write' and qual like '%has_capability%'` = 1).
- [ ] **Step 3: Commit** `git add docs/superpowers/rollbacks/2026-07-14-rbac-rls-ROLLBACK.sql && git commit -m "rbac: emergency rollback for the capability RLS swap (outside migrations/)"`

---

## Self-review notes

- **Spec coverage:** catalog (Task 1), presets = current behavior (Task 2, matrix in Global Constraints), `has_capability` + owner short-circuit + role-text sync for mobile (Task 3), new-business seed (Task 3), RLS swap preserving site-scope+ownership (Task 5), verification gate (Task 4) + behavior-equivalence (Task 6), additive rollout + rollback outside migrations/ (Tasks 1-3 additive, 7 rollback). incidents/deliveries deliberately untouched (Global Constraints). All spec sections map to a task.
- **Ordering safety:** additive schema+seed+functions (1-3) change no access; gate (4); swap (5) is the only behavior-touching step and is a no-op because presets == current behavior; verify (6); rollback ready (7).
- **Known nuance:** `documents` is the one non-trivial mapping (per-document `access_level` + `document_access`); Task 5 maps owner-string→`view_documents` and owner+manager-string→`manage_documents` to preserve exact sets — Task 6 Step 2 explicitly re-verifies documents visibility, since it's the highest-risk mapping.
- **Client untouched:** no `src/` changes in Phase 1; client keeps reading `profiles.role` (preserved). The `useCapabilities()` hook + removing `isManager` is Phase 3/4.
