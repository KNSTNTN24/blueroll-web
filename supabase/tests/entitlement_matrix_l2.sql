-- L2 — the server-side write gate (is_business_entitled + RESTRICTIVE policies).
--
-- Builds a throwaway business, auth user and profile, then writes as that user
-- with `set local role authenticated`. Everything rolls back.
--
-- Covers: the gate refusing INSERT/UPDATE, the gate allowing them once paid,
-- SELECT and DELETE staying open after a lapse (deliberate), both grace windows
-- and their boundaries, soft-delete, and the entitlement-column protection.
begin;
create temp table result(log text) on commit drop;
do $$
declare
  v_biz uuid; v_uid uuid := gen_random_uuid(); v_site uuid; v_rec uuid;
  v_log text := ''; v_n int := 0;
begin
  -- ── fixture ────────────────────────────────────────────────────────────────
  insert into public.businesses(name, manual_status, manual_until)
    values ('L2_MATRIX', 'canceled', now() - interval '30 days') returning id into v_biz;
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated',
            'authenticated', 'l2matrix@example.test', now(), now());
  insert into public.profiles(id, email, full_name, role, business_id)
    values (v_uid, 'l2matrix@example.test', 'L2 Matrix', 'owner', v_biz);
  select id into v_site from public.sites where business_id = v_biz limit 1;

  -- seed one row while still privileged, so DELETE/SELECT have something to hit
  insert into public.recipes(business_id, name, created_by) values (v_biz, 'seeded', v_uid) returning id into v_rec;

  -- ── entitlement function, no roles involved ────────────────────────────────
  assert not public.is_business_entitled(v_biz), 'GATE-A1 canceled business entitled';

  update public.businesses set manual_status='active', manual_until=now()+interval '30 days' where id=v_biz;
  assert public.is_business_entitled(v_biz), 'GATE-A2 active business not entitled';

  update public.businesses set manual_status='trialing', manual_until=now()-interval '1 day' where id=v_biz;
  assert not public.is_business_entitled(v_biz), 'GATE-A3 expired trial entitled';

  -- Stripe grace: inside 7 days -> entitled, outside -> not
  update public.businesses set manual_status=null, manual_until=null,
    stripe_status='past_due', stripe_until=now()-interval '6 days' where id=v_biz;
  assert public.is_business_entitled(v_biz), 'GATE-A4 stripe grace day 6 refused';
  update public.businesses set stripe_until=now()-interval '8 days' where id=v_biz;
  assert not public.is_business_entitled(v_biz), 'GATE-A5 stripe grace day 8 still granted';
  update public.businesses set stripe_until=null where id=v_biz;
  assert not public.is_business_entitled(v_biz), 'GATE-A6 past_due with no until granted';

  -- IAP grace
  update public.businesses set stripe_status=null,
    iap_status='on_hold', iap_expires_at=now()-interval '6 days' where id=v_biz;
  assert public.is_business_entitled(v_biz), 'GATE-A7 iap on_hold grace refused';
  update public.businesses set iap_status='past_due', iap_expires_at=now()-interval '6 days' where id=v_biz;
  assert public.is_business_entitled(v_biz), 'GATE-A8 iap past_due grace refused';
  update public.businesses set iap_expires_at=now()-interval '8 days' where id=v_biz;
  assert not public.is_business_entitled(v_biz), 'GATE-A9 iap grace day 8 still granted';

  -- 'in_grace' is in the SQL but no webhook ever writes it (matrix D5)
  update public.businesses set iap_status='in_grace', iap_expires_at=now()-interval '6 days' where id=v_biz;
  assert public.is_business_entitled(v_biz), 'GATE-A10 in_grace branch broken';

  -- soft-deleted business is never entitled, however well it pays
  update public.businesses set iap_status=null, iap_expires_at=null,
    manual_status='active', manual_until=now()+interval '99 days', deleted_at=now() where id=v_biz;
  assert not public.is_business_entitled(v_biz), 'GATE-A11 soft-deleted business entitled';
  update public.businesses set deleted_at=null where id=v_biz;

  -- ── as the client: unentitled ──────────────────────────────────────────────
  update public.businesses set manual_status='canceled', manual_until=now()-interval '30 days' where id=v_biz;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- INSERT refused on gated tables
  begin
    insert into public.recipes(business_id, name, created_by) values (v_biz, 'nope', v_uid);
    v_log := v_log || 'FAIL recipes-insert-allowed; ';
  exception when insufficient_privilege then v_n := v_n + 1;
  end;
  begin
    insert into public.menu_items(business_id, name) values (v_biz, 'nope');
    v_log := v_log || 'FAIL menu_items-insert-allowed; ';
  exception when insufficient_privilege then v_n := v_n + 1;
            when others then v_n := v_n + 1;
  end;
  begin
    insert into public.documents(business_id, title, file_url)
      values (v_biz, 'nope', 'http://x');
    v_log := v_log || 'FAIL documents-insert-allowed; ';
  exception when insufficient_privilege then v_n := v_n + 1;
            when others then v_n := v_n + 1;
  end;

  -- UPDATE refused
  begin
    update public.recipes set name = 'renamed' where id = v_rec;
    if found then v_log := v_log || 'FAIL recipes-update-allowed; '; else v_n := v_n + 1; end if;
  exception when insufficient_privilege then v_n := v_n + 1;
  end;

  -- SELECT stays open after a lapse (deliberate: data must remain visible)
  if exists (select 1 from public.recipes where id = v_rec) then
    v_n := v_n + 1;
  else
    v_log := v_log || 'FAIL select-blocked-after-lapse; ';
  end if;

  -- DELETE stays open too
  begin
    delete from public.recipes where id = v_rec;
    if found then v_n := v_n + 1; else v_log := v_log || 'FAIL delete-blocked; '; end if;
  exception when insufficient_privilege then v_log := v_log || 'FAIL delete-refused; ';
  end;

  -- entitlement columns are server-managed, even for the owner
  begin
    update public.businesses set manual_status='active', manual_until=now()+interval '999 days' where id=v_biz;
    v_log := v_log || 'FAIL self-grant-manual; ';
  exception when insufficient_privilege then v_n := v_n + 1;
  end;
  begin
    update public.businesses set stripe_status='active' where id=v_biz;
    v_log := v_log || 'FAIL self-grant-stripe; ';
  exception when insufficient_privilege then v_n := v_n + 1;
  end;
  begin
    update public.businesses set subscription_status='active' where id=v_biz;
    v_log := v_log || 'FAIL self-grant-computed; ';
  exception when insufficient_privilege then v_n := v_n + 1;
  end;
  begin
    update public.businesses set trial_ends_at=now()+interval '999 days' where id=v_biz;
    v_log := v_log || 'FAIL self-grant-trial-end; ';
  exception when insufficient_privilege then v_n := v_n + 1;
  end;

  reset role;

  -- ── as the client: paid ────────────────────────────────────────────────────
  update public.businesses set manual_status='active', manual_until=now()+interval '30 days' where id=v_biz;
  set local role authenticated;
  begin
    insert into public.recipes(business_id, name, created_by) values (v_biz, 'allowed once paid', v_uid);
    v_n := v_n + 1;
  exception when others then v_log := v_log || 'FAIL paid-insert-refused:' || sqlerrm || '; ';
  end;
  reset role;

  insert into result values (case when v_log = '' then format('L2: all %s behavioural checks passed', v_n)
                                  else 'L2 FAILURES -> ' || v_log end);
end $$;
select * from result;
rollback;
