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

  -- both entitlement columns must be cleared, not just manual_status
  assert not exists (
    select 1 from public.businesses
    where id = v_biz2 and (manual_status is not null or manual_until is not null)
  ), 'second business must have BOTH manual_status and manual_until cleared';
end $$;

-- Regression/concurrency-safety proof: consuming the SAME brand-new email
-- twice in immediate sequence must never raise (no unique_violation should
-- ever escape consume_trial, which is the whole point of the atomic-upsert
-- fix) — the second call must silently revoke, not error.
do $$
declare
  v_email2 text := lower('trial-dedup-race-' || floor(random()*1000000)::text || '@example.com');
  v_biz3 uuid;
  v_biz4 uuid;
  v_status3 text;
  v_status4 text;
begin
  insert into public.businesses(name) values ('TRIAL_DEDUP_TEST_3') returning id into v_biz3;
  update public.businesses set manual_status = 'trialing', manual_until = now() + interval '14 days' where id = v_biz3;

  insert into public.businesses(name) values ('TRIAL_DEDUP_TEST_4') returning id into v_biz4;
  update public.businesses set manual_status = 'trialing', manual_until = now() + interval '14 days' where id = v_biz4;

  perform public.consume_trial(v_email2, v_biz3);
  perform public.consume_trial(v_email2, v_biz4);  -- must not raise unique_violation

  select manual_status into v_status3 from public.businesses where id = v_biz3;
  select manual_status into v_status4 from public.businesses where id = v_biz4;
  assert v_status3 = 'trialing', 'first call for new email should keep trial';
  assert v_status4 is null, 'second call for same email (in sequence) should revoke without error';
end $$;

select 'ALL PASS' as result;
rollback;
