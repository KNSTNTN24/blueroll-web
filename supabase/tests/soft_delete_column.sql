-- Test A: column exists
do $$ begin
  assert (select count(*) from information_schema.columns
          where table_name='businesses' and column_name='deleted_at') = 1,
    'deleted_at column missing';
end $$;

do $$
declare
  v_biz uuid; v_uid uuid; v_visible int;
begin
  -- pick a throwaway business + its owner
  select b.id, p.id into v_biz, v_uid
  from businesses b join profiles p on p.business_id=b.id and p.role='owner'
  where b.name='Android Test Restaurant' limit 1;

  -- make sure it starts live (in case a previous run left it dangling)
  update businesses set deleted_at = null where id = v_biz;

  -- become the owner (normal user)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Test C (checked first, while the row is still visible to the owner):
  -- client must NOT be able to set deleted_at directly (revoked column grant
  -- + protective trigger both apply -> insufficient_privilege)
  begin
    update businesses set deleted_at = now() where id = v_biz;
    assert false, 'authenticated was able to write deleted_at';
  exception when insufficient_privilege then null;  -- expected
  end;

  reset role;
  perform set_config('request.jwt.claims', null, true);
end $$;

do $$
declare
  v_biz uuid; v_uid uuid; v_visible int;
begin
  select b.id, p.id into v_biz, v_uid
  from businesses b join profiles p on p.business_id=b.id and p.role='owner'
  where b.name='Android Test Restaurant' limit 1;

  -- soft-delete it as SERVER (allowed)
  update businesses set deleted_at = now() where id = v_biz;

  -- become the owner (normal user)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Test B: RLS must hide the soft-deleted business from its own owner
  select count(*) into v_visible from businesses where id = v_biz;
  assert v_visible = 0, 'soft-deleted business still visible to owner via RLS';

  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- cleanup: restore as SERVER
  update businesses set deleted_at = null where id = v_biz;
end $$;

select 'ALL PASS' as result;
