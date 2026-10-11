-- Recovered from prod migration history (version 20260411094847) on 2026-10-11.
-- Superseded by later migrations; join_with_invite was redefined afterwards.

-- 1. Modify join_with_invite so tokens starting with BLUEROLL-TEST are reusable
--    (all other tokens keep the existing one-time-use behaviour)
CREATE OR REPLACE FUNCTION public.join_with_invite(invite_token text, member_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_invite RECORD;
  v_user_id UUID;
  v_email TEXT;
  v_is_test BOOLEAN := (invite_token LIKE 'BLUEROLL-TEST%');
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'User already has a profile';
  END IF;

  -- Test tokens: match regardless of used_at. Normal tokens: one-time-use.
  SELECT * INTO v_invite
  FROM invites
  WHERE token = invite_token
    AND (v_is_test OR used_at IS NULL);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invite token';
  END IF;

  INSERT INTO profiles (id, email, full_name, role, business_id)
  VALUES (v_user_id, (SELECT email FROM auth.users WHERE id = v_user_id),
          member_name, v_invite.role, v_invite.business_id);

  -- Only burn non-test tokens
  IF NOT v_is_test THEN
    UPDATE invites SET used_at = NOW() WHERE id = v_invite.id;
  END IF;

  RETURN jsonb_build_object('success', true, 'business_id', v_invite.business_id);
END;
$function$;

-- 2. Insert (or upsert) the permanent test invite pointing to Maria's business.
--    Business: d472de8e-2354-4a28-a184-e8a192dda023 (The Green Kitchen)
--    Invited by: b8b5c1d2-9d15-4f0d-8029-a7f6f0b177db (Maria / mahin84@gmail.com)
INSERT INTO public.invites (email, role, business_id, invited_by, token, expires_at)
VALUES (
  'test@blueroll.dev',
  'kitchen_staff',
  'd472de8e-2354-4a28-a184-e8a192dda023',
  'b8b5c1d2-9d15-4f0d-8029-a7f6f0b177db',
  'BLUEROLL-TEST-2026',
  '2099-12-31 23:59:59+00'
)
ON CONFLICT (token) DO UPDATE
SET business_id = EXCLUDED.business_id,
    invited_by  = EXCLUDED.invited_by,
    role        = EXCLUDED.role,
    expires_at  = EXCLUDED.expires_at,
    used_at     = NULL;

-- 3. Put Maria's business into trialing state so subscription gating never
--    blocks her or testers who join via the code.
UPDATE public.businesses
SET subscription_status = 'trialing',
    trial_ends_at       = '2099-12-31 23:59:59+00'
WHERE id = 'd472de8e-2354-4a28-a184-e8a192dda023';
