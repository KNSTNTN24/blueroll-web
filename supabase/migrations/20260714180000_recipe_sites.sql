set search_path = public;

-- Per-site menu membership over the shared recipe catalog.
-- A row = "this recipe is on this site's menu". recipes/its RLS are untouched.
create table if not exists public.recipe_sites (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  site_id   uuid not null references public.sites(id)   on delete cascade,
  primary key (recipe_id, site_id)
);
create index if not exists idx_recipe_sites_site on public.recipe_sites(site_id);
alter table public.recipe_sites enable row level security;

-- Read: business members see membership for sites they can see (group admins: all).
drop policy if exists recipe_sites_select on public.recipe_sites;
create policy recipe_sites_select on public.recipe_sites for select to authenticated
  using (recipe_id in (select id from public.recipes where business_id = public.get_my_business_id())
         and public.can_see_site_row(site_id));

-- Write: manage_recipes + membership of the target site (group admins: any).
drop policy if exists recipe_sites_write on public.recipe_sites;
create policy recipe_sites_write on public.recipe_sites for all to authenticated
  using (recipe_id in (select id from public.recipes where business_id = public.get_my_business_id())
         and public.has_capability('manage_recipes') and public.can_see_site_row(site_id))
  with check (recipe_id in (select id from public.recipes where business_id = public.get_my_business_id())
         and public.has_capability('manage_recipes') and public.can_see_site_row(site_id));

-- Backfill: every recipe on every site of its business (= today's "visible everywhere").
insert into public.recipe_sites (recipe_id, site_id)
select r.id, s.id
from public.recipes r
join public.sites s on s.business_id = r.business_id
on conflict do nothing;
