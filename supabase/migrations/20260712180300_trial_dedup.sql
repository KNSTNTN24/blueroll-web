-- Task 4: dedup free trials by email.
-- set_default_trial (BEFORE INSERT on businesses) runs before the owner's
-- profile/email exists, so it cannot dedup by email. Instead, setup_business
-- (SECURITY DEFINER, runs after inserting the profile with the email) calls
-- consume_trial to check/record the email and revoke the auto-granted trial
-- on repeat signups.

create table if not exists public.trial_grants (
  email text primary key,
  granted_at timestamptz not null default now()
);
alter table public.trial_grants enable row level security;  -- no policies: clients cannot read/write; service/definer only

create or replace function public.consume_trial(p_email text, p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.trial_grants where email = lower(p_email)) then
    -- email already had a trial: revoke the auto-granted trial on this business
    update public.businesses set manual_status = null, manual_until = null where id = p_business_id;
  else
    insert into public.trial_grants(email) values (lower(p_email));
  end if;
end $$;

-- setup_business: add a call to consume_trial after the owner profile is
-- inserted (v_email and v_business_id are already available at that point).
-- Rest of the function body is unchanged from the current production
-- definition (fetched via pg_get_functiondef before this migration).
CREATE OR REPLACE FUNCTION public.setup_business(business_name text, owner_name text, business_address text DEFAULT NULL::text, p_fhrs_id integer DEFAULT NULL::integer, p_fsa_rating text DEFAULT NULL::text, p_post_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$ DECLARE v_user_id UUID; v_business_id UUID; v_email TEXT; BEGIN v_user_id := auth.uid(); IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF; IF EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id) THEN RAISE EXCEPTION 'User already has a profile'; END IF; SELECT email INTO v_email FROM auth.users WHERE id = v_user_id; INSERT INTO businesses (name, address, fhrs_id, fsa_rating, post_code) VALUES (business_name, business_address, p_fhrs_id, p_fsa_rating, p_post_code) RETURNING id INTO v_business_id; INSERT INTO profiles (id, email, full_name, role, business_id) VALUES (v_user_id, v_email, owner_name, 'owner', v_business_id); perform public.consume_trial(v_email, v_business_id); RETURN jsonb_build_object('success', true, 'business_id', v_business_id); END; $function$;

-- Backfill: existing owners' emails so current businesses aren't re-trialed
-- by a repeat signup with the same email.
insert into public.trial_grants(email, granted_at)
select distinct lower(p.email), min(b.created_at)
from public.profiles p join public.businesses b on b.id = p.business_id
where p.role = 'owner' and p.email is not null
group by lower(p.email)
on conflict (email) do nothing;
