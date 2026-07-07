-- New businesses auto-create a default site, so every group (including new
-- single-site signups) has at least one site for the switcher / Settings -> Sites.
create or replace function public.create_default_site()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.sites (business_id, name, fsa_rating, status)
  values (new.id, coalesce(nullif(new.name, ''), 'Main site'), new.fsa_rating, 'active');
  return new;
end $$;

drop trigger if exists trg_business_default_site on public.businesses;
create trigger trg_business_default_site
  after insert on public.businesses
  for each row execute function public.create_default_site();
