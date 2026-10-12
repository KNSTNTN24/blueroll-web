-- supabase/tests/whatsapp_teams_verify.sql
-- Run via the Management API as ONE DO block after the migration; it always raises so everything rolls back.
-- Demo business «Fern & Fig» (owner 981197ca-…), never a client.
do $v$
declare
  biz uuid := '2693f7de-c0ba-4d52-bbe9-602106eac784';
  owner uuid := '981197ca-3648-4c6c-9f18-ff7b6ae68786';
  non_manager uuid;
  v_site uuid;
  v_other_site uuid;
  v_tpl uuid;
  v_tpl_other uuid;
  v_team uuid;
  v_member uuid;
  res jsonb := '{}';
begin
  select id into non_manager from profiles
   where business_id = biz and role not in ('owner','manager') and removed_at is null limit 1;
  select id into v_site from sites where business_id = biz and removed_at is null order by created_at limit 1;
  select id into v_other_site from sites where business_id = biz and removed_at is null and id <> v_site limit 1;
  select id into v_tpl from checklist_templates where business_id = biz and (site_id is null or site_id = v_site) limit 1;
  select id into v_tpl_other from checklist_templates
   where business_id = biz and site_id is not null and site_id <> v_site limit 1;

  -- 1. the owner creates a WhatsApp team (creator stamped), maps a checklist of its site, can't move it or add Telegram
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into channel_groups (business_id, channel, title, site_id, linked_by)
  values (biz, 'whatsapp', 'Verify team', v_site, null) returning id into v_team;
  res := res || jsonb_build_object('owner_team',
    (select linked_by = owner and chat_id is null and site_id = v_site from channel_groups where id = v_team));
  insert into channel_group_checklists (group_id, template_id) values (v_team, v_tpl);
  res := res || jsonb_build_object('owner_mapping', (select count(*) from channel_group_checklists where group_id = v_team));
  if v_tpl_other is not null then
    begin
      insert into channel_group_checklists (group_id, template_id) values (v_team, v_tpl_other);
      res := res || '{"other_site_mapping":"ALLOWED (BAD)"}';
    exception when insufficient_privilege then res := res || '{"other_site_mapping":"rejected"}'; end;
  else
    res := res || '{"other_site_mapping":"skipped"}';
  end if;
  if v_other_site is not null then
    begin
      update channel_groups set site_id = v_other_site where id = v_team;
      res := res || '{"owner_site_change":"ALLOWED (BAD)"}';
    exception when insufficient_privilege then res := res || '{"owner_site_change":"rejected"}'; end;
  else
    res := res || '{"owner_site_change":"skipped"}';
  end if;
  begin
    insert into channel_groups (business_id, channel, chat_id, title) values (biz, 'telegram', '-100999000222', 'x');
    res := res || '{"owner_telegram_insert":"ALLOWED (BAD)"}';
  exception when insufficient_privilege then res := res || '{"owner_telegram_insert":"rejected"}'; end;
  execute 'reset role';

  -- 2. table checks (service role)
  begin
    insert into channel_groups (business_id, channel, title) values (biz, 'whatsapp', 'No site');
    res := res || '{"team_without_site":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"team_without_site":"rejected"}'; end;
  begin
    insert into channel_groups (business_id, channel, title) values (biz, 'telegram', 'No chat');
    res := res || '{"telegram_without_chat":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"telegram_without_chat":"rejected"}'; end;

  -- 3. members: service role invites; the owner sees and removes; nothing else changes from a client
  insert into channel_group_members (group_id, profile_id, phone, invited_by)
  values (v_team, owner, '447700900001', owner) returning id into v_member;
  begin
    insert into channel_group_members (group_id, profile_id, phone) values (v_team, owner, '447700900001');
    res := res || '{"member_dupe":"ALLOWED (BAD)"}';
  exception when unique_violation then res := res || '{"member_dupe":"rejected"}'; end;
  begin
    insert into channel_group_members (group_id, profile_id, phone) values (v_team, owner, '+44 7700');
    res := res || '{"bad_phone":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"bad_phone":"rejected"}'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := res || jsonb_build_object('owner_sees_members', (select count(*) from channel_group_members where group_id = v_team));
  begin
    update channel_group_members set phone = '447700900002' where id = v_member;
    res := res || '{"owner_phone_change":"ALLOWED (BAD)"}';
  exception when insufficient_privilege then res := res || '{"owner_phone_change":"rejected"}'; end;
  update channel_group_members set status = 'removed' where id = v_member;
  res := res || jsonb_build_object('owner_remove',
    (select status = 'removed' and removed_at is not null from channel_group_members where id = v_member));
  begin
    update channel_group_members set status = 'active' where id = v_member;
    res := res || '{"owner_reactivate":"ALLOWED (BAD)"}';
  exception when insufficient_privilege then res := res || '{"owner_reactivate":"rejected"}'; end;
  res := res || jsonb_build_object('owner_sees_events', (select count(*) from channel_group_events));
  execute 'reset role';

  -- 4. a non-manager sees no members and can't create a team
  if non_manager is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', non_manager, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    res := res || jsonb_build_object('non_manager_sees_members', (select count(*) from channel_group_members where group_id = v_team));
    begin
      insert into channel_groups (business_id, channel, title, site_id) values (biz, 'whatsapp', 'Nope', v_site);
      res := res || '{"non_manager_team":"ALLOWED (BAD)"}';
    exception when insufficient_privilege then res := res || '{"non_manager_team":"rejected"}'; end;
    execute 'reset role';
  end if;

  -- 5. events and takes: one row per key
  insert into channel_group_events (group_id, kind, key) values (v_team, 'day_end', '2026-10-14');
  begin
    insert into channel_group_events (group_id, kind, key) values (v_team, 'day_end', '2026-10-14');
    res := res || '{"event_dupe":"ALLOWED (BAD)"}';
  exception when unique_violation then res := res || '{"event_dupe":"rejected"}'; end;
  insert into channel_group_takes (group_id, template_id, site_id, period_key, profile_id) values (v_team, v_tpl, v_site, '2026-10-14', owner);
  begin
    insert into channel_group_takes (group_id, template_id, site_id, period_key, profile_id) values (v_team, v_tpl, v_site, '2026-10-14', owner);
    res := res || '{"take_dupe":"ALLOWED (BAD)"}';
  exception when unique_violation then res := res || '{"take_dupe":"rejected"}'; end;

  -- 6. form tokens
  insert into channel_form_tokens (token, kind, business_id, profile_id, group_id, site_id, template_id, item_ids)
  values ('verify-team', 'checklist', biz, owner, v_team, v_site, v_tpl, '{}');
  res := res || '{"team_token":"ok"}';
  begin
    insert into channel_form_tokens (token, kind, business_id, profile_id, group_id, site_id, template_id)
    values ('verify-bad1', 'corrective', biz, owner, v_team, v_site, v_tpl);
    res := res || '{"corrective_with_group":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"corrective_with_group":"rejected"}'; end;
  begin
    insert into channel_form_tokens (token, kind, business_id, profile_id, group_id, site_id, template_id)
    values ('verify-bad2', 'group_checklist', biz, owner, v_team, v_site, v_tpl);
    res := res || '{"group_token_with_profile":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"group_token_with_profile":"rejected"}'; end;
  begin
    insert into channel_form_tokens (token, kind, business_id, group_id, site_id, template_id)
    values ('verify-bad3', 'checklist', biz, v_team, v_site, v_tpl);
    res := res || '{"checklist_without_profile":"ALLOWED (BAD)"}';
  exception when check_violation then res := res || '{"checklist_without_profile":"rejected"}'; end;

  raise exception 'VERIFY_RESULT %', res;
end
$v$;
