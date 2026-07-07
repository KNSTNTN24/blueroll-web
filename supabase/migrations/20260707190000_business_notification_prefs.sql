-- Estate notification preferences (per group). Consumed by the Settings → Notifications tab.
alter table public.businesses
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;
