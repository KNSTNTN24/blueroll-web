begin;
-- Resolve a real owner uid *before* dropping to `authenticated` — once the
-- role is switched, RLS hides profiles/businesses rows from this session
-- (auth.uid() is still unset at that point), so resolving after the switch
-- would silently yield NULL and make the negative assertion a false positive.
select set_config('request.jwt.claims',
  json_build_object('sub', (select p.id from public.profiles p join public.businesses b on b.id=p.business_id where p.role='owner' and b.deleted_at is null limit 1),
                    'role','authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    -- Direct client INSERT with entitlement columns pre-set — the self-grant
    -- hole: BEFORE UPDATE trigger only guards UPDATEs, so this INSERT path
    -- must be denied by RLS (no permissive INSERT policy after the fix).
    insert into public.businesses(name, manual_status, manual_until)
      values ('SELFGRANT_TEST', 'active', now() + interval '999 days');
    assert false, 'authenticated client was able to self-grant entitlement via direct INSERT';
  exception when insufficient_privilege then null;  -- expected: RLS denies the insert
  end;
end $$;
reset role;

-- Positive assertion: the legitimate creation path must still work. Real
-- business creation goes through setup_business(), a SECURITY DEFINER
-- function that runs with BYPASSRLS — service_role has the same effective
-- privilege, so it stands in for the RPC here without depending on
-- onboarding-only inputs (owner_name, etc).
set local role service_role;
do $$
declare v_biz uuid;
begin
  insert into public.businesses(name) values ('SELFGRANT_TEST_legit') returning id into v_biz;
  assert v_biz is not null, 'legitimate business creation path (setup_business-equivalent) broken';
end $$;
reset role;

select 'ALL PASS' as result;
rollback;
