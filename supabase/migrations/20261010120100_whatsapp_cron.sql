-- supabase/migrations/20261010120100_whatsapp_cron.sql
-- Requires vault secret 'whatsapp_cron_secret' (same value as the function's WA_CRON_SECRET).
select cron.unschedule('whatsapp-reminders') where exists (select 1 from cron.job where jobname = 'whatsapp-reminders');
select cron.schedule('whatsapp-reminders', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/whatsapp-reminders',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_cron_secret')),
    body := '{}'::jsonb)
$$);
