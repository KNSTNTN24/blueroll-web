-- ⚠️ EMERGENCY ROLLBACK — NOT A MIGRATION. Do NOT place in supabase/migrations/.
-- Reverts can_see_site_row to the single profiles.site_id version (undoes Phase 2
-- membership). The member_sites table + trg_keep_primary_site are left in place
-- (harmless once the function ignores them). Apply MANUALLY via the Management API only.
create or replace function public.can_see_site_row(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.am_i_group_admin()
      or p_site = (select site_id from public.profiles where id = auth.uid())
$$;
