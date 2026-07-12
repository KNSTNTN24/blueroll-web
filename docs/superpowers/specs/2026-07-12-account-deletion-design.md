# Account / Business Deletion — Design

- **Date:** 2026-07-12
- **Status:** Approved (Konstantin), ready for implementation plan
- **Scope:** Supabase (edge function + migrations + scheduled job), Flutter mobile (`~/HACCP/haccp-mobile`), Web (`~/HACCP/web`)

## Problem

The current "Delete Account" flow is dangerous:

- The mobile `Delete Account` button (`haccp-mobile/lib/screens/profile/profile_screen.dart:134`) is shown to **every role**, including `kitchen_staff` and other second-level members. Its copy says it will *"permanently delete your account, all business data, recipes, checklists, and documents."*
- The backing edge function `manage-subscription` (`web/supabase/functions/manage-subscription/index.ts`, `action: "delete"`) is deployed `--no-verify-jwt`, has CORS `*`, and takes `businessId` / `userId` from the request body **with no authentication and no ownership check**. It then **physically cascade-deletes** all business data using the service-role key (bypasses RLS).
- Net effect: any second-level member (or anyone who knows a `businessId`) can permanently wipe an entire restaurant's data — including the owner's compliance/audit trail.

Blueroll's core value is the accumulated operational data and the compliance/audit trail (EHO due-diligence records). Irreversible destruction of that data by a non-owner is the highest-severity issue found in the paywall/entitlement audit — it is about **data destruction**, not free access.

## Decisions (locked)

1. **Who can delete:** Only the business **owner**. Second-level members (`manager`, `chef`, `front_of_house`, `kitchen_staff`) have **no delete button at all**. Leaving a business is handled by the owner (a separate "remove member" operation is out of scope for this spec).
2. **What "delete" means:** **Soft-delete with a grace period.** Mark deleted, hide + block immediately, physically wipe after **30 days**.
3. **Restore:** Within the 30-day window, restore is done **via support** (we clear the flag). No self-serve restore in this iteration.

## Design

### 1. Operations & permissions

- **"Delete business"** — owner-only. Wipes the whole business (soft). Button rendered **only when `profile.role == 'owner'`**:
  - Mobile: `profile_screen.dart` — gate the `Delete Account` list item on owner role; hide for everyone else.
  - Web: settings/delete entry — same owner-only gate.
- Second-level members: no delete UI whatsoever.

### 2. Soft-delete model + grace period

- New column `businesses.deleted_at timestamptz null`.
- On confirmed delete: set `deleted_at = now()`. Data is **not** physically removed.
- Immediately after: the business and all its data are **hidden and blocked** for all users; the subscription is cancelled.
- After **30 days**, a scheduled job physically deletes all rows for businesses whose `deleted_at < now() - interval '30 days'` (the same cascade the old code did, moved server-side and time-gated).
- **Restore** (within 30 days): support clears `deleted_at` (and, if needed, re-instates entitlement). Self-serve restore is out of scope.

### 3. Enforcement (the root fix)

Replace the unauthenticated delete path. Either rewrite `manage-subscription`'s `delete` action or introduce a dedicated `delete-business` edge function. Requirements:

- **Require authentication** — remove `--no-verify-jwt`; read the caller's JWT.
- **Verify ownership from the database**, not from the request body: resolve `auth.uid()` → `profiles` → require `role = 'owner'` **and** `business_id = <target>`. Reject otherwise. Never trust `businessId` / `userId` supplied in the body as authorization.
- **Action = set `deleted_at` + cancel subscription only.** No immediate cascade wipe from the request path.
- **`deleted_at` is not client-writable directly.** Apply the same column-level protection principle used for entitlement fields (`REVOKE UPDATE` on the column from `authenticated`/`anon`; only the server function may set it). This prevents a client from setting/clearing `deleted_at` via the auto-generated REST API.
- Tighten CORS / auth on the whole `manage-subscription` function while here (the same function currently exposes unauthenticated `portal`/`cancel`/`sync`/`delete`).

### 4. Data flow

1. Owner taps "Delete business" → two-step confirmation (keep existing: "Continue" + type `DELETE`).
2. Client calls the authenticated delete function with the caller's token.
3. Function verifies caller is the owner of that business.
4. Function sets `businesses.deleted_at = now()` and cancels Stripe/IAP subscription.
5. Client signs the user out / routes away.
6. A **daily scheduled job** physically deletes all data for businesses with `deleted_at` older than 30 days (cascade across `checklist_completions`, `checklist_templates`, `checklist_template_items`, `checklist_responses`, `recipes`, `recipe_ingredients`, `recipe_tags`, `tags`, `menu_items`, `documents`, `document_access`, `suppliers`, `deliveries`, `delivery_photos`, `incidents`, `diary_entries`, `staff_checkins`, `haccp_pack_data`, `invites`, `notifications`, `profiles`, storage objects, then the `businesses` row). Implementation of the scheduler (pg_cron vs Supabase scheduled function) to be chosen in the plan.

### 5. Cross-platform consistency

One server-side delete function serves both web and mobile → identical behavior. The only platform difference is where the button lives (mobile profile screen, web settings) and that it is owner-only on both.

### 6. Access while soft-deleted

- While `deleted_at IS NOT NULL`, the business behaves as deleted for everyone: access gate returns "no access" and data is hidden.
- Enforce by adding `deleted_at IS NULL` to the relevant read paths / RLS SELECT conditions (or to the entitlement/access check), so a soft-deleted business is invisible and unusable but physically recoverable until the wipe.

## Security notes

- The single most important change is: **the delete endpoint must authenticate the caller and verify owner-of-this-business from the DB.** This alone closes the "anyone with a businessId wipes it" hole.
- `deleted_at` and subscription/entitlement columns remain server-only (not client-writable), consistent with the entitlement-hardening work.
- Soft-delete + 30-day grace provides defense-in-depth: even a bug or a malicious authenticated owner action is recoverable within the window.

## Out of scope (YAGNI)

- Self-serve restore UI (restore is via support).
- Data export before deletion.
- A separate "remove a member" / "leave business" operation for second-level users.
- Multisite/group deletion semantics (no group entity exists yet; revisit when groups land).

## Parameters

- Grace period: **30 days**.
- Restore: **via support** (manual clear of `deleted_at`).

## Files likely touched

- `web/supabase/functions/manage-subscription/index.ts` (or new `delete-business` function) — auth + ownership check, action = soft-delete + cancel sub.
- `web/supabase/migrations/*` — add `businesses.deleted_at`; column-level protection; hide-when-deleted in read/RLS; scheduled wipe job + cleanup function.
- `haccp-mobile/lib/screens/profile/profile_screen.dart` — owner-only gate on delete button; call new/updated function.
- Web settings delete entry — owner-only gate; call new/updated function.
