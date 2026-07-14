# RBAC Phase 2 — Multi-site membership — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single `profiles.site_id` with `member_sites` (M:N); `can_see_site_row()` checks membership; `profiles.site_id` kept as a synced primary. Behavior-preserving (1 site each until Phase 4).

**Architecture:** Additive-on-prod. Add `member_sites` + backfill 1:1 + a primary-site trigger (no access change), gate, then one `create or replace can_see_site_row` swap (a no-op because membership == the old single site for everyone). A small behavior-neutral web-client change makes the switcher membership-aware.

**Tech Stack:** Supabase Postgres (SQL via Management API, NOT CLI), Next.js client, worktree `~/HACCP/web-integrate`, branch `KNS/multisite-rls`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-rbac-phase2-multisite-membership-design.md`.
- **DB = shared production** `rszrggreuarvodcqeqrj`; additive until the gated swap.
- Token from `~/Secrets/blueroll/supabase-access-token.txt`; never inline. Apply helper (Bash with `dangerouslyDisableSandbox: true`):
  ```bash
  apply_sql() { local SBP; SBP=$(grep -oE "sbp_[A-Za-z0-9]+" ~/Secrets/blueroll/supabase-access-token.txt | head -1)
    python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' "$1" | curl -s -m 60 -X POST "https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/database/query" -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" --data @- ; echo ; }
  run_sql()  { local SBP; SBP=$(grep -oE "sbp_[A-Za-z0-9]+" ~/Secrets/blueroll/supabase-access-token.txt | head -1)
    python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1" | curl -s -m 60 -X POST "https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/database/query" -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" --data @- ; echo ; }
  ```
  Success = `[]`; any `"error"` = FAILURE (stop, report, do not improvise).
- `is_group_admin=true` = whole estate (bypass, no member_sites rows). Group admins get NO member_sites rows.
- Do NOT touch: the capability policies (Phase 1), the paywall RESTRICTIVE policies, kitchen business-level policies. Only `can_see_site_row` changes (kitchen `can_see_shared_row`/`can_write_kitchen_row` delegate to it and inherit automatically — do NOT edit them).
- Commit each migration; rollback lives OUTSIDE `supabase/migrations/`.

---

### Task 1: member_sites table + backfill + primary-site trigger

**Files:** Create `supabase/migrations/20260714140000_member_sites.sql`

**Interfaces:** Produces `public.member_sites`, backfilled 1:1 from `profiles.site_id` (non-admins), and trigger `keep_primary_site`.

- [ ] **Step 1: Write the migration**

```sql
set search_path = public;

create table if not exists public.member_sites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  site_id    uuid not null references public.sites(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, site_id)
);
create index if not exists idx_member_sites_profile on public.member_sites(profile_id);
create index if not exists idx_member_sites_site on public.member_sites(site_id);
alter table public.member_sites enable row level security;

drop policy if exists member_sites_select on public.member_sites;
create policy member_sites_select on public.member_sites for select to authenticated
  using (exists (select 1 from public.sites s where s.id = member_sites.site_id and s.business_id = public.get_my_business_id()));
drop policy if exists member_sites_write on public.member_sites;
create policy member_sites_write on public.member_sites for all to authenticated
  using (exists (select 1 from public.sites s where s.id = member_sites.site_id and s.business_id = public.get_my_business_id()) and public.has_capability('manage_team'))
  with check (exists (select 1 from public.sites s where s.id = member_sites.site_id and s.business_id = public.get_my_business_id()) and public.has_capability('manage_team'));

-- Backfill 1:1: each non-admin with a home site gets one membership row.
insert into public.member_sites (profile_id, site_id)
select id, site_id from public.profiles
where site_id is not null and is_group_admin = false
on conflict do nothing;

-- Keep profiles.site_id (primary) consistent with membership.
create or replace function public.keep_primary_site()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- first site becomes the primary if none set
    update public.profiles p set site_id = new.site_id
    where p.id = new.profile_id and p.site_id is null;
  elsif tg_op = 'DELETE' then
    -- if the removed site was the primary, repoint to any remaining membership
    update public.profiles p
    set site_id = (select ms.site_id from public.member_sites ms where ms.profile_id = old.profile_id order by ms.created_at limit 1)
    where p.id = old.profile_id and p.site_id = old.site_id;
  end if;
  return null;
end $$;
drop trigger if exists trg_keep_primary_site on public.member_sites;
create trigger trg_keep_primary_site after insert or delete on public.member_sites
  for each row execute function public.keep_primary_site();
