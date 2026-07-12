# Account / Business Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make business deletion owner-only, soft (30-day recoverable), and authenticated — so a second-level member (or anyone with a `businessId`) can no longer wipe a restaurant's data.

**Architecture:** Deletion becomes a two-phase soft-delete. An authenticated edge function verifies the caller is the owner of the target business and sets `businesses.deleted_at` (never a client write). RLS hides soft-deleted businesses immediately; a daily `pg_cron` job physically purges data older than 30 days. The mobile delete button is gated to owners; the legacy unauthenticated `delete` action is removed.

**Tech Stack:** Supabase Postgres (RLS, pg_cron), Deno edge functions (`@supabase/supabase-js@2`), Flutter (Riverpod). Project ref `rszrggreuarvodcqeqrj`.

## Global Constraints

- Only `role = 'owner'` may delete a business. Second-level roles (`manager`, `chef`, `front_of_house`, `kitchen_staff`) have no delete path.
- Deletion is **soft**: set `businesses.deleted_at`; physical wipe happens **30 days** later.
- `businesses.deleted_at` is **not client-writable** — only server (service-role / SECURITY DEFINER) may set or clear it.
- The delete edge function MUST authenticate the caller (no `--no-verify-jwt`) and verify ownership from the DB, never trusting `businessId`/`userId` in the body.
- Restore is via support (manual clear of `deleted_at`); no self-serve restore.
- Supabase access token for migrations/SQL tests: `~/Secrets/blueroll/supabase-access-token.txt` → run SQL via `web/scripts/sql-api.sh <file.sql>` (set `SUPABASE_ACCESS_TOKEN` first).
- All work on a fresh branch `KNS/account-deletion` off `main` (do NOT touch the untracked multisite migration on `KNS/multisite`).

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Create the branch off main without disturbing multisite work**

The two untracked files (`docs/superpowers/specs/2026-07-12-account-deletion-design.md`, `supabase/migrations/20260712100000_multisite_backfill_site_ids.sql`) are untracked and will travel with the checkout. Create the branch from `main`, then add ONLY deletion files.

Run:
```bash
cd ~/HACCP/web
git stash -u                 # park untracked files safely
git checkout main
git checkout -b KNS/account-deletion
git stash pop                # restore untracked files onto new branch
```
Expected: on `KNS/account-deletion`; `git status` shows the two untracked files, no tracked modifications.

- [ ] **Step 2: Commit the already-written spec**

```bash
cd ~/HACCP/web
git add docs/superpowers/specs/2026-07-12-account-deletion-design.md docs/superpowers/plans/2026-07-12-account-deletion.md
git commit -m "docs: account deletion design + plan"
```
Do NOT `git add` the multisite migration — leave it untracked for the multisite branch.

---

### Task 1: DB — `deleted_at` column, client-write protection, hide soft-deleted

**Files:**
- Create: `supabase/migrations/20260712140000_business_soft_delete.sql`
- Test: `supabase/tests/soft_delete_column.sql` (run via `scripts/sql-api.sh`)

**Interfaces:**
- Produces: `businesses.deleted_at timestamptz` (null = live). SELECT of `businesses` returns rows only where `deleted_at IS NULL` for `authenticated`/`anon`. `authenticated`/`anon` cannot UPDATE `deleted_at`.

- [ ] **Step 1: Write the failing SQL test**

Create `supabase/tests/soft_delete_column.sql`:
```sql
-- Test A: column exists
do $$ begin
  assert (select count(*) from information_schema.columns
          where table_name='businesses' and column_name='deleted_at') = 1,
    'deleted_at column missing';
end $$;

-- Test B: a normal authenticated owner CANNOT set deleted_at directly (revoked)
-- and CANNOT see a soft-deleted business via RLS.
do $$
declare v_biz uuid; v_uid uuid; v_visible int;
begin
  -- pick a throwaway business + its owner
  select b.id, p.id into v_biz, v_uid
  from businesses b join profiles p on p.business_id=b.id and p.role='owner'
  where b.name='Android Test Restaurant' limit 1;

  -- soft-delete it as SERVER (allowed)
  update businesses set deleted_at = now() where id = v_biz;

  -- become the owner (normal user)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  set local role authenticated;

  -- RLS must hide it
  select count(*) into v_visible from businesses where id = v_biz;
  assert v_visible = 0, 'soft-deleted business still visible to owner via RLS';

  -- client must NOT be able to clear deleted_at (revoked UPDATE on column)
  begin
    update businesses set deleted_at = null where id = v_biz;
    assert false, 'authenticated was able to write deleted_at';
  exception when insufficient_privilege then null;  -- expected
  end;

  reset role;
  perform set_config('request.jwt.claims', null, true);
  update businesses set deleted_at = null where id = v_biz;  -- cleanup
end $$;
select 'ALL PASS' as result;
```

