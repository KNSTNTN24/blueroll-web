set search_path = public;

-- Phase 4: fold per-member overrides into the effective capability check.
-- effective(cap) = owner
--   OR ( (cap ∈ role.capabilities OR grant-override) AND NOT revoke-override )
-- Behavior-equivalent to Phase 1 while member_capability_overrides is empty.
create or replace function public.has_capability(cap text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id
            where p.id = auth.uid() and r.base_tier = 'owner')
    or (
      ( exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id
                where p.id = auth.uid() and cap = any(r.capabilities))
        or exists (select 1 from public.member_capability_overrides o
                   where o.profile_id = auth.uid() and o.capability = cap and o.granted) )
      and not exists (select 1 from public.member_capability_overrides o
                      where o.profile_id = auth.uid() and o.capability = cap and not o.granted)
    )
$$;
grant execute on function public.has_capability(text) to authenticated;
