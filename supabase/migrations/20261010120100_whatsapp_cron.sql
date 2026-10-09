-- supabase/migrations/20261010120100_whatsapp_cron.sql
-- Requires vault secret 'whatsapp_cron_secret' (same value as the function's WA_CRON_SECRET).

-- Claim-before-send for one-off corrective steps: one nudge / one no-action alert per response, even across overlapping runs.
create unique index if not exists uq_channel_messages_claim on public.channel_messages_log(ref_id, kind)
  where kind in ('corrective_nudge','alert_no_action');

select cron.unschedule('whatsapp-reminders') where exists (select 1 from cron.job where jobname = 'whatsapp-reminders');
select cron.schedule('whatsapp-reminders', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/whatsapp-reminders',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$$);

-- Deferred Flow deprecation: a replaced flow stays live 25h (form tokens live 24h), then whatsapp-sync-flows' cron
-- path deprecates it and clears these columns.
alter table public.channel_flows
  add column if not exists prev_flow_id text,
  add column if not exists prev_replaced_at timestamptz;
