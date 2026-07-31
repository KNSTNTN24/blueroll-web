set search_path = public;

-- ============================================================================
-- Per-site menu categories (ADDITIVE)
--   menu_categories: each site's ordered, editable list of menu sections.
--   menu_items.site_categories jsonb: { "<site_id>": "<menu_categories.id>" }.
-- Legacy menu_items.category is kept; grouping moves to site_categories.
-- Backfill migrates every existing dish into per-site categories so day-one
-- grouping is unchanged.
-- ============================================================================

create table if not exists public.menu_categories (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  site_id     uuid not null references public.sites(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);
-- Postgres table-level UNIQUE constraints only accept column names, not
-- expressions, so the case-insensitive per-site uniqueness (and the
-- ON CONFLICT (site_id, lower(name)) target used by the backfill below)
-- is enforced via a unique expression index instead.
create unique index if not exists ux_menu_categories_site_lower_name on public.menu_categories(site_id, lower(name));
create index if not exists idx_menu_categories_site on public.menu_categories(business_id, site_id, sort_order);

alter table public.menu_items
  add column if not exists site_categories jsonb not null default '{}'::jsonb;

alter table public.menu_categories enable row level security;

drop policy if exists "Members read menu categories" on public.menu_categories;
create policy "Members read menu categories" on public.menu_categories
  for select using (business_id = public.get_my_business_id());

drop policy if exists "Managers manage menu categories" on public.menu_categories;
create policy "Managers manage menu categories" on public.menu_categories
  for all using (business_id = public.get_my_business_id() and public.has_capability('manage_recipes'))
  with check (business_id = public.get_my_business_id() and public.has_capability('manage_recipes'));

-- ── Backfill ──────────────────────────────────────────────────────────────
-- For each (business, site) with dishes, create a menu_categories row per
-- distinct legacy category label used by that site's dishes, ordered by the
-- canonical DISH_CATS order, then point each dish's site_categories[site] at it.
do $$
declare
  r record;
  cat_order text[] := array['Starters','Mains','Sides','Desserts','Other'];
  lbl text;
  new_id uuid;
begin
  -- one row per (business, site, category label) actually in use
  for r in
    select distinct mi.business_id, s.site_id,
      case lower(coalesce(mi.category,''))
        when 'starter' then 'Starters' when 'starters' then 'Starters'
        when 'main' then 'Mains'       when 'mains' then 'Mains'
        when 'side' then 'Sides'       when 'sides' then 'Sides'
        when 'dessert' then 'Desserts' when 'desserts' then 'Desserts'
        else 'Other' end as label
    from public.menu_items mi
    cross join lateral unnest(coalesce(mi.site_ids, '{}')) as s(site_id)
  loop
    lbl := r.label;
    insert into public.menu_categories (business_id, site_id, name, sort_order)
    values (r.business_id, r.site_id, lbl, coalesce(array_position(cat_order, lbl), 99))
    on conflict (site_id, lower(name)) do nothing;
  end loop;

  -- assign each dish's site_categories[site] to the matching category id
  for r in
    select mi.id as dish_id, s.site_id,
      case lower(coalesce(mi.category,''))
        when 'starter' then 'Starters' when 'starters' then 'Starters'
        when 'main' then 'Mains'       when 'mains' then 'Mains'
        when 'side' then 'Sides'       when 'sides' then 'Sides'
        when 'dessert' then 'Desserts' when 'desserts' then 'Desserts'
        else 'Other' end as label
    from public.menu_items mi
    cross join lateral unnest(coalesce(mi.site_ids, '{}')) as s(site_id)
  loop
    select id into new_id from public.menu_categories
      where site_id = r.site_id and lower(name) = lower(r.label) limit 1;
    if new_id is not null then
      update public.menu_items
        set site_categories = coalesce(site_categories, '{}'::jsonb) || jsonb_build_object(r.site_id::text, new_id::text)
        where id = r.dish_id;
    end if;
  end loop;
end $$;
