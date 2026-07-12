# Multi-site hard per-site RLS isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `site_id` a real access boundary enforced by RLS — a member is locked to their `profiles.site_id`; only `is_group_admin` sees the whole estate.

**Architecture:** Additive-on-prod. First backfill every NULL `site_id` and add guard triggers, gate the rollout on a zero-NULL verification, add helper functions, then swap the business-level policies for site-scoped ones inside a transaction, with a verbatim rollback migration. App changes pin non-admins to their site and hide the switcher.

**Tech Stack:** Supabase Postgres (SQL migrations applied via the Supabase **Management API** query endpoint, not Vercel), Next.js/TypeScript app on branch `KNS/multisite`, zustand auth-store, supabase-js.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-multisite-rls-isolation-design.md`.
- **DB = production** (`rszrggreuarvodcqeqrj`); staging Vercel points at it. Every SQL step touches live data — no dropping/altering data, only backfilling NULLs and swapping policies.
- Access token: read from `~/Secrets/blueroll/supabase-access-token.txt` (an `sbp_…` token). Never inline it in files or commits.
- Apply SQL with this exact helper (send the JSON body directly; do NOT use `curl -f`, it swallows Postgres errors):
  ```bash
  apply_sql() { # $1 = path to .sql file
    local SBP; SBP=$(grep -oE "sbp_[A-Za-z0-9]+" ~/Secrets/blueroll/supabase-access-token.txt | head -1)
    python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' "$1" \
    | curl -s -m 60 -X POST "https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/database/query" \
        -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" --data @- ; echo
  }
  run_sql() { # $1 = inline SQL string
    local SBP; SBP=$(grep -oE "sbp_[A-Za-z0-9]+" ~/Secrets/blueroll/supabase-access-token.txt | head -1)
    python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1" \
    | curl -s -m 60 -X POST "https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/database/query" \
        -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" --data @- ; echo
  }
  ```
  A successful DDL/`do` block returns `[]`; a query returns a JSON array of rows; an error returns `{"error":...}` — treat any `error` key as failure.
- Isolated (compliance) tables: `checklist_templates`, `checklist_completions`, `checklist_instances`, `incidents`, `deliveries`, `diary_entries`, `staff_checkins`, `haccp_pack_data`, `haccp_signoffs`.
- Kitchen (shared-or-site) tables: `recipes`, `suppliers`.
- Untouched (group-wide): `documents`, `tags`, `ingredients`, `businesses`, `sites`, `profiles`, `invites`.
- Commit each migration `.sql` file to the repo for the record even though it is applied via the API.

---

### Task 1: Backfill NULL site_ids + guard triggers

**Files:**
- Create: `supabase/migrations/20260712100000_multisite_backfill_site_ids.sql`

**Interfaces:**
- Produces: every `profiles` row and every isolated-table row has a non-NULL `site_id`; trigger `set_site_id_default` + function `public.set_site_id_default()` on the 9 isolated tables.

- [ ] **Step 1: Write the migration**

```sql
-- Pre-flight for hard per-site RLS: eliminate NULL site_id so that a
-- `site_id = get_my_site_id()` predicate never hides a row/user, and stop new
-- NULLs. Deterministic backfill target = the business's OLDEST site.
set search_path = public;

-- Helper (inline CTE): the oldest site per business.
-- 1. profiles.site_id
update profiles p
set site_id = os.site_id
from (
  select distinct on (business_id) business_id, id as site_id
  from sites order by business_id, created_at asc
) os
where p.site_id is null and os.business_id = p.business_id;

-- 2. operational rows -> business's oldest site
do $$
declare t text;
begin
  foreach t in array array[
    'checklist_templates','checklist_completions','checklist_instances',
    'incidents','deliveries','diary_entries','staff_checkins',
    'haccp_pack_data','haccp_signoffs'
  ] loop
    execute format($f$
      update public.%1$I x
      set site_id = os.site_id
      from (
        select distinct on (business_id) business_id, id as site_id
        from public.sites order by business_id, created_at asc
      ) os
      where x.site_id is null and os.business_id = x.business_id
    $f$, t);
  end loop;
end $$;

