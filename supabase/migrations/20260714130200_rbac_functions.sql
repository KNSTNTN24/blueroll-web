set search_path = public;

-- Effective capability check (Phase 1: role caps only; owner short-circuits). Definer.
create or replace function public.has_capability(cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and (r.base_tier = 'owner' or cap = any(r.capabilities))
  )
$$;
grant execute on function public.has_capability(text) to authenticated;

-- Keep profiles.role (text) in sync with the assigned role's base_tier (mobile back-compat).
create or replace function public.sync_profile_role_text()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role_id is not null then
    select base_tier into new.role from public.roles where id = new.role_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_profile_role on public.profiles;
create trigger trg_sync_profile_role before insert or update of role_id on public.profiles
  for each row execute function public.sync_profile_role_text();

-- New businesses auto-seed the 5 presets (compose with existing create_default_site).
create or replace function public.seed_business_roles()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text[] := array['complete_checklists','view_reports','manage_incidents','manage_deliveries'];
begin
  insert into public.roles (business_id, name, base_tier, capabilities, is_system) values
    (new.id, 'Owner','owner', array['manage_checklists','complete_checklists','sign_off','manage_recipes','manage_documents','view_documents','manage_incidents','manage_deliveries','manage_suppliers','manage_team','manage_roles','manage_sites','manage_billing','view_reports'], true),
    (new.id, 'Manager','manager', base || array['manage_checklists','sign_off','manage_recipes','manage_documents','manage_suppliers','manage_team'], true),
    (new.id, 'Chef','chef', base || array['manage_recipes'], true),
    (new.id, 'Kitchen Staff','kitchen_staff', base, true),
    (new.id, 'Front of House','front_of_house', base, true)
  on conflict (business_id, name) do nothing;
  return new;
end $$;
drop trigger if exists trg_seed_business_roles on public.businesses;
create trigger trg_seed_business_roles after insert on public.businesses
  for each row execute function public.seed_business_roles();

-- Switch roles management from owner-string to the capability.
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
  using (business_id = public.get_my_business_id() and public.has_capability('manage_roles'))
  with check (business_id = public.get_my_business_id() and public.has_capability('manage_roles'));
