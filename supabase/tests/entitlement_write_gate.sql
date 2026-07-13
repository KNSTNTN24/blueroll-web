-- Test: RESTRICTIVE entitlement write-gate on business tables.
--
-- Proves the `entitlement_write_gate` restrictive INSERT/UPDATE policies:
--   1. An UNentitled (expired-trial) business's owner CANNOT insert into recipes.
--   2. Once the same business is entitled, the owner CAN insert into recipes.
--   3. SELECT of a pre-existing row is UNAFFECTED while unentitled (reads stay open).
--
-- Runs entirely inside a rolled-back transaction. We reuse the existing
-- throwaway "Android Test Restaurant" fixture (a real business + owner profile
-- backed by a real auth.users row) rather than minting a new auth user — auth.users
-- has a notification trigger and we must not emit side effects.
--
-- CRITICAL: every id is resolved (into transaction-local GUCs) by the privileged
-- role BEFORE we switch to `authenticated`. After the role switch, any lookup on
-- profiles/businesses falls under RLS and would silently return NULL, producing a
-- false-positive pass. GUCs set with is_local=true survive the role switch and are
-- readable by any role, so we never re-query business/owner ids while impersonating.

begin;

-- ===== PRIVILEGED SETUP (resolve ids up front) =====
select set_config('wg.biz',
  (select b.id::text from public.businesses b
     join public.profiles p on p.business_id = b.id
    where b.name = 'Android Test Restaurant' and p.role = 'owner' limit 1), true);
select set_config('wg.owner',
  (select p.id::text from public.businesses b
     join public.profiles p on p.business_id = b.id
    where b.name = 'Android Test Restaurant' and p.role = 'owner' limit 1), true);

-- Fail loudly if the fixture is missing (would otherwise NULL out into false passes).
do $$ begin
  if nullif(current_setting('wg.biz', true), '') is null
     or nullif(current_setting('wg.owner', true), '') is null then
    raise exception 'FIXTURE MISSING: Android Test Restaurant owner not found';
  end if;
end $$;

-- Seed a pre-existing recipe (privileged) so the SELECT-unaffected check has a row.
insert into public.recipes (name, business_id, created_by)
  values ('WG_PREEXISTING', current_setting('wg.biz')::uuid, current_setting('wg.owner')::uuid)
  returning set_config('wg.recipe', id::text, true);

-- Make the business UNentitled: expired trial on the manual channel, no stripe/iap
-- grace, not soft-deleted. subscription_status/trial_ends_at are recomputed by the
-- _subscription_arbiter trigger from these raw channel columns, so we set the raw
-- columns (never the computed ones).
update public.businesses set
  manual_status = 'trialing', manual_until = now() - interval '1 day',
  stripe_status = null, stripe_until = null,
  iap_status = null, iap_expires_at = null,
  deleted_at = null
  where id = current_setting('wg.biz')::uuid;

-- ===== IMPERSONATE THE OWNER (authenticated) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('wg.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- CHECK 1: unentitled INSERT into recipes must be DENIED by the restrictive gate.
do $$ begin
  begin
    insert into public.recipes (name, business_id, created_by)
      values ('WG_UNENT', current_setting('wg.biz')::uuid, auth.uid());
    raise exception 'FAIL: unentitled owner was able to INSERT into recipes';
  exception when insufficient_privilege then null;  -- expected: RLS restrictive denial
  end;
end $$;

-- CHECK 3: SELECT of the pre-existing recipe is UNAFFECTED while unentitled.
do $$
declare n int;
begin
  select count(*) into n from public.recipes where id = current_setting('wg.recipe')::uuid;
  if n <> 1 then
    raise exception 'FAIL: unentitled SELECT of existing recipe returned % rows (expected 1)', n;
  end if;
end $$;

-- ===== BACK TO PRIVILEGED: make the business ENTITLED =====
-- Drive the manual channel to 'active'; the arbiter recomputes subscription_status.
reset role;
update public.businesses set
  manual_status = 'active', manual_until = now() + interval '30 days'
  where id = current_setting('wg.biz')::uuid;

-- ===== IMPERSONATE AGAIN (authenticated) =====
set local role authenticated;

-- CHECK 2: entitled INSERT into recipes must SUCCEED.
do $$
declare n int;
begin
  insert into public.recipes (name, business_id, created_by)
    values ('WG_ENT', current_setting('wg.biz')::uuid, auth.uid());
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: entitled owner INSERT wrote % rows (expected 1)', n;
  end if;
end $$;

reset role;
select 'ALL PASS' as result;
rollback;
