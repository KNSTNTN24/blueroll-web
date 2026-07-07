-- Owners/managers can manage other members in their business (role + site access
-- from Settings → Members & roles). get_my_role() is SECURITY DEFINER, so it does
-- not recurse through profiles RLS.
drop policy if exists "Admins can manage member profiles" on public.profiles;
create policy "Admins can manage member profiles" on public.profiles
  for update using (
    business_id = public.get_my_business_id()
    and public.get_my_role() in ('owner', 'manager')
  ) with check (
    business_id = public.get_my_business_id()
  );
