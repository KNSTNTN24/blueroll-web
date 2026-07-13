# Multisite Billing (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a business's Stripe subscription `quantity` track its number of sites, so a multi-site group is billed per site (auto-add + auto-charge), while single-site businesses are unaffected.

**Architecture:** A business's subscription carries `quantity = billable_site_count(business)`. `create-subscription` sets it at creation. A `sync-site-quantity` edge function (service role) recomputes and updates the live Stripe subscription's item quantity; a trigger on `sites` (AFTER INSERT/DELETE) invokes it via `pg_net` (same shared-secret + Vault pattern as the purge cron). Per-site entitlement is NOT built — since quantity always covers all sites, `is_business_entitled` (Phase 1, business-level) already gates every site.

**Tech Stack:** Supabase Postgres (triggers, pg_net, Vault), Deno edge functions, Stripe REST API. Project ref `rszrggreuarvodcqeqrj` (LIVE prod — DB migrations applied additively, dormant; Stripe on the live Stripe account).

## Global Constraints

- Build on branch **`KNS/multisite`** (worktree `~/HACCP/web-multisite` — has the `sites` model + UI + the add-site flow). DB migrations apply **additively to prod** (`rszrggreuarvodcqeqrj`) and must be **dormant / non-breaking** (they only sync a Stripe quantity — no effect on the ~60 businesses without a live Stripe subscription; only 1 business currently has one). Test on the web preview + a throwaway business with a real Stripe **test** subscription.
- **Billable site** = a `sites` row with `status <> 'archived'` (current statuses: `active`, `onboarding`; no `archived` yet — the rule is future-proof). This definition lives in ONE place: `billable_site_count(business_id)`.
- Adding a site **auto-charges** (Stripe `proration_behavior=create_prorations`). No per-site entitlement gate — `is_business_entitled` (business-level, Phase 1, live on prod) already covers all sites. Single-site business → quantity 1 (unchanged £15 today).
- The **graduated / volume-discount price is a Stripe-dashboard config action (Konstantin), NOT code.** Build and test against the current `STRIPE_PRICE_ID` (which bills `quantity × unit price`, i.e. flat per-site). The discount is applied later by swapping the `STRIPE_PRICE_ID` env to a graduated price — no code change. **Precondition to note:** the price must be a *licensed* (per-unit) recurring price so `quantity` multiplies it; flag if the current price is not.
- SQL to live DB: `export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt)` then `bash scripts/sql-api.sh <file.sql>` (returns ONLY the last statement's result; end test files with `select 'ALL PASS' as result;`; wrap write-probes in `begin;...rollback;`). Deploy edge fns: `supabase functions deploy <name> --project-ref rszrggreuarvodcqeqrj`. Set edge secrets: `supabase secrets set KEY=VALUE --project-ref rszrggreuarvodcqeqrj`.
- Do NOT touch Maria's in-flight files unless a task requires it. Commit on `KNS/multisite`; messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Coordination note: Maria's per-site RLS isolation (Tasks 5–6 of her plan) is paused; `sites` is already write-gated by Phase 1's `is_business_entitled`. Nothing here changes access — give Maria a heads-up about the new `sites` trigger.

---

### Task 1: `billable_site_count(business_id)` SQL helper

**Files:**
- Create: `supabase/migrations/20260713100000_billable_site_count.sql`
- Test: `supabase/tests/billable_site_count.sql`

**Interfaces:**
- Produces: `public.billable_site_count(p_business_id uuid) returns integer` — number of that business's sites with `status <> 'archived'`.

- [ ] **Step 1: Write the failing test**

`supabase/tests/billable_site_count.sql`:
```sql
begin;
do $$
declare v_biz uuid; v_n int;
begin
  insert into public.businesses(name) values ('BSC_TEST') returning id into v_biz;
  -- create_default_site trigger makes 1 site; add 2 more
  insert into public.sites(business_id, name, status) values (v_biz,'s2','active'),(v_biz,'s3','onboarding');
  -- one archived (must NOT count)
  insert into public.sites(business_id, name, status) values (v_biz,'s4','archived');
  v_n := public.billable_site_count(v_biz);
  assert v_n = 3, format('expected 3 billable sites, got %s', v_n);  -- default + active + onboarding, archived excluded
end $$;
select 'ALL PASS' as result;
rollback;
```
Note: `create_default_site` fires on business insert and adds one `active` site, so the total billable = 1 (default) + 1 (active) + 1 (onboarding) = 3. Verify `create_default_site` is present live before relying on this; if the default site's status is not `active`, adjust the expected count to match what the trigger creates (read it first).

- [ ] **Step 2: Run, verify FAIL**

Run: `export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt); bash scripts/sql-api.sh supabase/tests/billable_site_count.sql`
Expected: `function public.billable_site_count(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260713100000_billable_site_count.sql`:
```sql
create or replace function public.billable_site_count(p_business_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.sites
  where business_id = p_business_id and coalesce(status,'') <> 'archived';
$$;
```

- [ ] **Step 4: Apply + verify PASS**

Run the migration file via `sql-api.sh` (expect `[]`), then the test (expect `[{"result":"ALL PASS"}]`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260713100000_billable_site_count.sql supabase/tests/billable_site_count.sql
git commit -m "feat(db): billable_site_count() helper for per-site billing"
```

---

### Task 2: `sync-site-quantity` edge function

**Files:**
- Create: `supabase/functions/sync-site-quantity/index.ts`

**Interfaces:**
- Consumes: `billable_site_count` (Task 1).
- Produces: POST `{ businessId }` + header `x-sync-secret: <SYNC_SITE_QUANTITY_SECRET>` → sets the business's live Stripe subscription item quantity to `billable_site_count(businessId)`. Returns `{ synced: true, quantity: n }`, or `{ synced: false, reason: "no subscription" }` if the business has no `subscription_id`. 401 on bad/missing secret.

- [ ] **Step 1: Write the function**

`supabase/functions/sync-site-quantity/index.ts`:
```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SYNC_SECRET = Deno.env.get("SYNC_SITE_QUANTITY_SECRET")!;

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-sync-secret, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function stripeGet(path: string) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } });
  return await r.json();
}
async function stripePost(path: string, params: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if ((req.headers.get("x-sync-secret") ?? "") !== SYNC_SECRET) return json({ error: "unauthorized" }, 401);
    const { businessId } = await req.json();
    if (!businessId) return json({ error: "missing businessId" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: biz } = await admin.from("businesses").select("subscription_id").eq("id", businessId).single();
    if (!biz?.subscription_id) return json({ synced: false, reason: "no subscription" });

    const { data: qtyData } = await admin.rpc("billable_site_count", { p_business_id: businessId });
    const quantity = Number(qtyData ?? 1) || 1;

    // find the subscription's first item id
    const sub = await stripeGet(`/subscriptions/${biz.subscription_id}`);
    const itemId = sub?.items?.data?.[0]?.id;
    if (!itemId) return json({ synced: false, reason: "no subscription item" });

    await stripePost(`/subscription_items/${itemId}`, {
      quantity: String(quantity),
      proration_behavior: "create_prorations",
    });
    return json({ synced: true, quantity });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Set the secret + deploy**

```bash
cd ~/HACCP/web-multisite && export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt)
SECRET=$(openssl rand -hex 32)
supabase secrets set SYNC_SITE_QUANTITY_SECRET="$SECRET" --project-ref rszrggreuarvodcqeqrj
supabase functions deploy sync-site-quantity --project-ref rszrggreuarvodcqeqrj --no-verify-jwt
```
Deploy **WITH `--no-verify-jwt`** — the DB trigger's `pg_net` call sends only `x-sync-secret` (no JWT), so the platform JWT gate would otherwise 401 it (same lesson as the purge cron). Authorization is the shared `x-sync-secret` the function checks itself. **Record `$SECRET`** — Task 3 stores the SAME value in Vault. Do NOT print/commit the secret value.

- [ ] **Step 3: Verify**

- Unauthorized: `curl` the function with a wrong/missing `x-sync-secret` → 401.
- No-subscription no-op: `curl` with the correct secret and a `businessId` that has no `subscription_id` → `{"synced":false,"reason":"no subscription"}`.
- (The real quantity update is exercised end-to-end in Task 5 against a throwaway Stripe test subscription.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/sync-site-quantity/index.ts
git commit -m "feat(edge): sync-site-quantity — set Stripe subscription quantity from site count"
```

---

### Task 3: `sites` trigger → sync via pg_net

**Files:**
- Create: `supabase/migrations/20260713100100_sites_quantity_sync_trigger.sql`

**Interfaces:**
- Consumes: the `sync-site-quantity` function + its secret (Task 2), Vault, pg_net.
- Produces: after any INSERT or DELETE on `sites`, an async `net.http_post` to `sync-site-quantity` with `{ businessId }` and the secret from Vault.

- [ ] **Step 1: Store the secret in Vault**

Using the SAME `$SECRET` from Task 2 (run out-of-band, not in a committed file):
```sql
select vault.create_secret('<the SYNC_SITE_QUANTITY_SECRET value>', 'sync_site_quantity_secret');
```

- [ ] **Step 2: Write the migration**

`supabase/migrations/20260713100100_sites_quantity_sync_trigger.sql`:
```sql
create or replace function public.sites_sync_quantity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_biz uuid;
begin
  v_biz := coalesce(new.business_id, old.business_id);
  perform net.http_post(
    url := 'https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/sync-site-quantity',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_site_quantity_secret')
    ),
    body := jsonb_build_object('businessId', v_biz)
  );
  return coalesce(new, old);
end $$;

drop trigger if exists trg_sites_sync_quantity on public.sites;
create trigger trg_sites_sync_quantity
  after insert or delete on public.sites
  for each row execute function public.sites_sync_quantity();
```
Note: fires per-row — a bulk onboarding insert of N sites triggers N sync calls; each recomputes the full count so the final state is correct (idempotent, last-wins). `pg_net`'s `http_post` is async (returns a request id, does not block the write).

- [ ] **Step 3: Apply + verify the wiring live**

Apply the migration. Then, in a rolled-back transaction, insert a site for a throwaway business and confirm a `net.http_post` was enqueued (a new row in `net.http_request_queue` or `net._http_response` shortly after). Because the business has no live Stripe subscription, the function will no-op (`synced:false`) — that's the correct dormant behavior; what you're verifying is that the trigger fires and reaches the function (check `net._http_response` `status_code=200`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260713100100_sites_quantity_sync_trigger.sql
git commit -m "feat(db): sync Stripe quantity on site add/remove via pg_net"
```

---

### Task 4: `create-subscription` sets initial quantity

**Files:**
- Modify: `supabase/functions/create-subscription/index.ts` (the `/subscriptions` create call, ~line 109)

**Interfaces:**
- Consumes: `billable_site_count` (Task 1).
- Produces: the created subscription has `items[0][quantity]` = the business's billable site count (≥ 1).

- [ ] **Step 1: Add the quantity to the create call**

Before the `stripeRequest("/subscriptions", {...})` call, compute the site count via the existing `supabase` (service-role) client:
```ts
const { data: siteCountData } = await supabase.rpc("billable_site_count", { p_business_id: businessId });
const quantity = Number(siteCountData ?? 1) || 1;
```
Then add `"items[0][quantity]": String(quantity),` to the `/subscriptions` params object (alongside `"items[0][price]"`). Leave everything else unchanged.

- [ ] **Step 2: Deploy**

```bash
cd ~/HACCP/web-multisite && export SUPABASE_ACCESS_TOKEN=$(cat ~/Secrets/blueroll/supabase-access-token.txt)
supabase functions deploy create-subscription --project-ref rszrggreuarvodcqeqrj
```
(Match the existing deploy flags for this function; it is called by the authenticated client.)

- [ ] **Step 3: Verify**

Confirmed end-to-end in Task 5 (a fresh subscription for a 2-site throwaway business must be created with quantity 2). For now confirm the function deploys cleanly and `billable_site_count` is callable via `rpc` (a quick read-only `select public.billable_site_count('<any business id>')`).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-subscription/index.ts
git commit -m "feat(edge): create-subscription sets quantity = billable site count"
```

---

### Task 5: end-to-end verification (throwaway business + Stripe test subscription)

**Files:** none (verification)

Use Stripe **test mode** keys if the project's `STRIPE_SECRET_KEY` is a test key; if it is a live key, use a throwaway business and immediately cancel/delete the created subscription. Retrieve the service-role key transiently via the Management API only if needed for setup, and never persist it.

- [ ] **Step 1: Initial quantity** — create a throwaway business with 2 billable sites; drive `create-subscription` for it (or invoke it directly with a Stripe test payment method); confirm the resulting Stripe subscription has `quantity = 2` on its item (`GET /subscriptions/{id}` → `items.data[0].quantity`).
- [ ] **Step 2: Add a site → quantity bumps** — insert a 3rd site for that business; wait a moment; confirm the subscription item quantity is now `3` (the trigger → `sync-site-quantity` path ran). Check `net._http_response` shows a 200 for the sync call.
- [ ] **Step 3: Remove a site → quantity drops** — delete one site; confirm quantity returns to `2`.
- [ ] **Step 4: No-op safety** — confirm a business WITHOUT a `subscription_id` (e.g. a manual-comped or trialing-without-Stripe business) triggers `sync-site-quantity` on site change but the function returns `{"synced":false,"reason":"no subscription"}` and nothing errors.
- [ ] **Step 5: Cleanup** — cancel/delete the throwaway Stripe subscription and the throwaway business + its sites.

## Notes / follow-ups

- **Graduated discount price (Konstantin, Stripe dashboard):** create a graduated/volume price (e.g. 1st site £15, additional £10) and set `STRIPE_PRICE_ID` to it. No code change. Until then, billing is flat per-site (`quantity × current unit price`). Verify the current price is a *licensed* per-unit recurring price so quantity multiplies it.
- **Dormant on prod:** only 1 prod business currently has a Stripe subscription, so applying these migrations changes billing for at most that one business (and only when its site count changes). Everything else is a no-op until businesses convert to paid.
- Out of scope: per-site entitlement gating (collapses to business-level — already covered by Phase 1), a `groups` entity (the `businesses` row is the group), separate-company per-site billing.
- This branch (`KNS/multisite`) is not yet merged; Phase 2 ships when the multisite branch merges. Coordinate the new `sites` trigger with Maria.
