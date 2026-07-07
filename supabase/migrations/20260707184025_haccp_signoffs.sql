-- Per-site HACCP sign-off: the pack is group-shared (one per business), but each
-- site's manager confirms it matches how their kitchen actually works. A site with
-- no row = pending. Group admins see the full estate; a site's own signer confirms it.
create table if not exists public.haccp_signoffs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  signed_by uuid references public.profiles(id) on delete set null,
  signed_by_name text,
  signed_at timestamptz not null default now(),
  unique (business_id, site_id)
);

alter table public.haccp_signoffs enable row level security;

drop policy if exists haccp_signoffs_select on public.haccp_signoffs;
create policy haccp_signoffs_select on public.haccp_signoffs
  for select using (business_id = public.get_my_business_id());

drop policy if exists haccp_signoffs_write on public.haccp_signoffs;
create policy haccp_signoffs_write on public.haccp_signoffs
  for all using (business_id = public.get_my_business_id())
  with check (business_id = public.get_my_business_id());

create index if not exists idx_haccp_signoffs_business on public.haccp_signoffs(business_id);
