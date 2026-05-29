-- Columns needed to track native IAP subscriptions (App Store + Google Play)
-- alongside the existing Stripe columns. The webhook handlers
-- (apple-webhook, play-webhook) populate these and roll the resulting state
-- up into the shared subscription_status / trial_ends_at columns that the
-- web paywall already reads.
--
-- Why separate columns instead of just subscription_id:
--   - subscription_id is used by Stripe and uniqueness must be preserved.
--   - IAP identifiers don't fit Stripe's format (long opaque tokens for
--     Google, original_transaction_id for Apple) and we need to look up the
--     business by them in webhooks, so they need their own indexed columns.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS iap_provider TEXT
    CHECK (iap_provider IN ('apple', 'google')),
  ADD COLUMN IF NOT EXISTS iap_product_id TEXT,
  ADD COLUMN IF NOT EXISTS iap_purchase_token TEXT,            -- Google Play purchaseToken
  ADD COLUMN IF NOT EXISTS iap_original_transaction_id TEXT,   -- Apple originalTransactionId
  ADD COLUMN IF NOT EXISTS iap_expires_at TIMESTAMPTZ;

-- Lookups from the Play webhook: it knows only the purchase token and needs
-- to find the matching business row.
CREATE INDEX IF NOT EXISTS idx_businesses_iap_purchase_token
  ON public.businesses (iap_purchase_token)
  WHERE iap_purchase_token IS NOT NULL;

-- Same for Apple: webhook receives originalTransactionId and looks up.
CREATE INDEX IF NOT EXISTS idx_businesses_iap_original_transaction_id
  ON public.businesses (iap_original_transaction_id)
  WHERE iap_original_transaction_id IS NOT NULL;
