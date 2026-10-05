-- supabase/tests/haccp_setup_verify.sql
-- Run ONCE after applying the migration with psql (needs \gset — the Management API can't run it), using the
-- Supabase DB DSN from ~/Secrets/blueroll/. Everything is rolled back:
--   psql "$DSN" -v biz=<uuid> -v site=<uuid> -v owner=<uuid> -f supabase/tests/haccp_setup_verify.sql
-- Replace :biz, :site, :owner with a TEST business you own (e.g. the demo account «Fern & Fig»), never a client.
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 1. session create/read as owner
insert into haccp_setup_sessions (business_id, site_id, questionnaire_version) values (:'biz', :'site', 1) returning id \gset sess_
-- 2. apply with one checklist and a pack
select apply_haccp_setup(:'sess_id', jsonb_build_object(
  'pack_expected_updated_at', (select updated_at from haccp_pack_data where business_id = :'biz'),
  'checklists', jsonb_build_array(jsonb_build_object('key', 'verify_tmp', 'name', 'Verify tmp', 'description', 'x',
     'frequency', 'daily', 'sfbb_section', 'cleaning', 'deadline_time', null, 'assigned_roles', jsonb_build_array('owner'),
     'items', jsonb_build_array(jsonb_build_object('name', 'T', 'item_type', 'temperature', 'required', true, 'min_value', 0, 'max_value', 5, 'unit', '°C'))))
));                                                                      -- expect {"created": 1, "items_added": 0}
select active, is_default, array_length(assigned_role_ids, 1) > 0 as has_role_ids
  from checklist_templates where business_id = :'biz' and library_key = 'verify_tmp';  -- expect f, f, t
-- 3. second apply on the same session is refused
select apply_haccp_setup(:'sess_id', '{}'::jsonb);                       -- expect ERROR already_applied
rollback;
-- 4. pack_changed: repeat steps 1–2 with 'pack_expected_updated_at' = '2000-01-01' → expect ERROR pack_changed; rollback.
-- Other RPC error codes (not exercised above): missing_key (a checklist without 'key'), empty_roles (no assigned_roles,
-- or none of them match a role of the business), forbidden (session site not a site of the session business).
