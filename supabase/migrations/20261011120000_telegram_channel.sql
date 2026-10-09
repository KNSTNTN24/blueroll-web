-- supabase/migrations/20261011120000_telegram_channel.sql
set search_path = public;

alter table public.businesses add column if not exists telegram_enabled boolean not null default false;

-- Same owner/manager guard as whatsapp_enabled (see 20261010120000).
-- Security INVOKER on purpose: current_user is the caller's role, so service_role/postgres writes skip the check.
create or replace function public.guard_telegram_enabled()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated','anon')
     and new.telegram_enabled is distinct from old.telegram_enabled
     and not public.is_active_business_manager(new.id) then
    raise exception 'only owners and managers can change Telegram settings' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_telegram_enabled on public.businesses;
create trigger trg_guard_telegram_enabled before update of telegram_enabled on public.businesses
  for each row execute function public.guard_telegram_enabled();

create or replace function public.channel_ready(b uuid, ch text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_business_entitled(b) and coalesce((
    select case ch when 'whatsapp' then whatsapp_enabled when 'telegram' then telegram_enabled else false end
    from public.businesses where id = b), false)
$$;
revoke execute on function public.channel_ready(uuid, text) from public, anon;
grant execute on function public.channel_ready(uuid, text) to authenticated, service_role;
