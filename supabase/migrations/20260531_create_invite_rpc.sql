-- Unified RPC for creating team invites.
--
-- Replaces ad-hoc client-side INSERTs that were generating inconsistent token
-- formats (web: 6-digit numeric, Flutter: 14-char base36+UniqueKey with stray
-- "]"). Now both clients call this RPC and get the same shape back.
--
-- Single source of truth lives in Postgres:
--   - 6-digit numeric tokens (easy to dictate over the phone)
--   - Uniqueness checked among *active* (not used, not expired) invites
--   - Permission gate (owner/manager only) inside the function so we can
--     return a friendly error instead of an opaque RLS denial
--   - 7-day expiry
--
-- Callers:
--   const { data, error } = await supabase.rpc('create_invite', {
--     p_email: 'cook@example.com',
--     p_role: 'kitchen_staff',
--   })
--   // data = [{ token: '847263', expires_at: '...', email: '...', role: '...' }]

CREATE OR REPLACE FUNCTION public.create_invite(
  p_email text,
  p_role text
)
RETURNS TABLE(token text, expires_at timestamptz, email text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_business_id uuid;
  v_my_role text;
  v_token text;
  v_email text;
  v_attempts int := 0;
BEGIN
  -- Resolve caller's business + role using existing helpers (they read from
  -- public.profiles with auth.uid()). SECURITY DEFINER bypasses RLS, but
  -- get_my_business_id()/get_my_role() are SECURITY DEFINER too and only
  -- ever look at the current user's own profile row, so this is safe.
  v_business_id := get_my_business_id();
  v_my_role := get_my_role();

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'No business linked to current user'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF v_my_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Only owners and managers can create invites (got: %)', v_my_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Role validation: must match profiles_role_check minus 'owner'
  -- (owners are seeded at signup, not invited).
  IF p_role NOT IN ('manager', 'chef', 'kitchen_staff', 'front_of_house') THEN
    RAISE EXCEPTION 'Invalid role: %. Must be one of: manager, chef, kitchen_staff, front_of_house', p_role
      USING ERRCODE = 'check_violation';
  END IF;

  -- Light email sanity (not full RFC validation — that's the client's job).
  v_email := lower(trim(p_email));
  IF v_email IS NULL OR position('@' IN v_email) < 2 OR position('.' IN v_email) < 3 THEN
    RAISE EXCEPTION 'Invalid email address: %', p_email
      USING ERRCODE = 'check_violation';
  END IF;

  -- Generate a 6-digit numeric token unique among currently active invites.
  -- Collision rate: 6 digits = 1M possible values, typical org has <10 active
  -- invites at a time → effectively zero collisions. The loop is a belt-and-
  -- braces in case we ever scale up.
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 100 THEN
      RAISE EXCEPTION 'Could not generate a unique invite token after 100 attempts'
        USING ERRCODE = 'internal_error';
    END IF;

    v_token := lpad(floor(random() * 1000000)::int::text, 6, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.invites i
      WHERE i.token = v_token
        AND i.used_at IS NULL
        AND i.expires_at > now()
    );
  END LOOP;

  -- Insert and return the canonical row. Using OUT parameters via the
  -- RETURNS TABLE signature so the JS client gets nicely typed fields.
  INSERT INTO public.invites (
    business_id, email, role, token, invited_by, expires_at
  ) VALUES (
    v_business_id,
    v_email,
    p_role,
    v_token,
    auth.uid(),
    now() + interval '7 days'
  )
  RETURNING invites.token, invites.expires_at, invites.email, invites.role
  INTO token, expires_at, email, role;

  RETURN NEXT;
END;
$$;

-- Lock down — only logged-in users can call it (anon/public can't).
REVOKE ALL ON FUNCTION public.create_invite(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_invite(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_invite(text, text) TO authenticated;

COMMENT ON FUNCTION public.create_invite(text, text) IS
'Creates a team invite for the caller''s business. Returns {token, expires_at, email, role}. Owner/manager only. 6-digit numeric token, unique among active invites, expires in 7 days.';
