-- get_my_business_id() must return NULL (and thus block all child-table
-- RLS-gated access) once the caller's business is soft-deleted.
do $$
declare
  v_biz uuid := '468e902d-0aa3-4032-a134-932da49950b1';   -- Android Test Restaurant
  v_uid uuid := '914ab4b5-765d-426b-bb1e-d3e5f6179967';   -- its owner
  v_recipe uuid;
  v_result uuid;
  v_count int;
begin
  -- start from a known-clean state
  update businesses set deleted_at = null where id = v_biz;

  -- throwaway child row, inserted as SERVER (bypasses RLS)
  insert into recipes (name, business_id, created_by)
    values ('F1_TEST_RECIPE', v_biz, v_uid)
    returning id into v_recipe;

  -- become the owner (normal user)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Test A: business NOT deleted -> unchanged behavior
  select get_my_business_id() into v_result;
  assert v_result = v_biz,
    'A: get_my_business_id() should return the business id when not deleted, got ' || coalesce(v_result::text, 'NULL');

  select count(*) into v_count from recipes;
  assert v_count = 1,
    'A: owner should see the throwaway recipe when business is not deleted, got ' || v_count;

  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- soft-delete the business as SERVER (allowed)
  update businesses set deleted_at = now() where id = v_biz;

  -- become the owner again
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Test B: business soft-deleted -> function must return NULL, blocking child access
  select get_my_business_id() into v_result;
  assert v_result is null,
    'B: get_my_business_id() should return NULL when business is soft-deleted, got ' || v_result::text;

  select count(*) into v_count from recipes;
  assert v_count = 0,
    'B: owner should NOT see any recipes when business is soft-deleted, got ' || v_count;

  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- restore + cleanup as SERVER
  update businesses set deleted_at = null where id = v_biz;
  delete from recipes where id = v_recipe;
end $$;

select 'ALL PASS' as result;