-- 3. Guard: never accept a NULL site_id on an isolated table again.
-- Only fills when the caller has a home site; machine inserts that already carry
-- site_id are untouched (trigger no-ops when new.site_id is not null).
create or replace function public.set_site_id_default()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.site_id is null then
    new.site_id := public.get_my_site_id();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'checklist_templates','checklist_completions','checklist_instances',
    'incidents','deliveries','diary_entries','staff_checkins',
    'haccp_pack_data','haccp_signoffs'
  ] loop
    execute format('drop trigger if exists trg_site_id_default on public.%1$I', t);
    execute format('create trigger trg_site_id_default before insert on public.%1$I for each row execute function public.set_site_id_default()', t);
  end loop;
end $$;
```

- [ ] **Step 2: Apply it**

Run: `apply_sql supabase/migrations/20260712100000_multisite_backfill_site_ids.sql`
Expected: `[]` (no error key).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260712100000_multisite_backfill_site_ids.sql
git commit -m "multisite: backfill NULL site_ids + guard triggers (pre-flight for site RLS)"
```

---

### Task 2: Verification gate — assert zero NULL site_id

**Files:** none (query only).

**Interfaces:**
- Consumes: Task 1 applied.
- Produces: GO/NO-GO signal. The policy swap (Task 5/6) MUST NOT run unless this returns all zeros.

- [ ] **Step 1: Run the gate query**

Run:
```bash
run_sql "select 'profiles' t, count(*) nulls from profiles where site_id is null
union all select 'checklist_templates', count(*) from checklist_templates where site_id is null
union all select 'checklist_completions', count(*) from checklist_completions where site_id is null
union all select 'checklist_instances', count(*) from checklist_instances where site_id is null
union all select 'incidents', count(*) from incidents where site_id is null
union all select 'deliveries', count(*) from deliveries where site_id is null
union all select 'diary_entries', count(*) from diary_entries where site_id is null
union all select 'staff_checkins', count(*) from staff_checkins where site_id is null
union all select 'haccp_pack_data', count(*) from haccp_pack_data where site_id is null
union all select 'haccp_signoffs', count(*) from haccp_signoffs where site_id is null
order by 1;"
```
Expected: every `nulls` = `0`. **If any row is non-zero, STOP** — investigate why the backfill missed it (e.g. a business with no `sites` row) before proceeding.

---

### Task 3: Helper functions

**Files:**
- Create: `supabase/migrations/20260712100100_multisite_rls_helpers.sql`

**Interfaces:**
- Consumes: existing `get_my_site_id()`, `get_my_business_id()`.
- Produces: `am_i_group_admin() -> bool`, `can_see_site_row(uuid) -> bool`, `can_see_shared_row(uuid) -> bool`, `can_write_kitchen_row(uuid) -> bool`. Used by every policy in Tasks 4-5.

- [ ] **Step 1: Write the migration**

```sql
set search_path = public;

-- Group admin (owner / designated manager) bypasses site scoping.
create or replace function public.am_i_group_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_group_admin from public.profiles where id = auth.uid()), false)
$$;

-- Compliance visibility: my site, or I'm a group admin.
create or replace function public.can_see_site_row(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.am_i_group_admin()
      or p_site = (select site_id from public.profiles where id = auth.uid())
$$;

-- Kitchen visibility: shared (NULL) rows are visible to everyone in the group.
create or replace function public.can_see_shared_row(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_site is null or public.can_see_site_row(p_site)
$$;

-- Kitchen write: shared (NULL) rows only by a group admin; site rows by that site.
create or replace function public.can_write_kitchen_row(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_site is null then public.am_i_group_admin()
              else public.can_see_site_row(p_site) end
$$;

grant execute on function public.am_i_group_admin() to authenticated;
grant execute on function public.can_see_site_row(uuid) to authenticated;
grant execute on function public.can_see_shared_row(uuid) to authenticated;
grant execute on function public.can_write_kitchen_row(uuid) to authenticated;
```

- [ ] **Step 2: Apply it**

Run: `apply_sql supabase/migrations/20260712100100_multisite_rls_helpers.sql`
Expected: `[]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260712100100_multisite_rls_helpers.sql
git commit -m "multisite: RLS helper functions (am_i_group_admin, can_see_site_row, ...)"
```

