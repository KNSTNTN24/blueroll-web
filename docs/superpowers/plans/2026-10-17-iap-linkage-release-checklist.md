# IAP Linkage Safety Release Checklist

Deploy in this order: database, encryption secret, Edge Functions, then mobile.

## 1. Preflight

- [ ] Confirm there are no duplicate non-null `iap_purchase_token` values.
- [ ] Confirm there are no duplicate non-null `iap_original_transaction_id` values.
- [ ] Confirm every non-null `iap_provider` agrees with the populated provider identifier.
- [ ] Confirm a rollback owner and a release monitoring window.
- [ ] Generate a new 32-byte `IAP_EVENT_ENCRYPTION_KEY`; store it only in the production secret manager.

The migration deliberately aborts if identifier duplicates or inconsistent provider data exist. Resolve those rows manually; never select a winner automatically.

## 2. Database

- [ ] Apply `20261017130000_iap_linkage_safety.sql`.
- [ ] Verify both partial unique indexes exist and are valid.
- [ ] Verify `iap_events` is inaccessible to `anon` and `authenticated`.
- [ ] Verify `begin_iap_event`, `finalize_iap_event`, and `purge_iap_event_secrets` are executable only by `service_role`.
- [ ] Verify the entitlement-protection trigger is installed on `businesses`.
- [ ] Run `16_iap_linkage_safety.test.sql` in a disposable database using the release migration set.

Do not deploy either webhook until all database checks pass.

## 3. Secret and Edge Functions

- [ ] Set `IAP_EVENT_ENCRYPTION_KEY` before deploying the Google Play webhook.
- [ ] Deploy `play-webhook` and `apple-webhook` together.
- [ ] Send provider test notifications.
- [ ] Confirm every authenticated subscription notification creates or reuses one ledger event before acknowledgement.
- [ ] Confirm matched redelivery is idempotent.
- [ ] Confirm unmatched and conflicting notifications return a retryable response.
- [ ] Confirm logs contain no raw purchase token, signed transaction, or encrypted payload.

## 4. Mobile

- [ ] Release the mobile build only after both production webhooks are healthy.
- [ ] Test one new Google purchase and one restore using `serverVerificationData`.
- [ ] Test one new Apple purchase and one restore using the original transaction identifier.
- [ ] Confirm the linkage RPC completes before store transaction completion.
- [ ] Confirm exhausted linkage retries show the verification-pending state and never grant permanent local entitlement.
- [ ] Confirm purchase-stream batches remain serialized under redelivery.

## 5. Monitoring

- [ ] Alert on `unmatched`, `conflict`, `error`, and long-lived `processing` ledger rows.
- [ ] Track webhook retry rate and entitlement update failures by provider.
- [ ] Review identifier-conflict events individually; do not repair them with a bulk reassignment.
- [ ] Confirm encrypted unmatched Google tokens are purged after the configured 90-day retention.

## Rollback

1. Pause the mobile rollout or return to the previous mobile build.
2. Roll back both Edge Functions together.
3. Keep the database migration, unique indexes, and ledger in place unless a separate reviewed migration removes them. They are backward-compatible safety controls and preserve the audit trail.
4. Keep `IAP_EVENT_ENCRYPTION_KEY` available while retained encrypted events exist; rotate through an explicit re-encryption plan, never by simply replacing the secret.

Rollback does not mean deleting ledger events or weakening uniqueness constraints. If the database migration itself blocks deployment because of preflight data, stop before the webhook phase and repair the data explicitly.
