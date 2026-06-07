-- Multi-per-day checklists, counter model (spec 2026-06-07 v-next, item 5).
-- multi_per_day=true: template may be completed repeatedly within a day;
-- done when today's completions >= min_per_day (0 = optional/no obligation).
-- Old clients ignore both columns (accepted: they show done after the first
-- completion until the mobile release lands).
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS multi_per_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_per_day   integer NOT NULL DEFAULT 1;

ALTER TABLE public.checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_min_per_day_check;
ALTER TABLE public.checklist_templates
  ADD CONSTRAINT checklist_templates_min_per_day_check CHECK (min_per_day >= 0);