---

### Task 4: Set up test users + pre-swap predicate validation

Validate the NEW predicate per-user **before** touching any policy, by running the
predicate inline while impersonating each user. This proves correctness with zero
risk (no policy is changed yet).

**Files:** none (uses The Green Kitchen demo, business `d472de8e-2354-4a28-a184-e8a192dda023`).

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: two non-admin test users pinned to two distinct sites, and a validated predicate.

- [ ] **Step 1: Pick two distinct sites + assign two non-admin test users**

Run (capture the two site ids and two user ids printed):
```bash
run_sql "select id, name, created_at from sites where business_id='d472de8e-2354-4a28-a184-e8a192dda023' order by created_at limit 3;"
run_sql "select id, full_name, role, is_group_admin, site_id from profiles where business_id='d472de8e-2354-4a28-a184-e8a192dda023' and is_group_admin=false order by full_name limit 5;"
```
Choose site A = the oldest, site B = a different one. Pin the two demo kitchen-staff (`Camden`, `clapham`) to A and B respectively:
```bash
run_sql "update profiles set site_id='<SITE_A>' where full_name='Camden' and business_id='d472de8e-2354-4a28-a184-e8a192dda023';"
run_sql "update profiles set site_id='<SITE_B>' where full_name='clapham' and business_id='d472de8e-2354-4a28-a184-e8a192dda023';"
run_sql "select id, full_name, site_id from profiles where full_name in ('Camden','clapham') and business_id='d472de8e-2354-4a28-a184-e8a192dda023';"
```
Record `USER_A` = Camden's id (site A), `USER_B` = clapham's id (site B).

- [ ] **Step 2: Validate the predicate as USER_A (should see only site A)**

Run (RLS test pattern: switch to the `authenticated` role and set the JWT sub, inside one transaction):
```bash
run_sql "begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','<USER_A>')::text, true);
select count(*) total,
       count(*) filter (where site_id <> '<SITE_A>') leaked
from checklist_completions
where business_id = '<GREEN_KITCHEN_BID>' and can_see_site_row(site_id);
rollback;"
```
Replace `<GREEN_KITCHEN_BID>` = `d472de8e-2354-4a28-a184-e8a192dda023`.
Expected: `leaked = 0` (USER_A sees no other site through the new predicate).

- [ ] **Step 3: Validate a group admin sees all sites**

Run (use any `is_group_admin=true` user id in this business — e.g. Emma Taylor; fetch it first):
```bash
run_sql "select id, full_name from profiles where business_id='d472de8e-2354-4a28-a184-e8a192dda023' and is_group_admin limit 1;"
run_sql "begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','<ADMIN_UID>')::text, true);
select count(distinct site_id) sites_seen
from checklist_completions
where business_id='d472de8e-2354-4a28-a184-e8a192dda023' and can_see_site_row(site_id);
rollback;"
```
Expected: `sites_seen > 1` (admin sees multiple sites).

If Steps 2-3 don't match expectations, STOP and fix the helpers before swapping.

---

### Task 5: Swap policies — compliance tables

**Files:**
- Create: `supabase/migrations/20260712100200_multisite_site_rls_compliance.sql`

**Interfaces:**
- Consumes: helpers from Task 3, validation from Task 4.
- Produces: site-scoped RLS on the 9 compliance tables.

- [ ] **Step 1: Write the migration** (drops each existing policy by its exact current name, recreates site-scoped)

```sql
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
```

- [ ] **Step 2: Apply it**

Run: `apply_sql supabase/migrations/20260712100200_multisite_site_rls_compliance.sql`
Expected: `[]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260712100200_multisite_site_rls_compliance.sql
git commit -m "multisite: site-scoped RLS on compliance tables"
```

---

### Task 6: Swap policies — kitchen (recipes, suppliers)

**Files:**
- Create: `supabase/migrations/20260712100300_multisite_site_rls_kitchen.sql`

**Interfaces:**
- Consumes: helpers from Task 3.
- Produces: shared-or-site RLS on `recipes` and `suppliers`.

- [ ] **Step 1: Write the migration**

