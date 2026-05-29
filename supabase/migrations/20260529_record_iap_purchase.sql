-- record_iap_purchase: called by the mobile app immediately after a successful
-- native purchase (Google Play or App Store). It only stores the token and the
-- product so the webhook can match the business by token. It does NOT flip
-- subscription_status to 'active' — that's the webhook's job, after Google or
-- Apple confirms the subscription state via its API. Until then the local
-- SharedPreferences flag on the device keeps the user out of the paywall.
--
-- Security: SECURITY DEFINER so it can write to businesses regardless of RLS.
-- It reads auth.uid() and refuses if the caller is not the owner of the
-- target business — staff/chefs can't accidentally register a purchase that
-- isn't theirs.

CREATE OR REPLACE FUNCTION public.record_iap_purchase(
  p_token TEXT,
  p_product_id TEXT,
  p_provider TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_business_id UUID;
  v_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_provider NOT IN ('apple', 'google') THEN
    RAISE EXCEPTION 'Invalid provider: %', p_provider;
  END IF;

  SELECT business_id, role
    INTO v_business_id, v_role
    FROM public.profiles
   WHERE id = v_user_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'User has no profile';
  END IF;
  IF v_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can record a purchase';
  END IF;

  IF p_provider = 'google' THEN
    UPDATE public.businesses
       SET iap_provider = 'google',
           iap_product_id = p_product_id,
           iap_purchase_token = p_token
     WHERE id = v_business_id;
  ELSE
    -- Apple sends the originalTransactionId; we store it in the same slot
    -- the apple-webhook will look up by.
    UPDATE public.businesses
       SET iap_provider = 'apple',
           iap_product_id = p_product_id,
           iap_original_transaction_id = p_token
     WHERE id = v_business_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'business_id', v_business_id);
END;
$$;

-- Allow authenticated users to call this. Authorization is enforced inside the
-- function body (owner-only check above).
GRANT EXECUTE ON FUNCTION public.record_iap_purchase(TEXT, TEXT, TEXT)
  TO authenticated;
