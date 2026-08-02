set search_path = public;

-- ============================================================================
-- RBAC anti-escalation guard (defense-in-depth for the direct-API path).
--
-- The member editor UI is owner-only, but the underlying RLS let anyone with
-- `manage_team` (owner + manager) write member_sites and flip is_group_admin —
-- so a manager could craft a direct API call to grant themselves extra sites or
-- full-estate access. This closes both vectors. The existing owner-ROLE guard
-- (guard_owner_role_assignment) already covers escalation into the Owner role.
--
-- Onboarding safety: the multi-site owner sets is_group_admin=true on themselves
-- AFTER setup_business has already given them the owner role, so the actor is an
-- owner at that point and the guard allows it. join_with_invite is SECURITY
-- DEFINER (runs as the table owner, bypassing RLS), so member-site rows written
-- on join are unaffected by the tightened policy.
-- ============================================================================

-- ── 1. member_sites writes: owner / group-admin only (was manage_team) ──────
drop policy if exists member_sites_write on public.member_sites;
create policy member_sites_write on public.member_sites for all
  using (
    exists (select 1 from public.sites s
            where s.id = member_sites.site_id and s.business_id = get_my_business_id())
    and (
      coalesce((select is_group_admin from public.profiles where id = auth.uid()), false)
      or exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id
                 where p.id = auth.uid() and r.base_tier = 'owner')
    )
  )
  with check (
    exists (select 1 from public.sites s
            where s.id = member_sites.site_id and s.business_id = get_my_business_id())
    and (
      coalesce((select is_group_admin from public.profiles where id = auth.uid()), false)
      or exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id
                 where p.id = auth.uid() and r.base_tier = 'owner')
    )
  );

-- ── 2. is_group_admin escalation guard (mirrors the owner-role guard) ────────
create or replace function public.guard_group_admin_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor_is_owner boolean;
begin
  -- Only guard transitions INTO full-estate access.
  if not coalesce(new.is_group_admin, false) then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.is_group_admin, false) = coalesce(new.is_group_admin, false) then
    return new;
  end if;

  select
    coalesce((select is_group_admin from public.profiles where id = auth.uid()), false)
    or exists (
      select 1 from public.profiles p join public.roles r on r.id = p.role_id
      where p.id = auth.uid() and r.base_tier = 'owner'
    )
  into v_actor_is_owner;

  if not coalesce(v_actor_is_owner, false) then
    raise exception 'Only an owner can grant full estate access';
  end if;
  return new;
end $$;

drop trigger if exists trg_zguard_group_admin on public.profiles;
create trigger trg_zguard_group_admin before insert or update on public.profiles
  for each row execute function public.guard_group_admin_escalation();
