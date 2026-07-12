create or replace function public.protect_business_entitlement()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Deliberately NOT `security definer`: this function only needs to read
  -- NEW/OLD (passed in by the trigger executor) and inspect current_user, it
  -- never needs elevated privileges. If it were security definer, current_user
  -- inside the function body would always resolve to the function OWNER
  -- (whichever privileged role created it), never to the actual caller's role
  -- — which would make this check permanently false and the trigger a no-op.
  -- Running as security invoker (the default) lets current_user correctly
  -- reflect the live role chain: 'authenticated'/'anon' for direct client
  -- writes (blocked below), 'service_role' for webhooks, and the owner role
  -- of SECURITY DEFINER RPCs such as setup_business/consume_trial (Task 4)
  -- while those RPCs are executing (allowed below).
  if current_user in ('authenticated','anon') and (
       new.manual_status is distinct from old.manual_status
    or new.manual_until is distinct from old.manual_until
    or new.stripe_status is distinct from old.stripe_status
    or new.stripe_until is distinct from old.stripe_until
    or new.iap_status is distinct from old.iap_status
    or new.iap_expires_at is distinct from old.iap_expires_at
    or new.subscription_id is distinct from old.subscription_id
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.subscription_status is distinct from old.subscription_status
    or new.trial_ends_at is distinct from old.trial_ends_at
  ) then
    raise insufficient_privilege using message = 'entitlement columns are server-managed';
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_business_entitlement on public.businesses;
create trigger trg_protect_business_entitlement
  before update on public.businesses
  for each row execute function public.protect_business_entitlement();
