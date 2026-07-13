begin;
do $$
declare
  v_email text := lower('trial-dedup-test-' || floor(random()*1000000)::text || '@example.com');
  v_biz1 uuid;
  v_biz2 uuid;
  v_status1 text;
  v_status2 text;
begin
  -- two throwaway businesses, both auto-trialed on insert (set_default_trial)
  insert into public.businesses(name) values ('TRIAL_DEDUP_TEST_1') returning id into v_biz1;
  update public.businesses set manual_status = 'trialing', manual_until = now() + interval '14 days' where id = v_biz1;

  insert into public.businesses(name) values ('TRIAL_DEDUP_TEST_2') returning id into v_biz2;
  update public.businesses set manual_status = 'trialing', manual_until = now() + interval '14 days' where id = v_biz2;

  -- first call for a fresh email: trial on v_biz1 is kept, email recorded in trial_grants
  perform public.consume_trial(v_email, v_biz1);

  select manual_status into v_status1 from public.businesses where id = v_biz1;
  assert v_status1 = 'trialing', 'first business should keep its auto-granted trial';
  assert exists (select 1 from public.trial_grants where email = v_email),
    'trial_grants should have a row for the email after first call';

  -- second call, same email, a different (also trialing) business: trial must be revoked
  perform public.consume_trial(v_email, v_biz2);

  select manual_status into v_status2 from public.businesses where id = v_biz2;
  assert v_status2 is null, 'second business for a repeat email should end up unentitled (manual_status null)';
end $$;
select 'ALL PASS' as result;
rollback;
