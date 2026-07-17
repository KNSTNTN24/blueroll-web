begin;
-- Resolve the throwaway owner uid *before* dropping to `authenticated` — once
-- the role is switched, RLS on profiles/businesses hides the row (auth.uid()
-- is still unset at that point), so this subquery would silently return NULL,
-- v_biz would end up NULL, the UPDATE below would match 0 rows, and the
-- `assert false` would fire as a false positive regardless of the trigger.
select set_config('request.jwt.claims',
  json_build_object('sub', (select p.id from public.profiles p join public.businesses b on b.id=p.business_id where b.name='Android Test Restaurant' and p.role='owner' limit 1),
                    'role','authenticated')::text, true);
set local role authenticated;
do $$
declare v_biz uuid;
begin
  select business_id into v_biz from public.profiles where id = auth.uid();
  begin
    update public.businesses set manual_status='active', manual_until=now()+interval '999 days' where id=v_biz;
    assert false, 'authenticated was able to self-grant entitlement';
  exception when insufficient_privilege then null;  -- expected
  end;

  -- positive assertion: authenticated owner can still update a non-entitlement column
  update public.businesses set name = name where id = v_biz;
end $$;
reset role;
select 'ALL PASS' as result;
rollback;
