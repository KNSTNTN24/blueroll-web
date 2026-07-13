begin;
do $$
declare v_biz uuid; v_n int;
begin
  insert into public.businesses(name) values ('BSC_TEST') returning id into v_biz;
  -- create_default_site trigger makes 1 site; add 2 more
  insert into public.sites(business_id, name, status) values (v_biz,'s2','active'),(v_biz,'s3','onboarding');
  -- one archived (must NOT count)
  insert into public.sites(business_id, name, status) values (v_biz,'s4','archived');
  v_n := public.billable_site_count(v_biz);
  assert v_n = 3, format('expected 3 billable sites, got %s', v_n);  -- default + active + onboarding, archived excluded
end $$;
select 'ALL PASS' as result;
rollback;
