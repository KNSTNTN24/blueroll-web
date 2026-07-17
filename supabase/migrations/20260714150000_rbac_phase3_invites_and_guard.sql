set search_path = public;

alter table public.invites add column if not exists role_id uuid references public.roles(id) on delete set null;

-- Protect roles: block deleting a role that (a) is a system preset, or (b) still has members.
create or replace function public.guard_role_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_system then
    raise exception 'Preset roles cannot be deleted';
  end if;
  if exists (select 1 from public.profiles where role_id = old.id) then
    raise exception 'Role still assigned to members — reassign them first';
  end if;
  return old;
end $$;
drop trigger if exists trg_guard_role_delete on public.roles;
create trigger trg_guard_role_delete before delete on public.roles
  for each row execute function public.guard_role_delete();
