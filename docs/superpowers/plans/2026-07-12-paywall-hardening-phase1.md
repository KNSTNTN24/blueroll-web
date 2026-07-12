# Paywall Hardening (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the paywall actually enforced — no free access via the `/paywall` stub, self-grant, unlimited trials, or the unauthenticated API — on the current single-subscription-per-business model.

**Architecture:** A single server-side entitlement function (`is_business_entitled`) is the source of truth. Entitlement columns are made server-only (trigger). Writes by unentitled businesses are blocked by **RESTRICTIVE** RLS policies (which AND-compose with, and never clobber, Maria's in-flight per-site permissive policies). The `/paywall` stub is replaced with the real Stripe card flow; trials are deduped by email; `manage-subscription` is authenticated.

**Tech Stack:** Supabase Postgres (RLS, triggers, SECURITY DEFINER functions), Deno edge functions, Next.js + Stripe Elements. Project ref `rszrggreuarvodcqeqrj` (LIVE prod — user authorized applying to prod).

## Global Constraints

- Enforcement is **block writes, keep reads open**: gate INSERT/UPDATE only; never change SELECT/DELETE policies.
- The write-gate MUST be added as **`AS RESTRICTIVE`** policies (separate policy objects) — do NOT edit existing permissive policies. This is what keeps it from clobbering / being clobbered by Maria's per-site RLS (`KNS/multisite`; helpers `am_i_group_admin`/`can_see_site_row`/`can_write_kitchen_row` are already live on prod, her policies are NOT yet applied).
- Entitlement columns (`manual_*`, `stripe_*`, `iap_*`, `subscription_id`, `stripe_customer_id`, `subscription_status`, `trial_ends_at`) are **server-only** — clients (`authenticated`/`anon`) must not write them (trigger; column-level REVOKE is inert here because of a table-level UPDATE grant).
- Grace: a `past_due` / IAP-grace business stays entitled for **7 days** past its paid-through date.
- Trial dedup key: **email** (one trial per email, ever).
- SQL to live DB: `export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt)` then `bash scripts/sql-api.sh <file.sql>` — returns ONLY the last statement's result; end test files with `select 'ALL PASS' as result;`, use `do $$ ... assert ... $$`. Impersonate a user with top-level `begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"<uid>","role":"authenticated"}',true); ...; rollback;`.
- Branch `KNS/paywall-billing` (off main; spec already committed). Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT plan Phase 2 (multisite billing) — out of scope here.

---

### Task 1: `is_business_entitled()` + grace

**Files:**
- Create: `supabase/migrations/20260712180000_is_business_entitled.sql`
- Test: `supabase/tests/is_business_entitled.sql`

**Interfaces:**
- Produces: `public.is_business_entitled(p_business_id uuid) returns boolean` — true iff the business is not soft-deleted AND (its computed subscription is live, OR it is within a 7-day payment grace).

- [ ] **Step 1: Write the failing test**

`supabase/tests/is_business_entitled.sql` — uses a throwaway business, flips its channel columns via service role (sql-api runs privileged), asserts each case:
```sql
do $$
declare v_biz uuid;
begin
  insert into public.businesses(name) values ('ENT_TEST') returning id into v_biz;

  -- active → entitled
  update public.businesses set manual_status='active', manual_until=now()+interval '30 days' where id=v_biz;
  assert public.is_business_entitled(v_biz), 'active not entitled';

  -- trialing not expired → entitled
  update public.businesses set manual_status='trialing', manual_until=now()+interval '3 days' where id=v_biz;
  assert public.is_business_entitled(v_biz), 'live trial not entitled';

  -- expired trial → NOT entitled
  update public.businesses set manual_status='trialing', manual_until=now()-interval '1 day' where id=v_biz;
  assert not public.is_business_entitled(v_biz), 'expired trial entitled';

  -- past_due within 7d grace → entitled
  update public.businesses set manual_status=null, manual_until=null,
    stripe_status='past_due', stripe_until=now()-interval '2 days' where id=v_biz;
  assert public.is_business_entitled(v_biz), 'past_due within grace not entitled';

  -- past_due beyond 7d grace → NOT entitled
  update public.businesses set stripe_until=now()-interval '10 days' where id=v_biz;
  assert not public.is_business_entitled(v_biz), 'past_due beyond grace entitled';

  -- soft-deleted active → NOT entitled
  update public.businesses set stripe_status=null, stripe_until=null,
    manual_status='active', manual_until=now()+interval '30 days', deleted_at=now() where id=v_biz;
  assert not public.is_business_entitled(v_biz), 'soft-deleted entitled';

  delete from public.businesses where id=v_biz;
