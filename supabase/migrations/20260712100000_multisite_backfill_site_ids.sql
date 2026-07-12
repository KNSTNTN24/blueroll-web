-- Pre-flight for hard per-site RLS: eliminate NULL site_id so that a
-- `site_id = get_my_site_id()` predicate never hides a row/user, and stop new
-- NULLs. Deterministic backfill target = the business's OLDEST site.
set search_path = public;

-- Helper (inline CTE): the oldest site per business.
-- 1. profiles.site_id
update profiles p
set site_id = os.site_id
from (
  select distinct on (business_id) business_id, id as site_id
  from sites order by business_id, created_at asc
) os
where p.site_id is null and os.business_id = p.business_id;

-- 1b. checklist_instances dedup (MUST run before the generic backfill).
-- Every NULL-site instance is a pre-74d5817 legacy row that has a sited twin
-- (same template_id + due_date + business). A plain backfill would collide with
-- the unique index uq_checklist_instance (template_id, coalesce(site_id,...), due_date).
-- 55 of the NULL rows are 'completed' while their twin is pending/missed, so we
-- MERGE (promote the completion onto the surviving sited twin) before deleting
-- the NULL rows — no completion record is lost. (Approved 2026-07-12.)
update checklist_instances t
set status = 'completed',
    completion_id = coalesce(t.completion_id, n.completion_id)
from checklist_instances n
where n.site_id is null
  and n.status = 'completed'
  and t.site_id is not null
  and t.business_id = n.business_id
  and t.template_id = n.template_id
  and t.due_date = n.due_date
  and t.status <> 'completed';

delete from checklist_instances where site_id is null;

-- 2. operational rows -> business's oldest site (checklist_instances now has 0
--    NULLs, so its entry in the loop below is a harmless no-op)
do $$
declare t text;
begin
  foreach t in array array[
    'checklist_templates','checklist_completions','checklist_instances',
    'incidents','deliveries','diary_entries','staff_checkins',
    'haccp_pack_data','haccp_signoffs'
  ] loop
    execute format($f$
      update public.%1$I x
      set site_id = os.site_id
      from (
        select distinct on (business_id) business_id, id as site_id
        from public.sites order by business_id, created_at asc
      ) os
      where x.site_id is null and os.business_id = x.business_id
    $f$, t);
  end loop;
end $$;

-- 3. Guard: never accept a NULL site_id on an isolated table again.
-- Only fills when the caller has a home site; machine inserts that already carry
-- site_id are untouched (trigger no-ops when new.site_id is not null).
create or replace function public.set_site_id_default()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.site_id is null then
    new.site_id := public.get_my_site_id();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'checklist_templates','checklist_completions','checklist_instances',
    'incidents','deliveries','diary_entries','staff_checkins',
    'haccp_pack_data','haccp_signoffs'
  ] loop
    execute format('drop trigger if exists trg_site_id_default on public.%1$I', t);
    execute format('create trigger trg_site_id_default before insert on public.%1$I for each row execute function public.set_site_id_default()', t);
  end loop;
end $$;
