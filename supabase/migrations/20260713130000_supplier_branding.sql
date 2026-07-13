alter table public.suppliers add column if not exists email text;
alter table public.suppliers add column if not exists website text;
alter table public.suppliers add column if not exists logo_url text;
alter table public.suppliers add column if not exists logo_domain text;
alter table public.suppliers add column if not exists logo_source text;
alter table public.suppliers add column if not exists logo_verified boolean not null default false;
alter table public.suppliers add column if not exists logo_updated_at timestamptz;

alter table public.suppliers drop constraint if exists suppliers_logo_source_check;
alter table public.suppliers add constraint suppliers_logo_source_check
  check (logo_source is null or logo_source in ('brandfetch', 'manual'));

alter table public.suppliers drop constraint if exists suppliers_logo_url_check;
alter table public.suppliers add constraint suppliers_logo_url_check
  check (logo_url is null or (char_length(logo_url) <= 2048 and logo_url like 'https://%'));

alter table public.suppliers drop constraint if exists suppliers_logo_domain_check;
alter table public.suppliers add constraint suppliers_logo_domain_check
  check (logo_domain is null or char_length(logo_domain) <= 253);

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

  if v_business <> public.get_my_business_id() then
    raise exception 'cross-business copy not allowed';
  end if;

  insert into public.suppliers (
    business_id, site_id, name, contact_name, phone, email, address,
    goods_supplied, delivery_days, notes, website, logo_url, logo_domain,
    logo_source, logo_verified, logo_updated_at
  )
  select
    business_id, to_site, name, contact_name, phone, email, address,
    goods_supplied, delivery_days, notes, website, logo_url, logo_domain,
    logo_source, logo_verified, logo_updated_at
  from public.suppliers
  where business_id = v_business and (site_id is not distinct from from_site);

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

revoke all on function public.copy_kitchen(uuid, uuid) from public;
grant execute on function public.copy_kitchen(uuid, uuid) to authenticated;
