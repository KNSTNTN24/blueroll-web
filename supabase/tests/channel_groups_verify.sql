-- supabase/tests/channel_groups_verify.sql
-- Run via the Management API as ONE DO block after the migration; it always raises so everything rolls back.
-- Demo business «Fern & Fig» (owner 981197ca-…), never a client.
do $v$
declare
  biz uuid := '2693f7de-c0ba-4d52-bbe9-602106eac784';
  owner uuid := '981197ca-3648-4c6c-9f18-ff7b6ae68786';
  non_manager uuid;
  v_tpl uuid;
  v_site uuid;
  v_grp uuid;
  v_code text;
  res jsonb := '{}';
begin
  select id into non_manager from profiles
   where business_id = biz and role not in ('owner','manager') and removed_at is null limit 1;
  select id into v_tpl from checklist_templates where business_id = biz limit 1;
  select id into v_site from sites where business_id = biz and removed_at is null limit 1;

  -- 1. the owner issues a 6-digit group link code
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_code := issue_group_link_code();
  res := res || jsonb_build_object('code_ok', v_code ~ '^[0-9]{6}$',
    'code_visible_to_owner', (select count(*) from channel_group_link_codes c where c.code = v_code and c.channel = 'telegram'));
  begin
    perform issue_group_link_code('whatsapp');
    res := res || '{"whatsapp_code":"ALLOWED (BAD)"}';
  exception when invalid_parameter_value then res := res || '{"whatsapp_code":"rejected"}'; end;
  execute 'reset role';

  -- 2. a non-manager cannot issue one
  if non_manager is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', non_manager, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform issue_group_link_code();
      res := res || '{"non_manager_code":"ALLOWED (BAD)"}';
    exception when insufficient_privilege then res := res || '{"non_manager_code":"rejected"}'; end;
    execute 'reset role';
  end if;

  -- 3. the bot (service role) links a group; the owner maps a checklist, flips alerts, can't move it, unlinks it
  insert into channel_groups (business_id, channel, chat_id, title, linked_by)
  values (biz, 'telegram', '-100999000111', 'Verify group', owner) returning id into v_grp;
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into channel_group_checklists (group_id, template_id) values (v_grp, v_tpl);
  update channel_groups set alerts = true where id = v_grp;
  res := res || jsonb_build_object(
    'owner_mapping', (select count(*) from channel_group_checklists where group_id = v_grp),
    'owner_alerts', (select alerts from channel_groups where id = v_grp));
  begin
    update channel_groups set chat_id = '-1' where id = v_grp;
    res := res || '{"owner_chat_id":"ALLOWED (BAD)"}';
  exception when insufficient_privilege then res := res || '{"owner_chat_id":"rejected"}'; end;
  begin
    update channel_groups set channel = 'whatsapp' where id = v_grp;
    res := res || '{"owner_channel":"ALLOWED (BAD)"}';
  exception when insufficient_privilege then res := res || '{"owner_channel":"rejected"}'; end;
  update channel_groups set unlinked_at = now() where id = v_grp;
  res := res || jsonb_build_object('owner_unlink', (select unlinked_at is not null from channel_groups where id = v_grp));
  execute 'reset role';

  -- 4. form tokens: a group token is valid; both owners, or a group kind without a group, are rejected
  insert into channel_form_tokens (token, kind, business_id, group_id, site_id, template_id, item_ids)
  values ('verify-g', 'group_checklist', biz, v_grp, v_site, v_tpl, '{}');
  res := res || '{"group_token":"ok"}';
  begin
    insert into channel_form_tokens (token, kind, business_id, profile_id, group_id, site_id, template_id)
    values ('verify-bad', 'group_checklist', biz, owner, v_grp, v_site, v_tpl);
    res := res || '{"both_owners":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"both_owners":"rejected"}'; end;
  begin
    insert into channel_form_tokens (token, kind, business_id, profile_id, site_id, template_id)
    values ('verify-bad2', 'group_checklist', biz, owner, v_site, v_tpl);
    res := res || '{"group_kind_without_group":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"group_kind_without_group":"rejected"}'; end;

  -- 5. one live list per (group, site)
  insert into channel_live_lists (group_id, site_id, list_date, message_id) values (v_grp, v_site, current_date, '1');
  begin
    insert into channel_live_lists (group_id, site_id, list_date, message_id) values (v_grp, v_site, current_date, '2');
    res := res || '{"live_list_dupe":"ALLOWED (BAD)"}';
  exception when unique_violation then res := res || '{"live_list_dupe":"rejected"}'; end;

  -- 6. identities: no active personal Telegram identity left; uniqueness is per business
  res := res || jsonb_build_object(
    'active_personal_telegram', (select count(*) from channel_identities
                                   where channel = 'telegram' and revoked_at is null and consent_source <> 'group_form'),
    'identity_index_has_business', (select indexdef like '%business_id, channel, external_id%' from pg_indexes
                                      where indexname = 'uq_channel_identity_active'));
  insert into channel_identities (business_id, profile_id, channel, external_id, consent_source)
  values (biz, owner, 'telegram', '999000111', 'group_form');
  if non_manager is not null then
    begin
      insert into channel_identities (business_id, profile_id, channel, external_id, consent_source)
      values (biz, non_manager, 'telegram', '999000111', 'group_form');
      res := res || '{"identity_dupe_same_business":"ALLOWED (BAD)"}';
    exception when unique_violation then res := res || '{"identity_dupe_same_business":"rejected"}'; end;
  end if;

  raise exception 'VERIFY_RESULT %', res;
end
$v$;
