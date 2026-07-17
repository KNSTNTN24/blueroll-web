-- Reschedule the daily purge cron job to call the purge-deleted-businesses
-- edge function (which handles physical storage-blob deletion via the
-- Storage API, then calls purge_deleted_businesses() for the DB rows)
-- instead of calling purge_deleted_businesses() directly.
--
-- The shared secret used to authenticate the cron -> edge function call is
-- stored in Vault under the name 'purge_cron_secret' (seeded out-of-band,
-- not via this migration, so the literal secret value never lands in
-- migration history / git). See supabase/functions/purge-deleted-businesses.

select cron.unschedule('purge-deleted-businesses')
  where exists (select 1 from cron.job where jobname = 'purge-deleted-businesses');

select cron.schedule('purge-deleted-businesses', '0 3 * * *',
  $$
  select net.http_post(
    url:='https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/purge-deleted-businesses',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'purge_cron_secret')
    ),
    body:='{}'::jsonb
  );
  $$
);
