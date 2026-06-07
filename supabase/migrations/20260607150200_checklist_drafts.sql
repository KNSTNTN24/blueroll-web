-- Checklist drafts: save partway, finish later (spec 2026-06-07 v-next, item 2).
-- A SEPARATE table on purpose: old clients compute checklist status from
-- checklist_completions; a draft row there would read as "done" to them.
CREATE TABLE IF NOT EXISTS public.checklist_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  responses   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, created_by)
);

ALTER TABLE public.checklist_drafts ENABLE ROW LEVEL SECURITY;

-- Drafts are strictly personal: only the author sees/edits their draft,
-- and only within their own business.
DROP POLICY IF EXISTS "Own drafts" ON public.checklist_drafts;
CREATE POLICY "Own drafts" ON public.checklist_drafts
  FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid() AND business_id = public.get_my_business_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_drafts TO authenticated;
