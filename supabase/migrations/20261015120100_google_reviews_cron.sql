-- supabase/migrations/20261015120100_google_reviews_cron.sql
-- Requires vault secret 'reviews_cron_secret' (same value as the function's REVIEWS_CRON_SECRET).
select cron.unschedule('google-reviews-sync') where exists (select 1 from cron.job where jobname = 'google-reviews-sync');
select cron.schedule('google-reviews-sync', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/google-reviews-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reviews_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
$$);
