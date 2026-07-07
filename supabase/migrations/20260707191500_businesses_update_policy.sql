-- businesses had only INSERT + SELECT policies, so every UPDATE was silently
-- denied by RLS (equipment save, notification prefs, etc. all no-ops). Allow a
-- member of the business to update its own row.
drop policy if exists "Users can update own business" on public.businesses;
create policy "Users can update own business" on public.businesses
  for update using (id = public.get_my_business_id())
  with check (id = public.get_my_business_id());