end $$;
select 'ALL PASS' as result;
```

- [ ] **Step 2: Run, verify FAIL**

Run: `bash scripts/sql-api.sh supabase/tests/is_business_entitled.sql`
Expected: error `function public.is_business_entitled(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260712180000_is_business_entitled.sql`:
```sql
create or replace function public.is_business_entitled(p_business_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.businesses b
    where b.id = p_business_id
      and b.deleted_at is null
      and (
        -- computed live status
        (b.subscription_status = 'active')
        or (b.subscription_status = 'trialing'
            and (b.trial_ends_at is null or b.trial_ends_at > now()))
        -- 7-day payment grace on a failed renewal (raw channels)
        or (b.stripe_status = 'past_due' and b.stripe_until is not null
            and b.stripe_until > now() - interval '7 days')
        or (b.iap_status in ('past_due','in_grace','on_hold') and b.iap_expires_at is not null
            and b.iap_expires_at > now() - interval '7 days')
      )
  );
$$;
```

- [ ] **Step 4: Apply + verify PASS**

Run: `bash scripts/sql-api.sh supabase/migrations/20260712180000_is_business_entitled.sql` (expect `[]`), then `bash scripts/sql-api.sh supabase/tests/is_business_entitled.sql` (expect `[{"result":"ALL PASS"}]`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260712180000_is_business_entitled.sql supabase/tests/is_business_entitled.sql
git commit -m "feat(db): is_business_entitled() with 7-day payment grace"
```

---

### Task 2: entitlement-column write protection (trigger)

**Files:**
- Create: `supabase/migrations/20260712180100_protect_entitlement_columns.sql`
- Test: `supabase/tests/protect_entitlement_columns.sql`

**Interfaces:**
- Produces: a `BEFORE UPDATE` trigger on `businesses` that raises `insufficient_privilege` when a non-`service_role` caller changes any entitlement column.

- [ ] **Step 1: Write the failing test**

`supabase/tests/protect_entitlement_columns.sql` — pick a throwaway business + its owner uid; impersonate the owner; assert a direct `manual_status='active'` write is rejected:
```sql
begin;
set local role authenticated;
-- replace with a real throwaway business + owner uid at runtime (query first):
select set_config('request.jwt.claims',
  json_build_object('sub', (select p.id from public.profiles p join public.businesses b on b.id=p.business_id where b.name='Android Test Restaurant' and p.role='owner' limit 1),
                    'role','authenticated')::text, true);
do $$
declare v_biz uuid;
begin
  select business_id into v_biz from public.profiles where id = auth.uid();
  begin
    update public.businesses set manual_status='active', manual_until=now()+interval '999 days' where id=v_biz;
    assert false, 'authenticated was able to self-grant entitlement';
  exception when insufficient_privilege then null;  -- expected
  end;
end $$;
reset role;
rollback;
select 'ALL PASS' as result;
```

- [ ] **Step 2: Run, verify FAIL**

Run: `bash scripts/sql-api.sh supabase/tests/protect_entitlement_columns.sql`
Expected: assertion fires (`authenticated was able to self-grant entitlement`) — the write currently succeeds.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260712180100_protect_entitlement_columns.sql`:
```sql
create or replace function public.protect_business_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Block only the client roles. service_role (webhooks) and SECURITY DEFINER
  -- functions (setup_business, consume_trial — they run as the definer/owner role)
  -- must still be able to write these columns.
  if current_user in ('authenticated','anon') and (
       new.manual_status is distinct from old.manual_status
    or new.manual_until is distinct from old.manual_until
    or new.stripe_status is distinct from old.stripe_status
    or new.stripe_until is distinct from old.stripe_until
    or new.iap_status is distinct from old.iap_status
    or new.iap_expires_at is distinct from old.iap_expires_at
    or new.subscription_id is distinct from old.subscription_id
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.subscription_status is distinct from old.subscription_status
    or new.trial_ends_at is distinct from old.trial_ends_at
  ) then
    raise insufficient_privilege using message = 'entitlement columns are server-managed';
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_business_entitlement on public.businesses;
create trigger trg_protect_business_entitlement
  before update on public.businesses
  for each row execute function public.protect_business_entitlement();
```
Note: the condition blocks ONLY `authenticated`/`anon` (the client roles), so all legitimate server writers pass: webhooks (`current_user = 'service_role'`), and SECURITY DEFINER functions such as `setup_business` and `consume_trial` (Task 4) which run as the definer/owner role. The trigger is `BEFORE UPDATE`; it fires before the arbiter (`trg_zz_subscription_arbiter`) and only inspects the caller-supplied NEW vs OLD, so an authenticated update of a non-entitlement column (e.g. business name) that leaves the channel columns unchanged passes. Verify with a quick probe that a normal authenticated owner CAN still update `businesses.name`.

- [ ] **Step 4: Apply + verify PASS**

Run the migration, then the test → `ALL PASS`. Also re-run `supabase/tests/is_business_entitled.sql` — it writes channel columns as the privileged sql-api role (not `authenticated`), so it must still pass (regression check).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260712180100_protect_entitlement_columns.sql supabase/tests/protect_entitlement_columns.sql
git commit -m "feat(db): block client writes to entitlement columns (trigger)"
```

---

### Task 3: RESTRICTIVE write-gate on business tables

**Files:**
- Create: `supabase/migrations/20260712180200_entitlement_write_gate.sql`
- Test: `supabase/tests/entitlement_write_gate.sql`

**Interfaces:**
- Consumes: `public.is_business_entitled(uuid)` (Task 1).
- Produces: `AS RESTRICTIVE` INSERT/UPDATE policies named `entitlement_write_gate` on each business write table, requiring `is_business_entitled(<business_id>)`.

- [ ] **Step 1: Determine the table set (live)**

Run this to list tables that have a direct `business_id` and are user-writable (verify before writing the migration):
```sql
select c.relname from pg_policies p join pg_class c on c.relname=p.tablename
where p.schemaname='public' and p.cmd in ('INSERT','UPDATE','ALL')
  and exists (select 1 from information_schema.columns col where col.table_name=c.relname and col.column_name='business_id')
group by c.relname order by c.relname;
```
The expected set (confirm): `recipes, menu_items, tags, checklist_templates, checklist_completions, documents, incidents, diary_entries, suppliers, deliveries, staff_checkins, haccp_pack_data`. Child tables without `business_id` (`recipe_ingredients, recipe_tags, checklist_template_items, checklist_responses, delivery_photos`) are gated via their parent (Step 3b).

- [ ] **Step 2: Write the failing test**

`supabase/tests/entitlement_write_gate.sql` — throwaway business made UNentitled (expired), impersonate its owner, assert an INSERT into `recipes` is denied; then make it entitled, assert the INSERT succeeds; assert SELECT of an existing row is unaffected either way:
```sql
begin;
-- setup a throwaway business + owner profile via service role (privileged)
-- (query/create ids at runtime; pseudo below)
-- make it UNentitled:
--   update businesses set manual_status='trialing', manual_until=now()-interval '1 day' ...
-- impersonate owner, attempt insert into recipes -> expect 0 rows / RLS denial
-- make it entitled (manual_status='active', manual_until future via service role)
-- impersonate owner, insert into recipes -> expect success
-- assert select of a pre-existing recipe still returns it when unentitled
rollback;
select 'ALL PASS' as result;
```
(The implementer fills the concrete fixture SQL following the impersonation pattern in Global Constraints; the assertions are: unentitled INSERT denied, entitled INSERT allowed, SELECT unaffected.)

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260712180200_entitlement_write_gate.sql`. For each direct-`business_id` table (loop or explicit), create restrictive policies scoped to `authenticated`:
```sql
-- pattern per direct-business_id table <T>:
drop policy if exists entitlement_write_gate_ins on public.<T>;
create policy entitlement_write_gate_ins on public.<T>
  as restrictive for insert to authenticated
  with check (public.is_business_entitled(business_id));
drop policy if exists entitlement_write_gate_upd on public.<T>;
create policy entitlement_write_gate_upd on public.<T>
  as restrictive for update to authenticated
  using (public.is_business_entitled(business_id))
  with check (public.is_business_entitled(business_id));
```
Write these out explicitly for every table in the confirmed set (no `Similar to` — repeat the two statements per table).

- [ ] **Step 3b: Child tables (no business_id) — gate via parent**

For each child table, resolve the parent's business in the restrictive policy, e.g. `recipe_ingredients`:
```sql
drop policy if exists entitlement_write_gate_ins on public.recipe_ingredients;
create policy entitlement_write_gate_ins on public.recipe_ingredients
  as restrictive for insert to authenticated
  with check (public.is_business_entitled((select business_id from public.recipes r where r.id = recipe_id)));
drop policy if exists entitlement_write_gate_upd on public.recipe_ingredients;
create policy entitlement_write_gate_upd on public.recipe_ingredients
  as restrictive for update to authenticated
  using (public.is_business_entitled((select business_id from public.recipes r where r.id = recipe_id)))
  with check (public.is_business_entitled((select business_id from public.recipes r where r.id = recipe_id)));
```
Repeat with the correct parent link for `recipe_tags`(→recipes.recipe_id), `checklist_template_items`(→checklist_templates.template_id), `checklist_responses`(→checklist_completions.completion_id), `delivery_photos`(→deliveries.delivery_id).

- [ ] **Step 4: Apply + verify PASS**

Apply the migration; run the test → `ALL PASS`. Sanity: a currently-entitled real business (e.g. a live `active` one) must still be able to write — verify by impersonating an owner of an entitled business and inserting+rolling back a row.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260712180200_entitlement_write_gate.sql supabase/tests/entitlement_write_gate.sql
git commit -m "feat(db): restrictive RLS write-gate on business tables (composes with per-site RLS)"
```

---

### Task 4: trial dedup by email

**Files:**
- Create: `supabase/migrations/20260712180300_trial_dedup.sql`
- Test: `supabase/tests/trial_dedup.sql`

**Interfaces:**
- Produces: `public.trial_grants(email text primary key, granted_at timestamptz default now())`; `setup_business` records/checks it so a second business for an email that already had a trial starts unentitled.

**Context:** `set_default_trial` runs BEFORE INSERT on `businesses`, before the owner profile/email exists — so it cannot dedup by email. The dedup must live in `setup_business` (SECURITY DEFINER, runs after it inserts the profile with the email). Current `setup_business` inserts the business (which auto-trials via `set_default_trial`) then the owner profile.

- [ ] **Step 1: Write the failing test**

`supabase/tests/trial_dedup.sql` — simulate: insert a business (auto-trials), record its email in `trial_grants`; then simulate a SECOND business for the same email going through the dedup path and assert it ends up unentitled. Because `setup_business` needs `auth.uid()`, test the underlying dedup logic directly (a helper the implementer extracts, e.g. `public.consume_trial(p_email text, p_business_id uuid)`), asserting: first call leaves the trial intact + inserts a `trial_grants` row; second call for the same email clears the business's `manual_*` (→ unentitled). End with `ALL PASS`.

- [ ] **Step 2: Run, verify FAIL** (`trial_grants` / `consume_trial` missing).

- [ ] **Step 3: Write the migration**

```sql
create table if not exists public.trial_grants (
  email text primary key,
  granted_at timestamptz not null default now()
);
alter table public.trial_grants enable row level security;  -- no policies: clients cannot read/write; service/definer only

create or replace function public.consume_trial(p_email text, p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.trial_grants where email = lower(p_email)) then
    -- email already had a trial: revoke the auto-granted trial on this business
    update public.businesses set manual_status = null, manual_until = null where id = p_business_id;
  else
    insert into public.trial_grants(email) values (lower(p_email));
  end if;
end $$;
```
Then modify `public.setup_business` (fetch current definition first with `pg_get_functiondef`) to call `perform public.consume_trial(v_email, v_business_id);` after the profile is inserted. Keep the rest of `setup_business` intact.

- [ ] **Step 4: Backfill existing customers** so current businesses aren't re-trialed by a repeat signup:
```sql
insert into public.trial_grants(email, granted_at)
select distinct lower(p.email), min(b.created_at)
from public.profiles p join public.businesses b on b.id = p.business_id
where p.role = 'owner' and p.email is not null
group by lower(p.email)
on conflict (email) do nothing;
```

- [ ] **Step 5: Apply + verify PASS**, then commit:
```bash
git add supabase/migrations/20260712180300_trial_dedup.sql supabase/tests/trial_dedup.sql
git commit -m "feat(db): dedup free trials by email"
```

---

### Task 5: authenticate `manage-subscription`

**Files:**
- Modify: `supabase/functions/manage-subscription/index.ts`

**Interfaces:**
- Produces: `portal`/`cancel`/`reactivate`/`sync` require a valid JWT whose user is the `owner` of the target business.

- [ ] **Step 1: Add an auth+ownership guard**

At the top of the request handler (after parsing the body), before dispatching on `action`, resolve the caller and verify ownership of `businessId`:
```ts
const authHeader = req.headers.get("Authorization") ?? "";
const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
const { data: { user } } = await asUser.auth.getUser();
if (!user) return json({ error: "Not authenticated" }, 401);
// resolve target business: prefer businessId; for portal (customerId only) resolve via businesses.stripe_customer_id
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const { data: prof } = await admin.from("profiles").select("role, business_id").eq("id", user.id).single();
let targetBiz = businessId as string | undefined;
if (!targetBiz && customerId) {
  const { data: b } = await admin.from("businesses").select("id").eq("stripe_customer_id", customerId).single();
  targetBiz = b?.id;
}
if (!prof || prof.role !== "owner" || !targetBiz || prof.business_id !== targetBiz) {
  return json({ error: "Not authorized for this business" }, 403);
}
```
(Introduce a `json(body,status)` helper if not present. Keep the existing action blocks unchanged below the guard.) Deploy WITHOUT `--no-verify-jwt` so the platform also requires a JWT.

- [ ] **Step 2: Deploy + verify**

```bash
supabase functions deploy manage-subscription --project-ref rszrggreuarvodcqeqrj
```
Verify: unauthenticated call → 401; a call with a valid non-owner JWT (or mismatched businessId) → 403; (owner path smoke-tested by the client in normal use).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/manage-subscription/index.ts
git commit -m "fix(edge): authenticate manage-subscription + verify business ownership"
```

---

### Task 6: replace the `/paywall` stub with real payment

**Files:**
- Modify: `src/app/(auth)/paywall/page.tsx`
- Test: `src/app/(auth)/paywall/page.test.tsx` (vitest) or manual verification

**Interfaces:**
- Consumes: the existing onboarding card flow → `create-subscription` edge function (Stripe Elements + `paymentMethod` + `create-subscription`).
- Produces: `/paywall` collects a card and creates a real Stripe subscription (14-day trial WITH card on file), instead of writing `manual_status='trialing'`.

- [ ] **Step 1: Remove the no-payment stub**

In `src/app/(auth)/paywall/page.tsx`, delete the block that does `supabase.from('businesses').update({ manual_status:'trialing', manual_until: ... })`. 

- [ ] **Step 2: Reuse the real card flow**

Port the `CardForm` logic from `src/app/(auth)/onboarding/page.tsx` (Stripe Elements card element → `stripe.createPaymentMethod` → invoke `create-subscription` edge function with the payment method; handle SCA via `confirmCardSetup`). On success, `create-subscription` sets `stripe_status`/`stripe_until` (server-side), the arbiter computes `active`/`trialing`, and the user is entitled → redirect to `/dashboard`. Extract the shared card component to `src/components/shared/card-form.tsx` if that avoids duplicating the logic across onboarding and paywall (DRY).

- [ ] **Step 3: Verify**

Run `npm run test` (vitest) for any component test. Manually (or with a Stripe test card) confirm: on `/paywall`, entering a test card creates a subscription and lands on `/dashboard` entitled; there is no longer any path that grants access without a card. Run `npm run build` to confirm the app compiles.

- [ ] **Step 4: Commit**

```bash
git add src/app/(auth)/paywall/page.tsx src/components/shared/card-form.tsx
git commit -m "fix: paywall charges via Stripe instead of granting a free trial"
```

---

### Task 7: end-to-end verification

- [ ] **Step 1:** Confirm the self-grant hole is closed — impersonate an owner and attempt `update businesses set manual_status='active', manual_until='2099-01-01'` → rejected by the trigger.
- [ ] **Step 2:** Confirm write-enforcement — as an owner of an expired-trial throwaway business, an INSERT into `recipes` (direct API / impersonation) is denied; SELECT of existing rows still works.
- [ ] **Step 3:** Confirm `/paywall` has no free path (Task 6) and `manage-subscription` rejects unauth/non-owner (Task 5).
- [ ] **Step 4:** Confirm an entitled (`active`/live-trial) business is unaffected — owner can still write.

## Notes / coordination

- **Maria's per-site RLS (`KNS/multisite`):** the restrictive write-gate (Task 3) is a separate policy layer and AND-composes with her permissive per-site policies — no clobbering in either direction. Still, give Maria a heads-up that `entitlement_write_gate_*` restrictive policies now exist on those tables so she isn't surprised, and confirm her per-site policies are `permissive` (the default) not `restrictive`.
- **Out of scope (Phase 2, separate plan):** Stripe `quantity` = site count, graduated per-site pricing, site→Stripe sync. Do not build here.
- All migrations/edge deploys are applied to LIVE prod during the tasks (authorized), same as the account-deletion work.
