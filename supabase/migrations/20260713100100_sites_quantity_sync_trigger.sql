create or replace function public.sites_sync_quantity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_biz uuid;
begin
  v_biz := coalesce(new.business_id, old.business_id);
  perform net.http_post(
    url := 'https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/sync-site-quantity',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_site_quantity_secret')
    ),
    body := jsonb_build_object('businessId', v_biz)
  );
  return coalesce(new, old);
end $$;

drop trigger if exists trg_sites_sync_quantity on public.sites;
create trigger trg_sites_sync_quantity
  after insert or delete on public.sites
  for each row execute function public.sites_sync_quantity();