- [ ] **Step 2: Run the test, verify it fails**

Run:
```bash
cd ~/HACCP/web && export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt)
bash scripts/sql-api.sh supabase/tests/soft_delete_column.sql
```
Expected: error like `column "deleted_at" ... does not exist` / assertion failure.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260712140000_business_soft_delete.sql`:
```sql
-- Soft-delete support for businesses
alter table public.businesses add column if not exists deleted_at timestamptz;

-- Clients (authenticated/anon) must never write deleted_at directly.
revoke update (deleted_at) on public.businesses from authenticated, anon;

-- Hide soft-deleted businesses from normal users. Rewrite the SELECT policy
-- to also require deleted_at IS NULL. (Service role bypasses RLS → support can
-- still see and restore.)
drop policy if exists "Users can view own business" on public.businesses;
create policy "Users can view own business" on public.businesses
  for select using (id = public.get_my_business_id() and deleted_at is null);
```

- [ ] **Step 4: Apply the migration to the live DB**

Run:
```bash
cd ~/HACCP/web && export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt)
bash scripts/sql-api.sh supabase/migrations/20260712140000_business_soft_delete.sql
```
Expected: `[]` (no error).

- [ ] **Step 5: Run the test, verify it passes**

Run:
```bash
bash scripts/sql-api.sh supabase/tests/soft_delete_column.sql
```
Expected: `[{"result":"ALL PASS"}]`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260712140000_business_soft_delete.sql supabase/tests/soft_delete_column.sql
git commit -m "feat(db): businesses.deleted_at soft-delete + hide + client-write protection"
```

---

### Task 2: DB — purge function + daily pg_cron job

**Files:**
- Create: `supabase/migrations/20260712140100_purge_deleted_businesses.sql`
- Test: `supabase/tests/purge_deleted.sql`

**Interfaces:**
- Produces: `public.purge_deleted_businesses()` — physically deletes all data for businesses with `deleted_at < now() - interval '30 days'`. Scheduled daily at 03:00 UTC via `cron.schedule('purge-deleted-businesses', ...)`.

- [ ] **Step 1: Write the failing SQL test**

Create `supabase/tests/purge_deleted.sql`:
```sql
do $$
declare v_old uuid; v_recent uuid;
begin
  -- business deleted 31 days ago (should be purged) + a child row
  insert into businesses (name, deleted_at) values ('PURGE_OLD', now() - interval '31 days')
    returning id into v_old;
  insert into recipes (name, business_id, created_by) values ('r', v_old, null);

  -- business deleted 10 days ago (should survive)
  insert into businesses (name, deleted_at) values ('PURGE_RECENT', now() - interval '10 days')
    returning id into v_recent;

  perform public.purge_deleted_businesses();

  assert (select count(*) from businesses where id = v_old) = 0, 'old business not purged';
  assert (select count(*) from recipes where business_id = v_old) = 0, 'old child rows not purged';
  assert (select count(*) from businesses where id = v_recent) = 1, 'recent business wrongly purged';

  delete from businesses where id = v_recent;  -- cleanup
end $$;
select 'ALL PASS' as result;
```

- [ ] **Step 2: Run the test, verify it fails**

