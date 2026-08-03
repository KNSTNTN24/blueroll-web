-- Blueroll is not freemium: the paywall shows, the store takes the
-- subscription, and billing is deferred by the store's own 14-day free
-- trial (blueroll_pro_monthly_v3 carries a TWO_WEEKS FREE_TRIAL intro
-- offer, live since 2026-03-27).
--
-- This trigger granted every new business a SECOND, server-side 14-day
-- trial at signup, so subscription_status computed to 'trialing', the app
-- treated the user as entitled, and the router bounced them off /paywall
-- before the native payment sheet was ever shown. Nobody could subscribe.
drop trigger if exists trg_set_default_trial on public.businesses;
