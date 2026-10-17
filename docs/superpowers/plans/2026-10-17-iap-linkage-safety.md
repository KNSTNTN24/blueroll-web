# IAP Linkage Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably link verified Apple/Google subscriptions to exactly one business and retain recoverable evidence for every store notification.

**Architecture:** A server-only `iap_events` ledger records encrypted store identity before mutation. Pure shared edge helpers build safe event records; service-role RPCs enforce union candidate resolution, provider compatibility, unique ownership and atomic ledger/business finalization. Mobile records Google's real purchase token and retries linkage before completing the store transaction.

**Tech Stack:** Supabase/Postgres/PLpgSQL, Deno Edge Functions/Web Crypto, Flutter/Dart, SQL assertions, Deno tests and flutter_test.

**Spec:** `docs/superpowers/specs/2026-10-17-iap-linkage-safety-design.md`

## Global Constraints

- Never deploy migrations/functions or mutate live customer/store data in this task.
- Never log or store a plaintext Google purchase token outside the existing compatibility business column.
- Require exactly one distinct business candidate; never use priority lookup to hide a conflict.
- Existing active identifiers cannot be reassigned or overwritten by another provider.
- Database migration must stop descriptively on duplicate live identifiers; it must not repair customer data automatically.
- Deployment order is DB → secrets/webhooks → mobile.

## Review Focus

- Same token present on two businesses: migration and processing stop without choosing either.
- Token resolves to business A while external account user resolves to B: conflict ledger result, no entitlement update.
- Duplicate webhook delivery: one ledger row, first received time retained, attempt count increments.
- Crash/retry after ledger `processing`: safe replay can finalize without duplicating or reassigning.
- Recorder network failure after store purchase: transaction completes after bounded retries, user sees verification-pending state, no token is cached locally.

---

### Task 1: Server-only ledger and guarded purchase registration

**Files:**
- Create: `supabase/migrations/20261017130000_iap_linkage_safety.sql`
- Create: `supabase/tests/sql/16_iap_linkage_safety.test.sql`
- Modify: `supabase/migrations/20260529000001_record_iap_purchase.sql` only if documentation must point at the replacement; runtime replacement lives in the new migration.

**Interfaces:**
- Produces `iap_events` and service-only RPCs `begin_iap_event(...) returns uuid`, `finalize_iap_event(...) returns jsonb`.
- Replaces `record_iap_purchase(text,text,text) returns jsonb` with validated, locked owner-only behaviour.

- [ ] Write SQL assertions for privileges/RLS, duplicate preflight semantics, all protected IAP columns, blank/bounded inputs, same-business idempotency, other-business conflict and cross-provider rejection.
- [ ] Capture RED against the current schema without using production.
- [ ] Implement ledger, indexes, protection trigger extension, unique partial indexes and RPCs.
- [ ] Add SQL cases for candidate union conflict, exact-one atomic update/finalize, duplicate event attempts and unmatched finalization.
- [ ] Run in disposable Supabase when available; otherwise record the environment blocker and perform static migration validation without claiming SQL green.

### Task 2: Shared encrypted event envelope

**Files:**
- Create: `supabase/functions/_shared/iap-linkage.ts`
- Create: `supabase/functions/_shared/iap-linkage.test.ts`

**Interfaces:**
- Produces `sha256Hex(value)`, `encryptIapSecret(value, base64Key, now)`, `safeEventLog(event)` and candidate normalization `distinctBusinessIds(...)`.
- Cipher result: `{ ciphertext: string; iv: string; deleteAfter: string; tokenHash: string }`.

- [ ] Write failing Deno tests for canonical SHA-256, AES-GCM round-trip/test vector shape, 90-day retention, deterministic distinct candidate union and raw-token-free log output.
- [ ] Implement minimal Web Crypto helpers with no environment access at module import time.
- [ ] Run focused Deno tests and type-check both webhook import paths.

### Task 3: Google webhook exact-one processing

**Files:**
- Modify: `supabase/functions/play-webhook/index.ts`
- Create: `supabase/functions/play-webhook/linkage.test.ts`

**Interfaces:**
- Consumes Task 1 RPCs and Task 2 crypto/candidate helpers.
- Google event id is Pub/Sub `messageId`; external account id resolves through `profiles.business_id`.

- [ ] Write failing pure tests proving token candidate A + profile candidate B is conflict, duplicated A is one match, and raw token never appears in operational output.
- [ ] Refactor resolution to collect the union before mutation.
- [ ] Begin encrypted ledger processing before finalization; call the atomic finalize RPC.
- [ ] Return retryable 500 for unmatched/conflict/error after ledger finalization; retain 200 for matched/test notifications.
- [ ] Run Google status/linkage tests and Deno check.

### Task 4: Apple webhook exact-one processing

**Files:**
- Modify: `supabase/functions/apple-webhook/index.ts`
- Create: `supabase/functions/apple-webhook/linkage.test.ts`

**Interfaces:**
- Consumes Task 1 RPCs and Task 2 helpers.
- Apple event id is `notificationUUID`; candidates are app-account profile business plus original-transaction business.

- [ ] Write failing pure tests for candidate conflict/idempotency and safe logging.
- [ ] Replace priority lookup with union resolution and guarded atomic finalization.
- [ ] Begin/finalize every authenticated subscription event; fail retryably when unresolved.
- [ ] Remove raw original transaction/account identifiers from logs.
- [ ] Run Apple status/linkage tests and Deno check.

### Task 5: Mobile real token and bounded recorder retry

**Files:**
- Create: `lib/features/payments/iap_linkage.dart`
- Create: `test/payments/iap_linkage_test.dart`
- Modify: `lib/providers/purchase_provider.dart`

**Interfaces:**
- Produces pure `selectIapIdentifier(provider, purchaseId, serverVerificationData, originalTransactionId)` and `retryIapLink(operation, delays)`.
- Google identifier is `serverVerificationData`; Apple identifier is original transaction id.

- [ ] Write failing tests for Google token selection (never GPA order id), Apple selection, missing identifier, success after retries and exhausted retries.
- [ ] Implement pure helper and focused green tests.
- [ ] Make purchase stream processing async; await three recorder attempts before `completePurchase`.
- [ ] On exhaustion keep temporary access, set exact verification-pending error, complete purchase, and persist no token.
- [ ] Run focused tests and the full Flutter suite against the recorded six-golden baseline.

### Task 6: Documentation and final verification

**Files:**
- Modify: `docs/domain/concepts/subscription-and-entitlement.md`
- Modify: `docs/domain/entities/business.md`

- [ ] Document ledger, encryption/retention, exact-one resolution, protected identity columns and deployment order.
- [ ] Run all Deno payment tests, web tests/build, mobile focused/full tests, `git diff --check`, secret scan and migration review.
- [ ] Request an independent final review focused on financial loss, token leakage, race conditions and rollback safety.
