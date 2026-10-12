-- Tables an UNPAID business can still write to — the write gate never reached them.
--
-- This file documents CURRENT behaviour, not desired behaviour. Every line
-- reported as HOLE is a table that escapes the paywall. When a hole is closed,
-- this file starts reporting 'refused' for it — update the expectation then.
--
-- Found by sweeping pg_policy for client-writable tables with no
-- entitlement_write_gate_* policy, then confirming each one behaviourally.
begin;
create temp table result(table_name text, outcome text) on commit drop;
grant insert on result to authenticated;
do $$
declare
  v_biz uuid; v_uid uuid := gen_random_uuid(); v_site uuid; v_site2 uuid; v_rec uuid;
begin
  insert into public.businesses(name, manual_status, manual_until)
    values ('GAP_PROBE', 'canceled', now() - interval '30 days') returning id into v_biz;
  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated',
            'authenticated', 'gapprobe@example.test', now(), now());
  insert into public.profiles(id, email, full_name, role, business_id)
    values (v_uid, 'gapprobe@example.test', 'Gap Probe', 'owner', v_biz);
  select id into v_site from public.sites where business_id = v_biz limit 1;
  insert into public.sites(business_id, name) values (v_biz, 'Second site') returning id into v_site2;
  insert into public.recipes(business_id, name, created_by) values (v_biz, 'seed', v_uid) returning id into v_rec;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.menu_categories(business_id, site_id, name, sort_order)
      values (v_biz, v_site, 'gap', 0);
    insert into result values ('menu_categories', 'HOLE — unpaid business can create menu sections');
  exception when insufficient_privilege then insert into result values ('menu_categories', 'refused');
            when others then insert into result values ('menu_categories', 'err: ' || sqlerrm);
  end;

  begin
    insert into public.roles(business_id, name, base_tier, capabilities, is_system)
      values (v_biz, 'gap role', 'kitchen_staff', '{}', false);
    insert into result values ('roles', 'HOLE — unpaid business can create custom roles');
  exception when insufficient_privilege then insert into result values ('roles', 'refused');
            when others then insert into result values ('roles', 'err: ' || sqlerrm);
  end;

  begin
    insert into public.member_sites(profile_id, site_id) values (v_uid, v_site2);
    insert into result values ('member_sites', 'HOLE — unpaid business can grant site membership');
  exception when insufficient_privilege then insert into result values ('member_sites', 'refused');
            when others then insert into result values ('member_sites', 'err: ' || sqlerrm);
  end;

  begin
    insert into public.recipe_sites(recipe_id, site_id) values (v_rec, v_site2);
    insert into result values ('recipe_sites', 'HOLE — unpaid business can change recipe/site links');
  exception when insufficient_privilege then insert into result values ('recipe_sites', 'refused');
            when others then insert into result values ('recipe_sites', 'err: ' || sqlerrm);
  end;

  begin
    insert into public.member_capability_overrides(profile_id, capability, granted)
      values (v_uid, 'manage_recipes', true);
    insert into result values ('member_capability_overrides', 'HOLE — unpaid business can override capabilities');
  exception when insufficient_privilege then insert into result values ('member_capability_overrides', 'refused');
            when others then insert into result values ('member_capability_overrides', 'err: ' || sqlerrm);
  end;

  begin
    update public.businesses set name = 'renamed while unpaid' where id = v_biz;
    insert into result values ('businesses (non-entitlement columns)',
      case when found then 'HOLE — unpaid business can edit its own profile' else 'no row matched' end);
  exception when insufficient_privilege then insert into result values ('businesses', 'refused');
            when others then insert into result values ('businesses', 'err: ' || sqlerrm);
  end;

  reset role;
end $$;
select * from result order by table_name;
rollback;
