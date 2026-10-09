-- supabase/tests/telegram_channel_verify.sql
-- Run via the Management API as ONE DO block; it always raises at the end so everything rolls back.
-- Uses the demo business «Fern & Fig» (owner 981197ca-…), never a client.
do $v$
declare
  biz uuid := '2693f7de-c0ba-4d52-bbe9-602106eac784';
  owner uuid := '981197ca-3648-4c6c-9f18-ff7b6ae68786';
  non_manager uuid;
  res jsonb := '{}';
begin
  select id into non_manager from profiles
   where business_id = biz and role not in ('owner','manager') and removed_at is null limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update businesses set telegram_enabled = true where id = biz;
  res := res || jsonb_build_object('toggle', (select telegram_enabled from businesses where id = biz));
  execute 'reset role';

  -- a non-manager cannot flip telegram_enabled
  if non_manager is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', non_manager, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      update businesses set telegram_enabled = false where id = biz;
      res := res || jsonb_build_object('non_manager_toggle',
        case when (select telegram_enabled from businesses where id = biz) then 'blocked (rls, no-op)' else 'ALLOWED (BAD)' end);
    exception when insufficient_privilege then res := res || '{"non_manager_toggle":"rejected"}'; end;
    execute 'reset role';
  end if;

  res := res || jsonb_build_object(
    'telegram_ready', channel_ready(biz, 'telegram'),
    'whatsapp_matches', channel_ready(biz, 'whatsapp') = whatsapp_ready(biz),
    'sms_ready', channel_ready(biz, 'sms'));
  raise exception 'VERIFY_RESULT %', res;
end
$v$;
