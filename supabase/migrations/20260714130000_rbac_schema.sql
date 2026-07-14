set search_path = public;

-- Canonical capability catalog (reference table = typo guard for roles.capabilities).
create table if not exists public.capability_catalog (cap text primary key);
insert into public.capability_catalog(cap) values
  ('manage_checklists'),('complete_checklists'),('sign_off'),('manage_recipes'),
  ('manage_documents'),('view_documents'),('manage_incidents'),('manage_deliveries'),
  ('manage_suppliers'),('manage_team'),('manage_roles'),('manage_sites'),
  ('manage_billing'),('view_reports')
on conflict do nothing;

create table if not exists public.roles (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null,
  base_tier    text not null check (base_tier in ('owner','manager','chef','kitchen_staff','front_of_house')),
  capabilities text[] not null default '{}',
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (business_id, name)
);
create index if not exists idx_roles_business on public.roles(business_id);
alter table public.roles enable row level security;

-- Validate every capability string against the catalog (defensive trigger).
create or replace function public.validate_role_capabilities()
returns trigger language plpgsql set search_path = public as $$
declare bad text;
begin
  select c into bad from unnest(new.capabilities) c
  where c not in (select cap from public.capability_catalog) limit 1;
  if bad is not null then raise exception 'unknown capability: %', bad; end if;
  return new;
end $$;
drop trigger if exists trg_validate_role_caps on public.roles;
create trigger trg_validate_role_caps before insert or update on public.roles
  for each row execute function public.validate_role_capabilities();

-- profiles.role_id (profiles.role text stays for mobile back-compat).
alter table public.profiles add column if not exists role_id uuid references public.roles(id) on delete set null;
create index if not exists idx_profiles_role_id on public.profiles(role_id);

-- RLS for roles: members see their business's roles; managing needs manage_roles
-- (helper created in Task 3 — this policy references it, so this migration is applied
--  AFTER Task 3's function exists; see ordering note). For now (pre-helper) create a
-- provisional owner-only manage policy that Task 3 replaces.
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated
  using (business_id = public.get_my_business_id());
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
  using (business_id = public.get_my_business_id() and public.get_my_role() = 'owner')
  with check (business_id = public.get_my_business_id() and public.get_my_role() = 'owner');
