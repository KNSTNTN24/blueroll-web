-- Test: create_recipe_with_ingredients (SECURITY DEFINER RPC) is gated by
-- public.is_business_entitled, so an unentitled business cannot use this RPC
-- to bypass the entitlement_write_gate restrictive RLS policies on recipes.
--
-- Runs entirely inside a rolled-back transaction. We reuse the existing
-- throwaway "Android Test Restaurant" fixture (a real business + owner profile
-- backed by a real auth.users row) rather than minting a new auth user — auth.users
-- has a notification trigger and we must not emit side effects.
--
-- CRITICAL: every id is resolved (into transaction-local GUCs) by the privileged
-- role BEFORE we switch to `authenticated`. After the role switch, any lookup on
-- profiles/businesses falls under RLS and would silently return NULL, producing a
-- false-positive pass.

begin;

-- ===== PRIVILEGED SETUP (resolve ids up front) =====
select set_config('grt.biz',
  (select b.id::text from public.businesses b
     join public.profiles p on p.business_id = b.id
    where b.name = 'Android Test Restaurant' and p.role = 'owner' limit 1), true);
select set_config('grt.owner',
  (select p.id::text from public.businesses b
     join public.profiles p on p.business_id = b.id
    where b.name = 'Android Test Restaurant' and p.role = 'owner' limit 1), true);

-- Fail loudly if the fixture is missing (would otherwise NULL out into false passes).
do $$ begin
  if nullif(current_setting('grt.biz', true), '') is null
     or nullif(current_setting('grt.owner', true), '') is null then
    raise exception 'FIXTURE MISSING: Android Test Restaurant owner not found';
  end if;
end $$;

-- Make the business UNentitled: expired trial on the manual channel, no stripe/iap
-- grace, not soft-deleted. subscription_status/trial_ends_at are recomputed by the
-- _subscription_arbiter trigger from these raw channel columns, so we set the raw
-- columns (never the computed ones).
update public.businesses set
  manual_status = 'trialing', manual_until = now() - interval '1 day',
  stripe_status = null, stripe_until = null,
  iap_status = null, iap_expires_at = null,
  deleted_at = null
  where id = current_setting('grt.biz')::uuid;

-- ===== IMPERSONATE THE OWNER (authenticated) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('grt.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- CHECK 1: unentitled owner calling create_recipe_with_ingredients must be DENIED.
do $$ begin
  begin
    perform public.create_recipe_with_ingredients(
      jsonb_build_object(
        'recipe', jsonb_build_object('name', 'GATE_RPC_UNENT'),
        'ingredients', '[]'::jsonb,
        'tags', '[]'::jsonb
      )
    );
    raise exception 'FAIL: unentitled owner was able to call create_recipe_with_ingredients';
  exception when insufficient_privilege then null;  -- expected: RPC guard denial
  end;
end $$;

-- No recipe row should have been created by the denied call.
do $$
declare n int;
begin
  select count(*) into n from public.recipes
   where business_id = current_setting('grt.biz')::uuid and name = 'GATE_RPC_UNENT';
  if n <> 0 then
    raise exception 'FAIL: denied RPC call still created % recipe row(s)', n;
  end if;
end $$;

-- ===== BACK TO PRIVILEGED: make the business ENTITLED =====
-- Drive the manual channel to 'active'; the arbiter recomputes subscription_status.
reset role;
update public.businesses set
  manual_status = 'active', manual_until = now() + interval '30 days'
  where id = current_setting('grt.biz')::uuid;

-- ===== IMPERSONATE AGAIN (authenticated) =====
set local role authenticated;

-- CHECK 2: entitled owner calling create_recipe_with_ingredients must SUCCEED.
do $$
declare
  v_result jsonb;
  v_recipe_id uuid;
  n int;
begin
  v_result := public.create_recipe_with_ingredients(
    jsonb_build_object(
      'recipe', jsonb_build_object('name', 'GATE_RPC_ENT'),
      'ingredients', '[]'::jsonb,
      'tags', '[]'::jsonb
    )
  );
  v_recipe_id := (v_result->>'recipe_id')::uuid;
  if v_recipe_id is null then
    raise exception 'FAIL: entitled RPC call did not return a recipe_id';
  end if;

  select count(*) into n from public.recipes
   where id = v_recipe_id and business_id = current_setting('grt.biz')::uuid
     and name = 'GATE_RPC_ENT';
  if n <> 1 then
    raise exception 'FAIL: entitled RPC call wrote % recipe row(s) (expected 1)', n;
  end if;
end $$;

reset role;
select 'ALL PASS' as result;
rollback;