```

- [ ] **Step 2: Apply** → `[]`.
- [ ] **Step 3: Verify** `run_sql "select (select count(*) from member_sites) rows, (select count(*) from profiles where site_id is not null and is_group_admin=false) expected_nonadmin_with_site, (select count(*) from member_sites ms join sites s on s.id=ms.site_id join profiles p on p.id=ms.profile_id where s.business_id<>p.business_id) cross_business;"` → `rows == expected_nonadmin_with_site`, `cross_business = 0`.
- [ ] **Step 4: Commit** `git add supabase/migrations/20260714140000_member_sites.sql && git commit -m "rbac phase2: member_sites M:N + 1:1 backfill + primary-site trigger"`

---

### Task 2: Verification gate

**Files:** none.

- [ ] **Step 1: Run the gate**
  ```
  run_sql "select
    (select count(*) from profiles p where p.site_id is not null and p.is_group_admin=false and not exists (select 1 from member_sites ms where ms.profile_id=p.id and ms.site_id=p.site_id)) as nonadmin_missing_membership,
    (select count(*) from member_sites ms join sites s on s.id=ms.site_id join profiles p on p.id=ms.profile_id where s.business_id<>p.business_id) as cross_business_rows;"
  ```
  BOTH must be `0`. Non-zero → STOP.

---

### Task 3: Swap can_see_site_row to membership

**Files:** Create `supabase/migrations/20260714140100_can_see_site_row_membership.sql`

**Interfaces:** Redefines `can_see_site_row`; kitchen helpers inherit automatically.

- [ ] **Step 1: Write the migration**

```sql
set search_path = public;
create or replace function public.can_see_site_row(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.am_i_group_admin()
      or exists (select 1 from public.member_sites ms where ms.profile_id = auth.uid() and ms.site_id = p_site)
$$;
```

- [ ] **Step 2: Apply** → `[]`.
- [ ] **Step 3: Verify the new body is live** `run_sql "select pg_get_functiondef((select oid from pg_proc where proname='can_see_site_row')) like '%member_sites%' as uses_membership;"` → `true`.
- [ ] **Step 4: Commit** `... commit -m "rbac phase2: can_see_site_row checks member_sites (kitchen helpers inherit)"`

---

### Task 4: Behavior-equivalence verification

**Files:** none. (Resolve any uid with a PLAIN select BEFORE `set local role authenticated` — RLS nulls a subquery run after the role switch.)

- [ ] **Step 1: A non-admin's site-scoped visibility is unchanged.** Pick a non-admin at a site (e.g. Camden `75155250-5e22-4614-afe1-4fd11c545087`, site `86c030c3-f52b-4a89-8de9-3f9db1daf45f`, business `d472de8e-2354-4a28-a184-e8a192dda023`):
  ```
  run_sql "begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','75155250-5e22-4614-afe1-4fd11c545087')::text, true);
    select count(*) total, count(*) filter (where site_id <> '86c030c3-f52b-4a89-8de9-3f9db1daf45f') leaked from checklist_completions; rollback;"
  ```
  Expect `leaked = 0` and `total` equal to the pre-Phase-2 value (same as the multisite verification). Repeat on `incidents`.
- [ ] **Step 2: Group admin still sees all sites** — impersonate a group admin, `select count(distinct site_id) from checklist_completions` > 1.
- [ ] **Step 3: M:N proven** — add a SECOND membership for the test member, confirm the second site's rows become visible, then REMOVE it:
  ```
  run_sql "insert into member_sites(profile_id, site_id) values ('75155250-5e22-4614-afe1-4fd11c545087','<SITE_B>') on conflict do nothing;"
  # impersonate, expect rows from SITE_B now visible
  run_sql "delete from member_sites where profile_id='75155250-5e22-4614-afe1-4fd11c545087' and site_id='<SITE_B>';"
  ```
  Confirm after delete the member is back to only their primary site (and `profiles.site_id` unchanged since the primary was not the deleted one).
- [ ] **Step 4: profiles.site_id distribution unchanged** for all members (mobile back-compat): compare `select count(*) from profiles where site_id is not null` before/after — unchanged.

If any check fails, apply the rollback (Task 5).

---

### Task 5: Rollback file (verbatim single-site can_see_site_row) — write + parse-check

**Files:** Create `docs/superpowers/rollbacks/2026-07-14-rbac-phase2-ROLLBACK.sql` (OUTSIDE `supabase/migrations/`).

- [ ] **Step 1: Write the rollback** (restores the pre-swap single-site version verbatim):

```sql
-- ⚠️ EMERGENCY ROLLBACK — NOT A MIGRATION. Reverts can_see_site_row to the single
-- profiles.site_id version (undoes Phase 2 membership). member_sites table + trigger
-- are left in place (harmless once the function ignores them). Apply manually only.
create or replace function public.can_see_site_row(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.am_i_group_admin()
      or p_site = (select site_id from public.profiles where id = auth.uid())
$$;
```

- [ ] **Step 2: Parse-check WITHOUT persisting** (wrap in a rolled-back transaction):
  ```bash
  SBP=$(grep -oE "sbp_[A-Za-z0-9]+" ~/Secrets/blueroll/supabase-access-token.txt | head -1)
  python3 -c 'import json;b=open("docs/superpowers/rollbacks/2026-07-14-rbac-phase2-ROLLBACK.sql").read();print(json.dumps({"query":"begin; "+b+" rollback;"}))' | curl -s -m 60 -X POST "https://api.supabase.com/v1/projects/rszrggreuarvodcqeqrj/database/query" -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" --data @- ; echo
  ```
  Expect `[]` (parses + rolls back). Then confirm the live function still uses membership: `run_sql "select pg_get_functiondef((select oid from pg_proc where proname='can_see_site_row')) like '%member_sites%';"` → true.
- [ ] **Step 3: Commit** `git add docs/superpowers/rollbacks/2026-07-14-rbac-phase2-ROLLBACK.sql && git commit -m "rbac phase2: rollback for can_see_site_row membership swap"`

---

### Task 6: Web client — membership-aware switcher (behavior-neutral)

**Files:** Modify `src/stores/auth-store.ts`, `src/hooks/use-auth.ts`, `src/components/layout/topbar.tsx`.

**Interfaces:** Consumes `member_sites`. Produces `accessibleSites` in the store; the topbar switcher offers a member's accessible sites. Behavior-neutral today (every member has one accessible site).

- [ ] **Step 1: auth-store — add accessible-site ids**

In `src/stores/auth-store.ts`, add to the state: `memberSiteIds: string[]` (default `[]`), plus `setMemberSiteIds: (ids: string[]) => void`. Wire the setter and include it in `reset()` (→ `[]`).

- [ ] **Step 2: use-auth — load member_sites**

In `src/hooks/use-auth.ts`, after `store.setSites(siteList)` (~line 86), add:
```ts
      // Phase 2: the member's accessible sites (group admins see all).
      if (profile.is_group_admin) {
        store.setMemberSiteIds(siteList.map((s) => s.id))
      } else {
        const { data: ms } = await supabase.from('member_sites').select('site_id').eq('profile_id', profile.id)
        store.setMemberSiteIds((ms ?? []).map((r: { site_id: string }) => r.site_id))
      }
```
Leave the existing `currentSiteId` init as-is (non-admin still defaults to `profile.site_id`, which is one of their member sites).

- [ ] **Step 3: topbar — switcher over accessible sites**

In `src/components/layout/topbar.tsx`, read `memberSiteIds` from the store, and compute the accessible list:
```ts
  const memberSiteIds = useAuthStore((s) => s.memberSiteIds)
  const accessibleSites = profile?.is_group_admin ? sites : sites.filter((s) => memberSiteIds.includes(s.id))
```
Change `multiSite` to use `accessibleSites.length > 1` and `canSwitchSites` to `multiSite && (!!profile?.is_group_admin || accessibleSites.length > 1)`. Render the site list from `accessibleSites` (not `sites`). Keep the "All sites" option only for `profile?.is_group_admin`. The read-only single-site chip path is unchanged. (Net effect today: every non-admin has one accessible site → no visible change; a group admin is unchanged.)

- [ ] **Step 4: Typecheck + tests** `npx tsc --noEmit 2>&1 | grep -E "auth-store|use-auth|topbar" || echo clean` → clean; `npx vitest run` → pass.
- [ ] **Step 5: Commit** `git add src/stores/auth-store.ts src/hooks/use-auth.ts src/components/layout/topbar.tsx && git commit -m "rbac phase2: switcher offers a member's accessible sites (behavior-neutral until Phase 4)"`

---

## Self-review notes

- **Spec coverage:** member_sites (Task 1), backfill 1:1 + primary trigger (Task 1), gate (Task 2), can_see_site_row → membership with kitchen helpers inheriting (Task 3), behavior-equivalence + M:N proof + mobile back-compat (Task 4), additive rollout + rollback outside migrations/ (Tasks 1-3 additive, 5 rollback), client switcher membership-aware (Task 6). All spec sections map to a task.
- **Ordering safety:** additive table+backfill+trigger (1) change no access; gate (2); the single `create or replace can_see_site_row` (3) is the only behavior-touching step and is a no-op because membership == the old single site; verify (4); rollback ready (5); client (6) is behavior-neutral.
- **Do NOT edit** `can_see_shared_row`/`can_write_kitchen_row` — they call `can_see_site_row` and inherit the change; editing them risks drift.
- **Group admins** intentionally have zero member_sites rows (they bypass); the client gives them all sites via the `is_group_admin` branch.
