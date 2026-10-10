-- supabase/tests/whatsapp_channel_verify.sql
-- Run via the Management API as ONE DO block; it always raises at the end so everything rolls back.
-- Uses the demo business «Fern & Fig» (owner 981197ca-…), never a client.
do $v$
declare
  biz uuid := '2693f7de-c0ba-4d52-bbe9-602106eac784';
  owner uuid := '981197ca-3648-4c6c-9f18-ff7b6ae68786';
  other_biz_profile uuid; staff uuid; non_manager uuid; ident uuid;
  res jsonb := '{}'; n int; v_code text;
begin
  select id into other_biz_profile from profiles where business_id <> biz and removed_at is null limit 1;
  select id into non_manager from profiles
   where business_id = biz and role not in ('owner','manager') and removed_at is null limit 1;
  -- the profile that gets soft-removed is always distinct from the non-manager used for the toggle test
  select id into staff from profiles
   where business_id = biz and id <> owner and id is distinct from non_manager and removed_at is null limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- owner can flip the switch
  update businesses set whatsapp_enabled = true where id = biz;
  res := res || jsonb_build_object('toggle', (select whatsapp_enabled from businesses where id = biz));
  -- owner issues a code for own staff through the RPC (server-generated 6 digits)
  v_code := issue_link_code(owner);
  res := res || jsonb_build_object('code_own', case when v_code ~ '^[0-9]{6}$' then 'ok' else 'BAD: ' || coalesce(v_code, 'null') end);
  -- cannot issue for another business's profile
  begin
    perform issue_link_code(other_biz_profile);
    res := res || '{"code_foreign":"ALLOWED (BAD)"}';
  exception when others then res := res || jsonb_build_object('code_foreign', 'rejected'); end;
  -- direct client INSERT is denied (no INSERT policy)
  begin
    insert into channel_link_codes (code, business_id, profile_id) values ('654321', biz, owner);
    res := res || '{"code_direct_insert":"ALLOWED (BAD)"}';
  exception when others then res := res || jsonb_build_object('code_direct_insert', 'rejected'); end;
  -- service-role-only tables are invisible to the owner
  select count(*) into n from channel_form_tokens; res := res || jsonb_build_object('tokens_visible', n);
  execute 'reset role';

  -- a non-manager cannot flip whatsapp_enabled
  if non_manager is null then
    res := res || '{"toggle_non_manager":"SKIPPED (no non-manager profile in demo business)"}';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', non_manager, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      update businesses set whatsapp_enabled = false where id = biz;
      -- 0 rows (RLS) also counts as blocked; only a real change is bad
      res := res || jsonb_build_object('toggle_non_manager',
        case when found then 'ALLOWED (BAD)' else 'rejected (rls, 0 rows)' end);
    exception when others then res := res || jsonb_build_object('toggle_non_manager', 'rejected'); end;
    execute 'reset role';
  end if;

  -- revoke_channel_identity as owner
  if staff is null then
    res := res || '{"revoke_rpc":"SKIPPED (no staff profile in demo business)","revoke_on_removal":"SKIPPED"}';
  else
    insert into channel_identities (business_id, profile_id, channel, external_id)
      values (biz, staff, 'whatsapp', 'verify-000000001') returning id into ident;
    -- act as the owner again (the toggle test above switched the claims to the non-manager)
    perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform revoke_channel_identity(ident);
    execute 'reset role';
    res := res || jsonb_build_object('revoke_rpc',
      case when (select revoked_at from channel_identities where id = ident) is not null then 'revoked' else 'NOT REVOKED (BAD)' end);
    -- fresh identity + soft-removal of the staff profile → trigger revokes
    insert into channel_identities (business_id, profile_id, channel, external_id)
      values (biz, staff, 'whatsapp', 'verify-000000002') returning id into ident;
    update profiles set removed_at = now() where id = staff;
    res := res || jsonb_build_object('revoke_on_removal',
      case when (select revoked_at from channel_identities where id = ident) is not null then 'revoked' else 'NOT REVOKED (BAD)' end);
  end if;

  -- duplicate reminder key is rejected
  insert into channel_reminders_sent (profile_id, template_id, site_id, period_key)
    select owner, t.id, s.id, '2026-10-10' from checklist_templates t, sites s where t.business_id = biz and s.business_id = biz limit 1;
  begin
    insert into channel_reminders_sent (profile_id, template_id, site_id, period_key)
      select owner, t.id, s.id, '2026-10-10' from checklist_templates t, sites s where t.business_id = biz and s.business_id = biz limit 1;
    res := res || '{"dup_reminder":"ALLOWED (BAD)"}';
  exception when unique_violation then res := res || '{"dup_reminder":"rejected"}'; end;
  res := res || jsonb_build_object('ready', whatsapp_ready(biz));
  raise exception 'VERIFY_RESULT %', res;
end
$v$;
