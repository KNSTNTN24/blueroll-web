-- Site create/edit/remove is OWNER-only (was owner+manager). Adding a site
-- increases the Stripe subscription quantity (per-site billing), so it must be
-- an owner action. SELECT stays open to all business members (they need to see
-- their sites). Restrictive entitlement_write_gate_* policies are untouched.
begin;
drop policy if exists sites_write on public.sites;
create policy sites_write on public.sites
  for all to authenticated
  using (business_id = public.get_my_business_id() and public.get_my_role() = 'owner')
  with check (business_id = public.get_my_business_id() and public.get_my_role() = 'owner');
commit;
