-- ============================================================================
-- Incidents: severity + category (ADDITIVE, backwards-compatible)
--
--   severity  text  in (low, medium, high, critical)  default 'medium'
--   category  text  in (Injury, Equipment, Illness, Complaint, Other) default 'Other'
--
-- The prototype's Incident UX is severity-driven; neither column existed. Both
-- are additive with defaults, so existing rows and the current insert paths
-- (which omit severity/category) keep working unchanged. Existing complaints
-- are backfilled to the Complaint category.
--
-- Applied to prod 2026-07-23 via the Management API (idempotent, if-not-exists).
-- ============================================================================

alter table public.incidents
  add column if not exists severity text not null default 'medium';
alter table public.incidents
  add column if not exists category text not null default 'Other';

do $$ begin
  alter table public.incidents
    add constraint incidents_severity_chk
    check (severity in ('low','medium','high','critical'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.incidents
    add constraint incidents_category_chk
    check (category in ('Injury','Equipment','Illness','Complaint','Other'));
exception when duplicate_object then null; end $$;

-- backfill: complaints -> 'Complaint'; everything else keeps the 'Other' default
update public.incidents
  set category = 'Complaint'
  where type = 'complaint' and category = 'Other';
