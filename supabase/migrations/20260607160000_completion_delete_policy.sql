-- Undo a checklist completion without the service_role key (2026-06-07).
-- A member may delete their OWN completion; managers/owners may delete any in
-- their business. checklist_responses cascade via FK ON DELETE CASCADE, so no
-- separate responses policy is needed.
DROP POLICY IF EXISTS "Delete own or managed completions" ON public.checklist_completions;
CREATE POLICY "Delete own or managed completions" ON public.checklist_completions
  FOR DELETE
  USING (
    business_id = public.get_my_business_id()
    AND (completed_by = auth.uid() OR public.get_my_role() IN ('owner','manager'))
  );
