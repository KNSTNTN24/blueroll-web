-- Guard sites_sync_quantity() so a pg_net enqueue failure can never roll back
-- a legitimate site INSERT/DELETE. Same body as the live function
-- (see 20260713100100_sites_quantity_sync_trigger.sql), with the
-- net.http_post call wrapped in an exception handler, mirroring the pattern
-- used by public._subscription_arbiter().
create or replace function public.sites_sync_quantity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_biz uuid;
begin
  v_biz := coalesce(new.business_id, old.business_id);
  begin
    perform net.http_post(
      url := 'https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/sync-site-quantity',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_site_quantity_secret')
      ),
      body := jsonb_build_object('businessId', v_biz)
    );
  exception when others then
    raise warning 'sites_sync_quantity: pg_net enqueue failed for business %: %', v_biz, sqlerrm;
  end;
  return coalesce(new, old);
end $$;
