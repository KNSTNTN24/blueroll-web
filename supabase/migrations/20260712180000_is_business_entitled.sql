create or replace function public.is_business_entitled(p_business_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.businesses b
    where b.id = p_business_id
      and b.deleted_at is null
      and (
        -- computed live status
        (b.subscription_status = 'active')
        or (b.subscription_status = 'trialing'
            and (b.trial_ends_at is null or b.trial_ends_at > now()))
        -- 7-day payment grace on a failed renewal (raw channels)
        or (b.stripe_status = 'past_due' and b.stripe_until is not null
            and b.stripe_until > now() - interval '7 days')
        or (b.iap_status in ('past_due','in_grace','on_hold') and b.iap_expires_at is not null
            and b.iap_expires_at > now() - interval '7 days')
      )
  );
$$;
