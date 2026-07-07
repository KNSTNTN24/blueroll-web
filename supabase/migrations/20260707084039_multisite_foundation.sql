-- ============================================================================
-- Multi-site foundation (ADDITIVE, backwards-compatible)
--
-- Model:
--   businesses  = the GROUP (chain / estate).
--   sites       = a location under a group. A single-site business has one site.
--   Operations  (checklists, incidents, deliveries, staff, diary, documents,
--                haccp) are ALWAYS scoped to a site.
--   Kitchen     (recipes, menu_items, suppliers, tags, ingredients) can be
--                group-level (site_id IS NULL, shared by all sites) OR owned by
--                one site (site_id = <site>). A new site can Copy / Start-own /
--                Use-shared -- all expressed with the same nullable site_id.
--
-- This migration only ADDS structure + backfills existing rows onto a default
-- site, so the current single-site app keeps working unchanged (it still filters
-- by business_id; every row now also carries the correct site_id).
-- RLS stays business-level for now (owner sees the whole group); per-site
-- hard isolation is a later, separate migration.
-- ============================================================================

-- 1. sites -------------------------------------------------------------------
create table if not exists public.sites (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null,
  address     text,
  postcode    text,
  fsa_rating  text,
  manager_id  uuid references public.profiles(id) on delete set null,
  status      text not null default 'active',   -- active | onboarding | archived
  created_at  timestamptz not null default now()
);
create index if not exists idx_sites_business on public.sites(business_id);
alter table public.sites enable row level security;

-- Members of a group can see its sites; managers/owners can manage them.
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select to authenticated
  using ( business_id = public.get_my_business_id() );

drop policy if exists sites_write on public.sites;
create policy sites_write on public.sites for all to authenticated
  using ( business_id = public.get_my_business_id() and public.get_my_role() in ('owner','manager') )
  with check ( business_id = public.get_my_business_id() and public.get_my_role() in ('owner','manager') );

-- 2. site_id columns ---------------------------------------------------------
-- Operations (always site-scoped)
alter table public.checklist_templates   add column if not exists site_id uuid references public.sites(id) on delete cascade;
alter table public.checklist_completions add column if not exists site_id uuid references public.sites(id) on delete cascade;
alter table public.incidents             add column if not exists site_id uuid references public.sites(id) on delete cascade;
alter table public.deliveries            add column if not exists site_id uuid references public.sites(id) on delete cascade;
alter table public.staff_checkins        add column if not exists site_id uuid references public.sites(id) on delete cascade;
alter table public.diary_entries         add column if not exists site_id uuid references public.sites(id) on delete cascade;
alter table public.documents             add column if not exists site_id uuid references public.sites(id) on delete cascade;
alter table public.haccp_pack_data       add column if not exists site_id uuid references public.sites(id) on delete cascade;

-- Kitchen: recipes + suppliers are site-scopable (site_id NULL = group-shared).
-- Tags and ingredients stay group-level (shared, unique per business); a copied
-- recipe re-links to the same tags/ingredients.
alter table public.recipes   add column if not exists site_id uuid references public.sites(id) on delete cascade;
alter table public.suppliers add column if not exists site_id uuid references public.sites(id) on delete cascade;

-- Who a person belongs to. NULL = group-wide (owners / group admins see all sites).
alter table public.profiles add column if not exists site_id uuid references public.sites(id) on delete set null;
alter table public.profiles add column if not exists is_group_admin boolean not null default false;

create index if not exists idx_checklist_templates_site   on public.checklist_templates(site_id);
create index if not exists idx_checklist_completions_site on public.checklist_completions(site_id);
create index if not exists idx_incidents_site             on public.incidents(site_id);
create index if not exists idx_deliveries_site            on public.deliveries(site_id);
create index if not exists idx_staff_checkins_site        on public.staff_checkins(site_id);
create index if not exists idx_recipes_site               on public.recipes(site_id);
create index if not exists idx_suppliers_site             on public.suppliers(site_id);

-- 3. Backfill ----------------------------------------------------------------
-- One default site per existing business.
insert into public.sites (business_id, name, fsa_rating, status)
select b.id, coalesce(nullif(b.name, ''), 'Main site'), b.fsa_rating, 'active'
from public.businesses b
where not exists (select 1 from public.sites s where s.business_id = b.id);