```sql
set search_path = public;
begin;

-- recipes: NULL site_id = shared (all sites can see); else own site or admin.
drop policy if exists "Business members can view recipes" on recipes;
create policy "Business members can view recipes" on recipes
  for select using (business_id = get_my_business_id() and can_see_shared_row(site_id));
drop policy if exists "Chefs can manage recipes" on recipes;
create policy "Chefs can manage recipes" on recipes
  for all using (business_id = get_my_business_id() and get_my_role() = any (array['owner','manager','chef']) and can_write_kitchen_row(site_id))
  with check (business_id = get_my_business_id() and get_my_role() = any (array['owner','manager','chef']) and can_write_kitchen_row(site_id));

-- suppliers
drop policy if exists "Business members can view suppliers" on suppliers;
create policy "Business members can view suppliers" on suppliers
  for select using (business_id = get_my_business_id() and can_see_shared_row(site_id));
drop policy if exists "Managers can manage suppliers" on suppliers;
create policy "Managers can manage suppliers" on suppliers
  for all using (business_id = get_my_business_id() and get_my_role() = any (array['owner','manager']) and can_write_kitchen_row(site_id))
  with check (business_id = get_my_business_id() and get_my_role() = any (array['owner','manager']) and can_write_kitchen_row(site_id));

commit;
```

- [ ] **Step 2: Apply it**

Run: `apply_sql supabase/migrations/20260712100300_multisite_site_rls_kitchen.sql`
Expected: `[]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260712100300_multisite_site_rls_kitchen.sql
git commit -m "multisite: shared-or-site RLS on recipes + suppliers"
```

---

### Task 7: Post-swap verification (real RLS + no-op check)

**Files:** none.

**Interfaces:**
- Consumes: Tasks 5-6 applied.
- Produces: proof that isolation holds and single-site businesses are unchanged.

- [ ] **Step 1: Isolation holds for a real (policy-driven) read as USER_A**

Run (note: NO manual predicate now — RLS itself must filter):
```bash
run_sql "begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','<USER_A>')::text, true);
select count(*) total, count(*) filter (where site_id <> '<SITE_A>') leaked from checklist_completions;
rollback;"
```
Expected: `leaked = 0`. Repeat for `incidents`, `deliveries`, `checklist_templates` (same shape).

- [ ] **Step 2: Group admin still sees the whole estate**

Run the same block with `<ADMIN_UID>` and assert `select count(distinct site_id)` on `checklist_completions` `> 1`.

- [ ] **Step 3: Single-site business is a strict no-op**

Pick a single-site real business and one of its non-admin members; assert their visible row counts equal the raw business totals:
```bash
run_sql "select b.id, b.name, count(distinct s.id) sites from businesses b join sites s on s.business_id=b.id group by 1,2 having count(distinct s.id)=1 limit 1;"
# then pick a member uid of that business and compare:
run_sql "begin; set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','<SINGLE_SITE_MEMBER_UID>')::text, true);
select (select count(*) from checklist_completions) as visible; rollback;"
run_sql "select count(*) as raw from checklist_completions where business_id='<SINGLE_SITE_BID>';"
```
Expected: `visible == raw` (isolation changed nothing for single-site).

- [ ] **Step 4: Kitchen shared rows visible to a site user; only admin can edit them**

```bash
run_sql "begin; set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','<USER_A>')::text, true);
select count(*) as shared_visible from recipes where site_id is null and business_id='d472de8e-2354-4a28-a184-e8a192dda023'; rollback;"
```
Expected: `shared_visible` = the count of shared recipes (USER_A sees shared kitchen).

If any check fails, run Task 8 (rollback) and re-investigate.

---

### Task 8: Rollback migration (verbatim old policies) — write + parse-check only

**Files:**
- Create: `supabase/migrations/20260712100400_multisite_site_rls_ROLLBACK.sql`

**Interfaces:**
- Consumes: nothing at runtime.
- Produces: an emergency down-migration restoring the exact pre-swap policies. Applied ONLY if a problem is found.

- [ ] **Step 1: Write the rollback (restores the exact policies captured before the swap)**

```sql
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
```

- [ ] **Step 2: Parse-check the rollback WITHOUT applying it**

