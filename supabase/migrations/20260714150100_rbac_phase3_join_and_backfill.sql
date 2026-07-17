set search_path = public;

-- join_with_invite: also assign role_id + site_id + a member_sites row from the invite,
-- so a joined member actually has access. Fallback: if invite.role_id is null (old invites),
-- map invite.role (string) to the business's preset by base_tier.
create or replace function public.join_with_invite(invite_token text, member_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_invite record;
  v_user_id uuid := auth.uid();
  v_is_test boolean := (invite_token = '123456');
  v_role_id uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if exists (select 1 from profiles where id = v_user_id) then raise exception 'User already has a profile'; end if;

  select * into v_invite from invites where token = invite_token and (v_is_test or used_at is null);
  if not found then raise exception 'Invalid or expired invite token'; end if;

  v_role_id := v_invite.role_id;
  if v_role_id is null then
    select id into v_role_id from roles where business_id = v_invite.business_id and base_tier = coalesce(v_invite.role, 'kitchen_staff') limit 1;
  end if;

  insert into profiles (id, email, full_name, role, role_id, business_id, site_id)
  values (v_user_id, (select email from auth.users where id = v_user_id),
          member_name, coalesce(v_invite.role, 'kitchen_staff'), v_role_id, v_invite.business_id, v_invite.site_id);
  -- (the sync trigger overwrites profiles.role from role_id's base_tier when role_id is set)

  if v_invite.site_id is not null then
    insert into member_sites (profile_id, site_id) values (v_user_id, v_invite.site_id) on conflict do nothing;
  end if;

  if not v_is_test then update invites set used_at = now() where id = v_invite.id; end if;
  return jsonb_build_object('success', true, 'business_id', v_invite.business_id);
end $$;

-- Backfill stranded non-admins (site_id NULL): assign each to their business's oldest site.
update public.profiles p
set site_id = os.site_id
from (select distinct on (business_id) business_id, id as site_id from public.sites order by business_id, created_at) os
where p.site_id is null and p.is_group_admin = false and os.business_id = p.business_id;

insert into public.member_sites (profile_id, site_id)
select p.id, p.site_id from public.profiles p
where p.is_group_admin = false and p.site_id is not null
  and not exists (select 1 from member_sites ms where ms.profile_id = p.id and ms.site_id = p.site_id)
on conflict do nothing;
