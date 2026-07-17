set search_path = public;

-- Seed 5 presets for every business that lacks them. Capability sets per the plan.
do $$
declare b record;
  base text[] := array['complete_checklists','view_reports','manage_incidents','manage_deliveries'];
  owner_caps text[] := array['manage_checklists','complete_checklists','sign_off','manage_recipes','manage_documents','view_documents','manage_incidents','manage_deliveries','manage_suppliers','manage_team','manage_roles','manage_sites','manage_billing','view_reports'];
  mgr_caps text[];
  chef_caps text[];
begin
  mgr_caps := base || array['manage_checklists','sign_off','manage_recipes','manage_documents','manage_suppliers','manage_team'];
  chef_caps := base || array['manage_recipes'];
  for b in select id from public.businesses where deleted_at is null loop
    insert into public.roles (business_id, name, base_tier, capabilities, is_system) values
      (b.id, 'Owner',          'owner',          owner_caps, true),
      (b.id, 'Manager',        'manager',        mgr_caps,   true),
      (b.id, 'Chef',           'chef',           chef_caps,  true),
      (b.id, 'Kitchen Staff',  'kitchen_staff',  base,       true),
      (b.id, 'Front of House', 'front_of_house', base,       true)
    on conflict (business_id, name) do nothing;
  end loop;
end $$;

-- Backfill every member's role_id from their legacy profiles.role (matched by base_tier).
update public.profiles p
set role_id = r.id
from public.roles r
where p.role_id is null
  and r.business_id = p.business_id
  and r.base_tier = p.role;
