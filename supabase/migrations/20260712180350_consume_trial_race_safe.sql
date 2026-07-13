-- consume_trial had a check-then-act race: two concurrent setup_business
-- calls for the same brand-new email both saw `exists=false` and both tried
-- to INSERT the same trial_grants PK. The loser raised unique_violation,
-- which propagated out of consume_trial and rolled back the WHOLE calling
-- setup_business transaction (business + profile) -> a hard signup failure
-- under concurrency.
--
-- Fix: atomic upsert (INSERT ... ON CONFLICT DO NOTHING) + row-count check.
-- Exactly one concurrent caller's insert creates the grant row
-- (row_count = 1, keeps its trial); every other caller for that email gets
-- row_count = 0 and is revoked. No unique_violation ever escapes.
--
-- Sequential behavior is unchanged: new email -> keeps trial + records
-- grant; repeat email -> revoked.

create or replace function public.consume_trial(p_email text, p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_inserted int;
begin
  insert into public.trial_grants(email) values (lower(p_email))
  on conflict (email) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    -- email already had a trial (this call did not create the grant) → revoke this business's auto-trial
    update public.businesses set manual_status = null, manual_until = null where id = p_business_id;
  end if;
end $$;
