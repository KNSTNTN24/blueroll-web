do $$
declare v_old uuid; v_recent uuid;
begin
  -- business deleted 31 days ago (should be purged) + a child row
  insert into businesses (name, deleted_at) values ('PURGE_OLD', now() - interval '31 days')
    returning id into v_old;
  insert into recipes (name, business_id, created_by) values ('r', v_old, '1f4da622-f5ce-4643-b634-e0c5fc2fe0fb');

  -- business deleted 10 days ago (should survive)
  insert into businesses (name, deleted_at) values ('PURGE_RECENT', now() - interval '10 days')
    returning id into v_recent;

  perform public.purge_deleted_businesses();

  assert (select count(*) from businesses where id = v_old) = 0, 'old business not purged';
  assert (select count(*) from recipes where business_id = v_old) = 0, 'old child rows not purged';
  assert (select count(*) from businesses where id = v_recent) = 1, 'recent business wrongly purged';

  delete from businesses where id = v_recent;  -- cleanup
end $$;
select 'ALL PASS' as result;