Run:
```bash
bash scripts/sql-api.sh supabase/tests/purge_deleted.sql
```
Expected: `function public.purge_deleted_businesses() does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260712140100_purge_deleted_businesses.sql`:
```sql
create or replace function public.purge_deleted_businesses()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_ids uuid[];
begin
  select array_agg(id) into v_ids
  from public.businesses
  where deleted_at is not null and deleted_at < now() - interval '30 days';

  if v_ids is null then return; end if;

  delete from public.checklist_responses cr using public.checklist_completions cc
    where cr.completion_id = cc.id and cc.business_id = any(v_ids);
  delete from public.checklist_completions where business_id = any(v_ids);
  delete from public.checklist_template_items ti using public.checklist_templates t
    where ti.template_id = t.id and t.business_id = any(v_ids);
  delete from public.checklist_templates where business_id = any(v_ids);
  delete from public.recipe_tags rt using public.recipes r
    where rt.recipe_id = r.id and r.business_id = any(v_ids);
  delete from public.recipe_ingredients ri using public.recipes r
    where ri.recipe_id = r.id and r.business_id = any(v_ids);
  delete from public.recipes where business_id = any(v_ids);
  delete from public.tags where business_id = any(v_ids);
  delete from public.menu_items where business_id = any(v_ids);
  delete from public.delivery_photos dp using public.deliveries d
    where dp.delivery_id = d.id and d.business_id = any(v_ids);
  delete from public.deliveries where business_id = any(v_ids);
  delete from public.document_access da using public.documents d
    where da.document_id = d.id and d.business_id = any(v_ids);
  delete from public.documents where business_id = any(v_ids);
  delete from public.suppliers where business_id = any(v_ids);
  delete from public.incidents where business_id = any(v_ids);
  delete from public.diary_entries where business_id = any(v_ids);
  delete from public.staff_checkins where business_id = any(v_ids);
  delete from public.haccp_pack_data where business_id = any(v_ids);
  delete from public.invites where business_id = any(v_ids);
  delete from public.profiles where business_id = any(v_ids);
  delete from public.businesses where id = any(v_ids);
end $$;

-- Daily at 03:00 UTC
select cron.schedule('purge-deleted-businesses', '0 3 * * *',
  $$ select public.purge_deleted_businesses(); $$);
```
Note: if a table name here does not exist in the live schema, remove that line — verify against `docs/04-DATABASE.md` before applying. `delivery_photos`/`document_access`/`recipe_ingredients`/`checklist_template_items` are join/child tables; keep the FK-safe order (children before parents).

- [ ] **Step 4: Apply the migration**

Run:
```bash
bash scripts/sql-api.sh supabase/migrations/20260712140100_purge_deleted_businesses.sql
```
Expected: `[]` (the `cron.schedule` returns a jobid; a non-error result).

- [ ] **Step 5: Run the test, verify it passes**

