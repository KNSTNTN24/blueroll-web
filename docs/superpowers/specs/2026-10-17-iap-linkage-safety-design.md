# IAP Linkage Safety — Design

## Intent

Stop Apple/Google subscription events from being silently lost, attached to the wrong business, or overwriting a different store purchase. This is the first payment P0 slice from issue #124; it protects the point where money already moved and BlueRoll must retain a durable, inspectable link to the payer.

## Scope

1. Mobile records Google's actual purchase token (`verificationData.serverVerificationData`), never the GPA order id.
2. Every Apple/Google subscription notification is recorded in a server-only `iap_events` ledger before any entitlement mutation. Google purchase tokens are stored only as AES-256-GCM ciphertext for 90 days, plus a SHA-256 correlation hash; Apple transaction ids are treated as store identifiers, not secrets.
3. Events record whether they resolved to exactly one business, no business, or a conflict. Unmatched/conflicting notifications return a retryable failure after the ledger write instead of a silent 200.
4. Webhooks resolve first, then update exactly one business. A duplicated token never updates multiple businesses.
5. `record_iap_purchase` rejects a token/transaction already owned by another business and refuses to overwrite the identifiers of a different provider. It remains owner-only.
6. Direct authenticated writes to all IAP identity columns and `signup_trial` are blocked by `protect_business_entitlement`.

## Non-goals

- No production migration or webhook deployment in this task.
- No refunds, cancellation of the known orphan Play order, or live customer-row repair.
- No daily Play/App Store reconciliation job yet.
- No redesign of entitlement/paywall formulas (#72) or Stripe authentication (#64) in this slice.
- No simultaneous Apple + Google subscriptions on one business yet. The current single-column schema cannot represent both safely; this slice rejects cross-provider overwrite rather than losing the first purchase. A later migration will introduce one subscription row per provider.
- Apple x5c chain validation (#70) remains a separate security slice because it requires Apple trust-root/library integration.

## Data model

`public.iap_events` is service-only and append-oriented:

- `id uuid`, `provider ('apple'|'google')`, `event_id text`, unique `(provider,event_id)` for idempotent retries;
- `event_type`, `product_id`, `external_reference`, `token_sha256`, `token_ciphertext`, `token_iv`, `token_delete_after`, `store_status`, `expires_at`;
- nullable `business_id` with `ON DELETE SET NULL`;
- immutable `business_id_snapshot uuid` for financial attribution without retaining a name/email;
- `resolution ('processing'|'matched'|'unmatched'|'conflict'|'error')`, `error_code`, `received_at`, `last_attempt_at`, `attempt_count`, `processed_at`;
- no plaintext raw payload, signed JWS, email, or service credential.

RLS is enabled, table privileges are revoked from `anon`/`authenticated`, and edge functions use the service role. Repeated delivery of the same store event preserves first `received_at`, increments `attempt_count`, and updates only processing fields. Operational indexes cover `(resolution, received_at)` and `business_id`.

`IAP_EVENT_ENCRYPTION_KEY` is a 32-byte base64 Supabase secret. The webhook encrypts/decrypts with Web Crypto AES-256-GCM. Ciphertext is retained for 90 days so a reconciliation function can replay an orphan Google purchase; a later cleanup job clears ciphertext/IV while keeping the non-secret audit record.

## Webhook flow

1. Authenticate and validate the store notification as today.
2. Fetch canonical state from the store API.
3. Insert/upsert the ledger row as `processing`. Failure stops processing.
4. Resolve the **union** of all candidates without mutating `businesses`:
   - Google: exact purchase token first, then the obfuscated Supabase user id through `profiles.business_id`.
   - Apple: `appAccountToken` through `profiles.business_id`, then original transaction id.
5. Distinct candidate cardinality must equal one. Token→business A plus external user→business B is a conflict, never a priority choice.
6. A service-only database RPC locks the candidate and event, enforces provider/identifier compatibility, updates exactly one business and finalizes the ledger atomically. None/multiple candidates finalize as `unmatched`/`conflict` without changing entitlement.
7. Unmatched/conflicting events return 500 after finalization so the store retries. Logs contain event ids and hashes only; current raw-token/original-id warnings are removed.

## Mobile flow

The purchase recorder is split into a pure token selector and the Supabase call. Google uses `serverVerificationData`, Apple keeps the original transaction id. The async purchase handler retries server recording three times with short backoff, then completes the store transaction to avoid leaving it pending. A failure keeps temporary local access but sets an actionable "Payment received — verification pending" error; webhook retries and a later restore remain recovery paths. No raw token is persisted in SharedPreferences.

## Security and failure rules

- Client input never sets entitlement status; only verified webhooks do.
- A token already belonging to another business is a hard conflict, not a reassignment.
- Cross-provider replacement is rejected until the schema supports multiple subscriptions.
- Ledger insertion failure causes webhook failure; observability is part of accepting payment.
- Event identifiers are store message UUID/id; token hashes are correlation aids, not authentication.
- Partial unique indexes enforce one business per non-null Google token and Apple original transaction id. The migration performs a duplicate preflight and raises a descriptive exception before creating them; it never chooses a winner.
- `protect_business_entitlement` covers `iap_provider`, `iap_product_id`, `iap_purchase_token`, `iap_original_transaction_id`, `iap_status`, `iap_expires_at`, and `signup_trial`.

## Deployment order

1. Inspect and resolve any duplicate live IAP identifiers; apply the DB migration (ledger, protection, uniqueness, RPCs).
2. Set `IAP_EVENT_ENCRYPTION_KEY`, deploy both webhooks, and verify test notifications create ledger rows.
3. Release mobile with the real Google purchase token and awaited recorder.
4. Monitor `unmatched|conflict|error`; do not remove compatibility columns until the multi-provider follow-up ships.

## Follow-up payment slices

1. Multiple provider subscriptions per business plus daily reconciliation (#124).
2. Unified server entitlement for DB/web/mobile and stale-status recomputation (#72).
3. Authenticated, owner-scoped Stripe checkout (#64) and deployed paid-period fix.
4. Apple certificate-chain validation (#70) and store cancellation during account deletion (#73).
