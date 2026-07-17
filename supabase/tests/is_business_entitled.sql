begin;
do $$
declare v_biz uuid;
begin
  insert into public.businesses(name) values ('ENT_TEST') returning id into v_biz;

  -- active → entitled
  update public.businesses set manual_status='active', manual_until=now()+interval '30 days' where id=v_biz;
  assert public.is_business_entitled(v_biz), 'active not entitled';

  -- trialing not expired → entitled
  update public.businesses set manual_status='trialing', manual_until=now()+interval '3 days' where id=v_biz;
  assert public.is_business_entitled(v_biz), 'live trial not entitled';

  -- expired trial → NOT entitled
  update public.businesses set manual_status='trialing', manual_until=now()-interval '1 day' where id=v_biz;
  assert not public.is_business_entitled(v_biz), 'expired trial entitled';

  -- past_due within 7d grace → entitled
  update public.businesses set manual_status=null, manual_until=null,
    stripe_status='past_due', stripe_until=now()-interval '2 days' where id=v_biz;
  assert public.is_business_entitled(v_biz), 'past_due within grace not entitled';

  -- past_due beyond 7d grace → NOT entitled
  update public.businesses set stripe_until=now()-interval '10 days' where id=v_biz;
  assert not public.is_business_entitled(v_biz), 'past_due beyond grace entitled';

  -- soft-deleted active → NOT entitled
  update public.businesses set stripe_status=null, stripe_until=null,
    manual_status='active', manual_until=now()+interval '30 days', deleted_at=now() where id=v_biz;
  assert not public.is_business_entitled(v_biz), 'soft-deleted entitled';
end $$;
select 'ALL PASS' as result;
rollback;