Wrap it in a transaction that rolls back, so nothing changes but any SQL error surfaces:
```bash
SBP=$(grep -oE "sbp_[A-Za-z0-9]+" ~/Secrets/blueroll/supabase-access-token.txt | head -1)
python3 -c 'import json;body=open("supabase/migrations/20260712100400_multisite_site_rls_ROLLBACK.sql").read().replace("commit;","rollback;");print(json.dumps({"query":body}))' \
| curl -s -m 60 -X POST "https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/database/query" -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" --data @- ; echo
```
Expected: `[]` (parses + runs, then rolls back — no error key). Do NOT apply the real (`commit;`) version unless rolling back for real.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260712100400_multisite_site_rls_ROLLBACK.sql
git commit -m "multisite: emergency rollback migration for site RLS (verbatim pre-swap policies)"
```

---

### Task 9: App — pin non-admins to their home site

**Files:**
- Modify: `src/hooks/use-auth.ts:87-94`

**Interfaces:**
- Consumes: `profile.is_group_admin`, `profile.site_id`, `siteList`.
- Produces: `currentSiteId` forced to `profile.site_id` for non-admins (ignores persisted/switcher).

- [ ] **Step 1: Replace the site-selection block**

Replace lines 87-94 (`const persisted = readPersistedSite()` … `store.setCurrentSiteId(active)`) with:

```ts
      let active: string | null
      if (profile.is_group_admin) {
        const persisted = readPersistedSite()
        active = useAuthStore.getState().currentSiteId
        if (!active || !siteList.some((s) => s.id === active)) {
          if (persisted && siteList.some((s) => s.id === persisted)) active = persisted
          else active = siteList.length > 1 ? null : (siteList[0]?.id ?? null)
        }
      } else {
        // Non-admins are hard-locked to their home site — RLS enforces this;
        // the store must match so the UI never shows an empty "other site".
        active = profile.site_id ?? siteList[0]?.id ?? null
      }
      store.setCurrentSiteId(active)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "use-auth.ts" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-auth.ts
git commit -m "multisite: pin non-admin users to their home site (ignore switcher/persisted)"
```

---

### Task 10: App — switcher is admin-only; static site label for non-admins

**Files:**
- Modify: `src/components/layout/topbar.tsx:32` and the switcher block around `:90-124`

**Interfaces:**
- Consumes: `profile?.is_group_admin`, `sites`, `currentSiteId`.
- Produces: interactive switcher only for group admins; non-admin multi-site users see a read-only chip of their site name.

- [ ] **Step 1: Add an admin-only switch gate**

At `topbar.tsx:32`, below `const multiSite = sites.length > 1 && !pathname?.startsWith('/settings')`, add:

```ts
  const canSwitchSites = multiSite && !!profile?.is_group_admin
