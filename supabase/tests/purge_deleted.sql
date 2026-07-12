-- purge_deleted_businesses() purges ANY business soft-deleted >30 days ago
-- on the live database, not just this test's own fixtures. Wrap the whole
-- test (fixtures + the real purge call + asserts) in a transaction that is
-- always rolled back, so nothing here — including any effect the purge has
-- on real >30-day-old soft-deleted businesses elsewhere in the database —
-- is ever persisted.
begin;

do $$
declare v_old uuid; v_recent uuid; v_profile uuid;
begin
  -- business deleted 31 days ago (should be purged) + a child row
  insert into businesses (name, deleted_at) values ('PURGE_OLD', now() - interval '31 days')
    returning id into v_old;
  insert into recipes (name, business_id, created_by) values ('r', v_old, '1f4da622-f5ce-4643-b634-e0c5fc2fe0fb');

  -- profile + a real (throwaway) auth.users row, so we can prove the
  -- associated auth user is deleted by the purge too (profiles.id has an
  -- FK to auth.users.id, so this must be a real row there)
  v_profile := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email)
    values (v_profile, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'purge-test@example.invalid');
  insert into profiles (id, email, role, business_id)
    values (v_profile, 'purge-test@example.invalid', 'owner', v_old);

  -- business deleted 10 days ago (should survive)
  insert into businesses (name, deleted_at) values ('PURGE_RECENT', now() - interval '10 days')
    returning id into v_recent;

  -- the REAL function, purging any real >30-day-deleted business too --
  -- safe only because this whole transaction gets rolled back below.
  perform public.purge_deleted_businesses();

  assert (select count(*) from businesses where id = v_old) = 0, 'old business not purged';
  assert (select count(*) from recipes where business_id = v_old) = 0, 'old child rows not purged';
  assert (select count(*) from profiles where id = v_profile) = 0, 'old profile not purged';
  assert (select count(*) from auth.users where id = v_profile) = 0, 'auth user not purged';
  assert (select count(*) from businesses where id = v_recent) = 1, 'recent business wrongly purged';
end $$;

select 'ALL PASS' as result;

rollback;
