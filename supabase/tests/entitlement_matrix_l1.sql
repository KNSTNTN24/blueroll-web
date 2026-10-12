-- L1 — the entitlement arbiter, exhaustively.
--
-- compute_entitlement() is pure, so this file calls it directly: no rows are
-- written and the transaction rolls back regardless.
--
-- Expectations are written from the SPEC (2026-06-07), not from the function's
-- own logic:
--   a source is live  <=> status in (active, trialing, canceling)
--                         AND (until is null OR until > now())
--   winner            = latest until, null = infinity, ties manual > iap > stripe
--   'canceling'         is published as 'active'
--   no live source    -> 'canceled' if any source ever existed, else 'none',
--                        with until = max(until) across sources
--
-- 72 single-source cases (3 channels x 8 statuses x 3 until positions)
-- + 12 multi-source cases.
begin;
do $$
declare
  v_chan       text;
  v_status     text;
  v_until_kind text;
  v_until      timestamptz;
  v_exp_status text;
  v_exp_until  timestamptz;
  r            record;
  n            int := 0;
  future       timestamptz := now() + interval '30 days';
  past         timestamptz := now() - interval '30 days';
begin
  foreach v_chan in array array['manual','iap','stripe'] loop
    foreach v_status in array array['active','trialing','canceling','past_due',
                                    'paused','incomplete','canceled','__null__'] loop
      foreach v_until_kind in array array['null','future','past'] loop

        v_until := case v_until_kind when 'future' then future
                                     when 'past'   then past
                                     else null end;

        -- Expected result, straight from the spec.
        if v_status = '__null__' then
          v_exp_status := 'none';        -- no source ever existed
          v_exp_until  := null;
        elsif v_status in ('active','trialing','canceling')
              and (v_until is null or v_until > now()) then
          v_exp_status := case when v_status = 'canceling' then 'active' else v_status end;
          v_exp_until  := v_until;
        else
          v_exp_status := 'canceled';    -- a source exists but nothing is live
          v_exp_until  := v_until;
        end if;

        select * into r from public.compute_entitlement(
          case when v_chan = 'manual' and v_status <> '__null__' then v_status end,
          case when v_chan = 'manual' and v_status <> '__null__' then v_until  end,
          case when v_chan = 'stripe' and v_status <> '__null__' then v_status end,
          case when v_chan = 'stripe' and v_status <> '__null__' then v_until  end,
          case when v_chan = 'iap'    and v_status <> '__null__' then v_status end,
          case when v_chan = 'iap'    and v_status <> '__null__' then v_until  end);

        n := n + 1;

        assert r.status = v_exp_status,
          format('ENT-%s/%s/%s: status expected %s, got %s',
                 v_chan, v_status, v_until_kind, v_exp_status, r.status);
        assert r.until_ts is not distinct from v_exp_until,
          format('ENT-%s/%s/%s: until expected %s, got %s',
                 v_chan, v_status, v_until_kind, v_exp_until, r.until_ts);
      end loop;
    end loop;
  end loop;

  assert n = 72, format('expected 72 single-source cases, ran %s', n);
  raise notice 'L1 single-source: % cases passed', n;
end $$;

-- ── Multi-source cases ───────────────────────────────────────────────────────
do $$
declare
  r      record;
  future timestamptz := now() + interval '30 days';
  far    timestamptz := now() + interval '400 days';
  past   timestamptz := now() - interval '30 days';
begin
  -- 01 Farkhod regression: a live manual grant beats an expired stripe trial
  select * into r from public.compute_entitlement('active', far, 'trialing', past, null, null);
  assert r.status = 'active' and r.until_ts = far, 'MULTI-01 ' || r.status;

  -- 02 live IAP beats a dead stripe subscription
  select * into r from public.compute_entitlement(null, null, 'canceled', past, 'active', future);
  assert r.status = 'active' and r.until_ts = future, 'MULTI-02 ' || r.status;

  -- 03 unbounded (null) beats any date
  select * into r from public.compute_entitlement('active', far, 'active', null, null, null);
  assert r.status = 'active' and r.until_ts is null, 'MULTI-03 ' || r.status;

  -- 04 tie on null: manual wins over iap
  select * into r from public.compute_entitlement('trialing', null, null, null, 'active', null);
  assert r.status = 'trialing', 'MULTI-04 expected manual to win, got ' || r.status;

  -- 05 tie on null: iap wins over stripe
  select * into r from public.compute_entitlement(null, null, 'active', null, 'trialing', null);
  assert r.status = 'trialing', 'MULTI-05 expected iap to win, got ' || r.status;

  -- 06 canceling is never published, even against a dead sibling
  select * into r from public.compute_entitlement(null, null, 'canceling', future, 'canceled', past);
  assert r.status = 'active' and r.until_ts = future, 'MULTI-06 ' || r.status;

  -- 07 everything expired -> canceled, until = latest end date (for display)
  select * into r from public.compute_entitlement('trialing', past, 'canceled', now() - interval '5 days', null, null);
  assert r.status = 'canceled', 'MULTI-07 ' || r.status;
  assert r.until_ts = now() - interval '5 days', 'MULTI-07 until ' || r.until_ts;

  -- 08 no source at all -> none
  select * into r from public.compute_entitlement(null, null, null, null, null, null);
  assert r.status = 'none' and r.until_ts is null, 'MULTI-08 ' || r.status;

  -- 09 later until wins across channels
  select * into r from public.compute_entitlement('active', future, null, null, 'active', far);
  assert r.until_ts = far, 'MULTI-09 expected the later until, got ' || r.until_ts;

  -- 10 a dead source does not drag down a live one
  select * into r from public.compute_entitlement('canceled', past, 'active', future, null, null);
  assert r.status = 'active' and r.until_ts = future, 'MULTI-10 ' || r.status;

  -- 11 past_due is not live even alongside a live trial: the trial wins, and the
  --    published status is the trial's, not past_due
  select * into r from public.compute_entitlement('trialing', future, 'past_due', far, null, null);
  assert r.status = 'trialing' and r.until_ts = future, 'MULTI-11 ' || r.status;

  -- 12 all three live: latest until wins outright
  select * into r from public.compute_entitlement('active', now() + interval '1 day',
                                                  'active', future, 'active', far);
  assert r.until_ts = far, 'MULTI-12 ' || r.until_ts;

  raise notice 'L1 multi-source: 12 cases passed';
end $$;
select 'ALL PASS' as result;
rollback;