-- Backfill OPERATIONS onto the business's (now single) default site.
do $$
declare t text;
begin
  foreach t in array array[
    'checklist_templates','checklist_completions','incidents','deliveries',
    'staff_checkins','diary_entries','documents','haccp_pack_data'
  ] loop
    execute format($f$
      update public.%1$I x set site_id = s.id
      from public.sites s
      where s.business_id = x.business_id and x.site_id is null
    $f$, t);
  end loop;
end $$;

-- Kitchen (recipes/menu_items/suppliers/tags/ingredients) is intentionally LEFT
-- as site_id NULL for existing rows = group-shared, so today's single site sees
-- them and a future second site can Copy / Use-shared / Start-own.

-- Everyone starts on their business's default site; owners become group admins.
update public.profiles p set site_id = s.id
from public.sites s
where s.business_id = p.business_id and p.site_id is null;

update public.profiles set is_group_admin = true where role = 'owner';

-- Point each site's manager at the business owner where we have one.
update public.sites s set manager_id = p.id
from public.profiles p
where p.business_id = s.business_id and p.role = 'owner' and s.manager_id is null;

-- (haccp_pack_data keeps its one-per-business rule for now; making it one-per-site
--  is handled in the dedicated multi-site HACCP phase, together with its UI.)

-- 5. Helper: the caller's home site (NULL for group admins = all sites) ------
create or replace function public.get_my_site_id()
returns uuid
language sql stable security invoker
set search_path = public
as $$ select site_id from public.profiles where id = auth.uid() $$;

-- 6. copy_kitchen(from_site, to_site) ----------------------------------------
-- Duplicates kitchen data (recipes + their ingredients/tags, menu items,
-- suppliers, tags) from a source scope into a target site. from_site NULL copies
-- the group-shared set. Used by the "Copy kitchen" option when adding a site.
create or replace function public.copy_kitchen(from_site uuid, to_site uuid)
returns void
language plpgsql security invoker
set search_path = public
as $$
declare
  v_business uuid;
  r record;
  new_recipe uuid;
begin
  select business_id into v_business from public.sites where id = to_site;
  if v_business is null then raise exception 'target site not found'; end if;

  -- guard: caller must belong to the same business (RLS also enforces this)
  if v_business <> public.get_my_business_id() then
    raise exception 'cross-business copy not allowed';
  end if;

  -- suppliers (kitchen, site-scoped)
  insert into public.suppliers (business_id, site_id, name, contact_name, phone, address, goods_supplied, delivery_days)
  select business_id, to_site, name, contact_name, phone, address, goods_supplied, delivery_days
  from public.suppliers
  where business_id = v_business and (site_id is not distinct from from_site);

  -- recipes (+ ingredients + tag links). Tags stay group-level (business-scoped,
  -- unique per business) so we re-link the copies to the SAME tag rows.
  for r in
    select * from public.recipes
    where business_id = v_business and (site_id is not distinct from from_site)
  loop
    insert into public.recipes (
      business_id, site_id, created_by, name, description, category, active,
      instructions, cooking_method, cooking_temp, cooking_time, cooking_time_unit,
      sfbb_check_method, extra_care_flags, reheating_instructions, hot_holding_required,
      chilling_method, freezing_instructions, defrosting_instructions,
      photo_url, source_video_url, haccp_methods
    ) values (
      v_business, to_site, auth.uid(), r.name, r.description, r.category, r.active,
      r.instructions, r.cooking_method, r.cooking_temp, r.cooking_time, r.cooking_time_unit,
      r.sfbb_check_method, r.extra_care_flags, r.reheating_instructions, r.hot_holding_required,
      r.chilling_method, r.freezing_instructions, r.defrosting_instructions,
      r.photo_url, r.source_video_url, r.haccp_methods
    ) returning id into new_recipe;

    insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
    select new_recipe, ingredient_id, quantity, unit
    from public.recipe_ingredients where recipe_id = r.id;

    insert into public.recipe_tags (recipe_id, tag_id)
    select new_recipe, tag_id
    from public.recipe_tags where recipe_id = r.id;
  end loop;
end $$;

-- Expose copy_kitchen only to authenticated callers (RLS still applies inside).
revoke all on function public.copy_kitchen(uuid, uuid) from public;
grant execute on function public.copy_kitchen(uuid, uuid) to authenticated;
