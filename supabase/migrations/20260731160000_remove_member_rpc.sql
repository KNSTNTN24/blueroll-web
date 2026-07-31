-- Team member removal (mobile + web "Remove from team").
-- Clean members are hard-deleted; members with audit history (completions,
-- incidents, recipes…) keep their records and are soft-removed instead:
-- removed_at stamps them, site/role assignment is cleared, and both apps
-- treat a removed profile as signed-out / hidden from the team list.
alter table public.profiles add column if not exists removed_at timestamptz;

create or replace function public.remove_member(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller profiles%rowtype;
  v_target profiles%rowtype;
begin
  select * into v_caller from profiles where id = auth.uid();
  if v_caller.id is null or v_caller.role not in ('owner','manager') then
    raise exception 'Only owners and managers can remove members';
  end if;

  select * into v_target from profiles where id = p_profile;
  if v_target.id is null or v_target.business_id <> v_caller.business_id then
    raise exception 'Member not found';
  end if;
  if v_target.role = 'owner' then
    raise exception 'The owner cannot be removed';
  end if;
  if v_target.id = v_caller.id then
    raise exception 'You cannot remove yourself';
  end if;

  -- Their pending invites go regardless of which path we take.
  delete from invites where email = v_target.email and business_id = v_target.business_id;

  begin
    delete from profiles where id = p_profile;
  exception when foreign_key_violation then
    update profiles
       set removed_at = now(),
           site_id = null,
           role_id = null,
           is_group_admin = false
     where id = p_profile;
  end;
end;
$$;

revoke all on function public.remove_member(uuid) from public;
grant execute on function public.remove_member(uuid) to authenticated;
