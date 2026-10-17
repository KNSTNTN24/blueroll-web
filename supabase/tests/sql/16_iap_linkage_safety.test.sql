-- Run only against a disposable database; all fixture writes roll back.
begin;

do $$
declare
  v_owner public.profiles%rowtype;
  v_other_profile public.profiles%rowtype;
  v_other_business uuid;
  v_event uuid;
  v_result jsonb;
  v_blocked boolean;
begin
  assert to_regclass('public.iap_events') is not null, 'iap_events table missing';
  assert has_function_privilege('authenticated', 'public.begin_iap_event(text,text,text,text,text,text,text,text,timestamptz)', 'EXECUTE') = false,
    'authenticated may begin server IAP events';
  assert has_function_privilege('authenticated', 'public.finalize_iap_event(text,text,text,text,text,text,timestamptz)', 'EXECUTE') = false,
    'authenticated may finalize server IAP events';

  select * into v_owner from public.profiles
  where role = 'owner' and business_id is not null
  order by created_at limit 1;
  assert v_owner.id is not null, 'owner fixture required';

  select * into v_other_profile from public.profiles
  where business_id is not null and business_id<>v_owner.business_id
  order by created_at limit 1;
  assert v_other_profile.id is not null, 'second profile fixture required';
  v_other_business := v_other_profile.business_id;

  -- Direct client writes to every identity column are blocked.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner.id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_blocked := false;
  begin
    update public.businesses set iap_provider='google', iap_product_id='p',
      iap_purchase_token='client-token', iap_original_transaction_id='client-tx', signup_trial=false
    where id=v_owner.business_id;
  exception when insufficient_privilege then v_blocked := true;
  end;
  assert v_blocked, 'authenticated user changed server-managed IAP identity';
  reset role;

  -- Owner RPC validates and is idempotent for the same business.
  set local role authenticated;
  perform public.record_iap_purchase('token-a', 'product-a', 'google');
  perform public.record_iap_purchase('token-a', 'product-a', 'google');
  reset role;

  update public.businesses set iap_purchase_token='token-conflict', iap_provider='google'
  where id=v_other_business;
  set local role authenticated;
  v_blocked := false;
  begin
    perform public.record_iap_purchase('token-conflict', 'product-a', 'google');
  exception when unique_violation then v_blocked := true;
  end;
  assert v_blocked, 'purchase token was reassigned from another business';
  reset role;

  -- Ledger first, then exact-one atomic finalization.
  select public.begin_iap_event('google','event-1','renewed','product-a','hash-a','cipher','iv','ACTIVE',now()+interval '1 month') into v_event;
  assert v_event is not null, 'event was not begun';
  select public.finalize_iap_event('google','event-1','token-a',v_owner.id::text,'active','product-a',now()+interval '1 month') into v_result;
  assert v_result->>'resolution' = 'matched', 'exact-one event did not match';
  assert (select resolution from public.iap_events where provider='google' and event_id='event-1') = 'matched', 'ledger not finalized';
  perform public.begin_iap_event('google','event-1','renewed','product-a','hash-a','different-cipher','different-iv','ACTIVE',now()+interval '1 month');
  select public.finalize_iap_event('google','event-1','token-a',v_other_profile.id::text,'active','product-a',now()+interval '1 month') into v_result;
  assert v_result->>'resolution' = 'matched', 'matched redelivery was re-resolved';
  assert (select business_id from public.iap_events where provider='google' and event_id='event-1') = v_owner.business_id, 'matched redelivery changed business';

  -- Conflicting candidate sources never mutate either business.
  perform public.begin_iap_event('google','event-2','renewed','product-a','hash-b','cipher','iv','ACTIVE',now()+interval '1 month');
  select public.finalize_iap_event('google','event-2','token-a',v_other_profile.id::text,'active','product-a',now()+interval '1 month') into v_result;
  assert v_result->>'resolution' = 'conflict', 'candidate union conflict was hidden';
  assert (select business_id from public.iap_events where provider='google' and event_id='event-2') is null, 'conflict attached to a business';

  -- Redelivery reuses the row, keeps first receipt and increments attempts.
  perform public.begin_iap_event('google','event-2','renewed','product-a','hash-b','cipher2','iv2','ACTIVE',now()+interval '1 month');
  assert (select count(*) from public.iap_events where provider='google' and event_id='event-2') = 1, 'redelivery duplicated event';
  assert (select attempt_count from public.iap_events where provider='google' and event_id='event-2') = 2, 'attempt count not incremented';

  perform public.begin_iap_event('google','event-3','renewed','product-a','hash-c','cipher','iv','ACTIVE',now());
  select public.finalize_iap_event('google','event-3','unknown-token',null,'active','product-a',now()) into v_result;
  assert v_result->>'resolution' = 'unmatched', 'zero candidates did not remain unmatched';

  update public.iap_events set token_delete_after=now()-interval '1 second' where event_id='event-3';
  perform public.purge_expired_iap_secrets();
  assert (select token_ciphertext is null and token_iv is null from public.iap_events where event_id='event-3'), 'expired encrypted token was retained';
end
$$;

rollback;
select 'IAP LINKAGE SAFETY TESTS PASSED' as result;
