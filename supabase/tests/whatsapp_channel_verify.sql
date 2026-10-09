-- supabase/tests/whatsapp_channel_verify.sql
-- Run via the Management API as ONE DO block; it always raises at the end so everything rolls back.
-- Uses the demo business «Fern & Fig» (owner 981197ca-…), never a client.
do $v$
declare
  biz uuid := '2693f7de-c0ba-4d52-bbe9-602106eac784';
  owner uuid := '981197ca-3648-4c6c-9f18-ff7b6ae68786';
  other_biz_profile uuid; res jsonb := '{}'; n int;
begin
  select id into other_biz_profile from profiles where business_id <> biz limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- owner can flip the switch
  update businesses set whatsapp_enabled = true where id = biz;
  res := res || jsonb_build_object('toggle', (select whatsapp_enabled from businesses where id = biz));
  -- owner issues a code for own staff
  insert into channel_link_codes (code, business_id, profile_id) values ('123456', biz, owner);
  res := res || '{"code_own":"ok"}';
  -- cannot issue for another business's profile
  begin
    insert into channel_link_codes (code, business_id, profile_id) values ('654321', biz, other_biz_profile);
    res := res || '{"code_foreign":"ALLOWED (BAD)"}';
  exception when others then res := res || jsonb_build_object('code_foreign', 'rejected'); end;
  -- service-role-only tables are invisible to the owner
  select count(*) into n from channel_form_tokens; res := res || jsonb_build_object('tokens_visible', n);
  execute 'reset role';
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