```

- [ ] **Step 2: Gate the interactive switcher, add a static label fallback**

Change the switcher wrapper condition from `{multiSite && (` to `{canSwitchSites && (`. Immediately after that switcher block's closing `)}`, add a read-only chip for locked non-admins:

```tsx
          {multiSite && !canSwitchSites && currentSite && (
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] font-medium text-foreground">
              <Building2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
              <span className="max-w-[160px] truncate">{currentSite.name}</span>
            </div>
          )}
```

(`Building2` is already imported — it's used in the switcher menu.)

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit 2>&1 | grep "topbar.tsx" || echo "clean"` → `clean`
Run: `npx vitest run` → all pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/topbar.tsx
git commit -m "multisite: site switcher is group-admin only; static site chip for locked members"
```

---

### Task 11: App — stamp site_id on operational writes (currentSiteId)

The DB guard trigger backfills a non-admin's writes to their single site, but a
**group admin** viewing Site B must write to Site B, not their home site. Set
`site_id = currentSiteId` on the operational create paths so admin writes land on
the viewed site.

**Files (audit each; add `site_id: currentSiteId` to the insert payload where missing):**
- `src/app/(dashboard)/incidents/page.tsx`
- `src/app/(dashboard)/deliveries/new/page.tsx`
- `src/app/(dashboard)/diary/page.tsx`
- `src/app/(dashboard)/checklists/new/page.tsx` and `src/app/(dashboard)/checklists/edit/[id]/page.tsx` (templates)
- staff check-in path (search: `from('staff_checkins').insert`)
- HACCP pack save path (search: `from('haccp_pack_data')`, `from('haccp_signoffs')`)

**Interfaces:**
- Consumes: `useAuthStore((s) => s.currentSiteId)`.
- Produces: every operational insert includes `site_id`.

- [ ] **Step 1: Find every operational insert missing site_id**

Run:
```bash
cd ~/HACCP/web
grep -rn "from('incidents')\|from('deliveries')\|from('diary_entries')\|from('checklist_templates')\|from('staff_checkins')\|from('haccp_pack_data')\|from('haccp_signoffs')" src/app | grep -i "insert"
```
For each hit, confirm whether the inserted object already sets `site_id`.

- [ ] **Step 2: Add `site_id: currentSiteId` to each insert payload that lacks it**

In each file, ensure `currentSiteId` is read from the store
(`const currentSiteId = useAuthStore((s) => s.currentSiteId)`), and add
`site_id: currentSiteId,` to the `.insert({ … })` object. Example pattern
(incidents):

```ts
const { error } = await supabase.from('incidents').insert({
  business_id: business.id,
  site_id: currentSiteId,        // <-- add: write to the viewed site
  reported_by: profile.id,
  // …existing fields…
})
```

Leave `checklist_completions` alone — it already stamps `site_id` (commit `74d5817`).

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit 2>&1 | grep -E "incidents|deliveries|diary|checklists|haccp" || echo "clean"` → `clean`
Run: `npx vitest run` → all pass.

- [ ] **Step 4: Commit**

```bash
git add src/app
git commit -m "multisite: stamp site_id (currentSiteId) on operational writes"
```

---

### Task 12: Deploy + end-to-end verification on staging

**Files:** none.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a deployed preview + human sign-off.

- [ ] **Step 1: Push + deploy**

```bash
cd ~/HACCP/web
git push origin KNS/multisite
npx vercel deploy --yes 2>&1 | grep -oE "https://web-[a-z0-9]+-knstntn24s-projects.vercel.app" | head -1
```

- [ ] **Step 2: Verify the bundle built and points at the clean prod DB**

Fetch the login route with the bypass and confirm `rszrggreuarvodcqeqrj.supabase.co` (no trailing `\n`) is in the chunks (same check used previously).

- [ ] **Step 3: Human verification checklist (hand to Kostya with the bypass link)**

- Log in as a **non-admin** demo user pinned to Site A → topbar shows a static Site-A chip (no switcher); checklists/incidents/etc. show only Site-A data.
- Log in as a **group admin** → switcher present with "All sites" + every site; estate dashboard shows all.
- Log in to a **single-site real client** → nothing changed.
- Shared recipes visible to the non-admin; edit blocked for non-admin, allowed for admin.

- [ ] **Step 4: Update memory**

Mark the RLS-isolation feature as shipped in
`~/.claude/projects/-Users-knstntn/memory/blueroll-multisite-web.md`, including the
rollback migration path.

---

## Self-review notes

- **Spec coverage:** visibility rule (Task 3), table matrix compliance (Task 5) + kitchen (Task 6), pre-flight cleanup + guard + verification gate (Tasks 1-2), app lock + switcher + write-stamping (Tasks 9-11), rollout order + rollback (Tasks 1-8), testing on Green Kitchen + single-site no-op (Tasks 4,7,12), blast-radius no-op assertion (Task 7 Step 3). All spec sections map to a task.
- **Ordering safety:** data cleanup + guard (1) → gate (2) → helpers (3) → validate predicate with zero risk (4) → swap (5,6) → verify real RLS (7) → rollback ready (8). App (9-11) is safe in any order relative to the swap because single-site clients are a no-op and RLS is the true boundary.
- **Known follow-up (not blocking):** the `checklist_instances` generator (report-due RPC) should copy `site_id` from its template so future machine-generated instances are never NULL; the guard trigger no-ops on NULL when there's no user context. Verify during Task 11 Step 1 and fix if the RPC inserts without `site_id`.