Run:
```bash
bash scripts/sql-api.sh supabase/tests/purge_deleted.sql
```
Expected: `[{"result":"ALL PASS"}]`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260712140100_purge_deleted_businesses.sql supabase/tests/purge_deleted.sql
git commit -m "feat(db): purge_deleted_businesses() + daily pg_cron job"
```

---

### Task 3: Edge function `delete-account` — auth + owner check + soft-delete

**Files:**
- Create: `supabase/functions/delete-account/index.ts`

**Interfaces:**
- Consumes: POST body `{ businessId: string }` + `Authorization: Bearer <user jwt>`.
- Produces: on success sets `businesses.deleted_at = now()` and cancels the Stripe subscription if present; returns `{ success: true }`. Returns 401 if unauthenticated, 403 if caller is not the owner of `businessId`.

- [ ] **Step 1: Write the function**

Create `supabase/functions/delete-account/index.ts`:
```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    // 1. Identify the caller from their JWT (not from the body).
    const asUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await asUser.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const { businessId } = await req.json();
    if (!businessId) return json({ error: "Missing businessId" }, 400);

    // 2. Verify from the DB that the caller is the OWNER of this business.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: profile } = await admin
      .from("profiles").select("role, business_id").eq("id", user.id).single();
    if (!profile || profile.role !== "owner" || profile.business_id !== businessId) {
      return json({ error: "Only the business owner can delete this business" }, 403);
    }

    // 3. Cancel Stripe subscription if any (best-effort).
    const { data: biz } = await admin
      .from("businesses").select("subscription_id").eq("id", businessId).single();
    if (biz?.subscription_id) {
      try {
        await fetch(`https://api.stripe.com/v1/subscriptions/${biz.subscription_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
        });
      } catch (_) { /* already cancelled / no-op */ }
    }

    // 4. SOFT delete — mark deleted; the daily cron purges after 30 days.
    const { error: updErr } = await admin
      .from("businesses").update({ deleted_at: new Date().toISOString() }).eq("id", businessId);
    if (updErr) return json({ error: updErr.message }, 400);

    return json({ success: true });
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});
```

- [ ] **Step 2: Deploy the function (JWT verification ON)**

Run:
```bash
cd ~/HACCP/web && export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt)
supabase functions deploy delete-account --project-ref rszrggreuarvodcqeqrj
```
Note: deploy WITHOUT `--no-verify-jwt` so the platform also enforces a valid JWT. Expected: "Deployed Function delete-account".

- [ ] **Step 3: Verify a NON-owner is rejected (403)**

Get a second-level member's JWT (e.g. sign in as a `kitchen_staff` test user in the app and copy the access token), then:
```bash
curl -s -X POST "https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/delete-account" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <NON_OWNER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"businessId":"<their_business_id>"}'
```
Expected: `{"error":"Only the business owner can delete this business"}` (HTTP 403).

- [ ] **Step 4: Verify an owner soft-deletes (and data survives physically)**

Use the throwaway "Android Test Restaurant" owner JWT + business id:
```bash
curl -s -X POST "https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/delete-account" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <OWNER_JWT>" \
  -H "Content-Type: application/json" -d '{"businessId":"468e902d-0aa3-4032-a134-932da49950b1"}'
```
Expected: `{"success":true}`. Then confirm soft (not hard) delete + restore for cleanup:
```bash
export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt)
printf "select (deleted_at is not null) as soft_deleted from businesses where id='468e902d-0aa3-4032-a134-932da49950b1';" > /tmp/chk.sql
bash scripts/sql-api.sh /tmp/chk.sql            # expect soft_deleted = true, row still exists
printf "update businesses set deleted_at=null where id='468e902d-0aa3-4032-a134-932da49950b1';" > /tmp/restore.sql
bash scripts/sql-api.sh /tmp/restore.sql        # restore test business
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/delete-account/index.ts
git commit -m "feat(edge): delete-account requires auth + owner check, soft-deletes"
```

---

### Task 4: Edge function `manage-subscription` — remove the unauthenticated `delete` action

**Files:**
- Modify: `supabase/functions/manage-subscription/index.ts` (remove the `if (action === "delete")` block, lines ~150-230)

**Interfaces:**
- Produces: `manage-subscription` no longer accepts `action: "delete"`; calling it returns `Unknown action: delete`.

- [ ] **Step 1: Remove the delete block**

In `supabase/functions/manage-subscription/index.ts`, delete the entire `// ── Delete Account ──` block (the `if (action === "delete") { ... }`, from the comment through its closing `}` before `throw new Error(\`Unknown action: ${action}\`)`). Leave `portal` / `cancel` / `reactivate` / `sync` intact.

- [ ] **Step 2: Deploy**

Run:
```bash
cd ~/HACCP/web && export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt)
supabase functions deploy manage-subscription --project-ref rszrggreuarvodcqeqrj
```
Expected: "Deployed Function manage-subscription".

- [ ] **Step 3: Verify delete action is gone**

```bash
curl -s -X POST "https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/manage-subscription" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"action":"delete","businessId":"00000000-0000-0000-0000-000000000000","userId":"00000000-0000-0000-0000-000000000000"}'
```
Expected: `{"error":"Unknown action: delete"}` — no data touched.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/manage-subscription/index.ts
git commit -m "fix(edge): remove unauthenticated delete action from manage-subscription"
```

---

### Task 5: Mobile — gate the delete button to owners only

**Files:**
- Modify: `haccp-mobile/lib/screens/profile/profile_screen.dart` (the "Delete Account" list item ~line 420-430)
- Create: `haccp-mobile/lib/utils/deletion_permissions.dart`
- Test: `haccp-mobile/test/utils/deletion_permissions_test.dart`

**Interfaces:**
- Produces: `bool canDeleteBusiness(UserRole? role)` → `true` only for `UserRole.owner`. The delete UI is rendered only when this returns true.

- [ ] **Step 1: Write the failing test**

Create `haccp-mobile/test/utils/deletion_permissions_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:haccp_mobile/models/user_role.dart';
import 'package:haccp_mobile/utils/deletion_permissions.dart';

void main() {
  test('only owner can delete the business', () {
    expect(canDeleteBusiness(UserRole.owner), true);
    expect(canDeleteBusiness(UserRole.manager), false);
    expect(canDeleteBusiness(UserRole.chef), false);
    expect(canDeleteBusiness(UserRole.frontOfHouse), false);
    expect(canDeleteBusiness(UserRole.kitchenStaff), false);
    expect(canDeleteBusiness(null), false);
  });
}
```
Note: confirm the exact enum member names in `lib/models/user_role.dart` and match them here (e.g. `frontOfHouse`/`front_of_house`).

- [ ] **Step 2: Run the test, verify it fails**

Run:
```bash
cd ~/HACCP/haccp-mobile && flutter test test/utils/deletion_permissions_test.dart
```
Expected: FAIL — `deletion_permissions.dart` not found.

- [ ] **Step 3: Write the helper**

Create `haccp-mobile/lib/utils/deletion_permissions.dart`:
```dart
import '../models/user_role.dart';

/// Only the business owner may delete the whole business.
bool canDeleteBusiness(UserRole? role) => role == UserRole.owner;
```

- [ ] **Step 4: Run the test, verify it passes**

Run:
```bash
cd ~/HACCP/haccp-mobile && flutter test test/utils/deletion_permissions_test.dart
```
Expected: PASS.

- [ ] **Step 5: Gate the UI on the helper**

In `haccp-mobile/lib/screens/profile/profile_screen.dart`, add the import:
```dart
import '../../utils/deletion_permissions.dart';
```
Wrap the "Delete Account" list item (around line 423-430) so it renders only for owners:
```dart
if (canDeleteBusiness(profile?.role)) ...[
  // ── Delete Account ── (existing _DangerItem / label: 'Delete Account' widget) ──
  _existingDeleteWidget,
],
```
(Replace `_existingDeleteWidget` with the actual existing delete widget block — keep its current `onTap: () => _showDeleteDialog(profile)`.) Also update the first dialog copy to reflect recoverability:
```dart
content: Text(
  'This will delete your business and hide all its data immediately. '
  'It is permanently removed after 30 days. Contact support within 30 days to restore. '
  'Only the business owner can do this.',
  style: GoogleFonts.inter(fontSize: 15),
),
```

- [ ] **Step 6: Verify build + analyze**

Run:
```bash
cd ~/HACCP/haccp-mobile && flutter analyze lib/screens/profile/profile_screen.dart lib/utils/deletion_permissions.dart && flutter test test/utils/deletion_permissions_test.dart
```
Expected: no analyzer errors; test PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/HACCP/haccp-mobile
git add lib/utils/deletion_permissions.dart test/utils/deletion_permissions_test.dart lib/screens/profile/profile_screen.dart
git commit -m "feat: gate business deletion to owners only + soft-delete copy"
```

---

### Task 6: Manual end-to-end verification

**Files:** none

- [ ] **Step 1: Mobile role gating**

Run the app (`flutter run`), sign in as a `kitchen_staff` member of a business → open Profile → confirm **no Delete Account button**. Sign in as the `owner` → confirm the button is present.

- [ ] **Step 2: Owner delete → hidden immediately, recoverable**

As owner on a throwaway business, run the delete flow → confirm the app signs out / the business disappears. Via `scripts/sql-api.sh`, confirm the row still exists with `deleted_at` set (soft), then restore it (`update ... set deleted_at=null`).

- [ ] **Step 3: Confirm the old hole is closed**

Repeat Task 3 Step 3 (non-owner curl → 403) and Task 4 Step 3 (manage-subscription delete → unknown action). Both must reject.

---

## Notes / out of scope

- **Web:** there is currently no delete UI on web (`settings/page.tsx` only opens the Stripe portal). No web UI task here. If a web "delete business" button is added later, it must call `delete-account` with the owner's token and be gated to `subscription`-owner role — reuse this same function.
- **Restore UI, data export, "remove member", group/multisite deletion** — out of scope (see spec).
- After merge, deploy: migrations are already applied to the live DB during the tasks; edge functions deployed during Tasks 3-4; mobile change ships in the next mobile release.
