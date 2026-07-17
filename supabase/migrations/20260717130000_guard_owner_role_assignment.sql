set search_path = public;

-- Anti-escalation: only an owner (or a group admin) may assign the Owner role to
-- anyone. The profiles UPDATE policy is gated on manage_team (which Managers hold),
-- so without this a Manager could set any member's role_id (or write role='owner',
-- which the sync trigger turns into the owner role_id) and escalate to full owner.
--
-- Fires AFTER trg_sync_profile_role (name sorts later) so it sees the final
-- role_id even when the caller wrote only the legacy text column.
create or replace function public.guard_owner_role_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_target_is_owner boolean;
  v_actor_is_owner boolean;
begin
  if new.role_id is null then return new; end if;
  -- Only guard transitions INTO an owner-tier role.
  select (base_tier = 'owner') into v_target_is_owner from public.roles where id = new.role_id;
  if not coalesce(v_target_is_owner, false) then return new; end if;
  -- No-op if the role isn't actually changing to owner (already owner).
  if tg_op = 'UPDATE' and old.role_id is not distinct from new.role_id then return new; end if;

  select
    coalesce((select is_group_admin from public.profiles where id = auth.uid()), false)
    or exists (
      select 1 from public.profiles p join public.roles r on r.id = p.role_id
      where p.id = auth.uid() and r.base_tier = 'owner'
    )
  into v_actor_is_owner;

  if not coalesce(v_actor_is_owner, false) then
    raise exception 'Only an owner can assign the Owner role';
  end if;
  return new;
end $$;

drop trigger if exists trg_zguard_owner_role on public.profiles;
create trigger trg_zguard_owner_role
  before update of role_id, role on public.profiles
  for each row execute function public.guard_owner_role_assignment();
