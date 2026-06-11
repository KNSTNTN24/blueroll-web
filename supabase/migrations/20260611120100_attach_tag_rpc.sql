-- attach_tag: normalise -> find-or-create -> link (spec Section 1).
-- SECURITY INVOKER on purpose: RLS on tags/recipe_tags is the authorisation
-- (per-business pinning + owner/manager/chef role gate). ON CONFLICT makes the
-- find-or-create race-safe; the no-op DO UPDATE makes RETURNING always yield
-- the row.
CREATE OR REPLACE FUNCTION public.attach_tag(p_recipe_id uuid, p_name text)
RETURNS public.tags
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_tag public.tags;
BEGIN
  IF v_name = '' OR char_length(v_name) > 40 THEN
    RAISE EXCEPTION 'Tag name must be 1-40 characters';
  END IF;

  INSERT INTO public.tags (business_id, name)
  VALUES (public.get_my_business_id(), v_name)
  ON CONFLICT (business_id, name_norm) DO UPDATE SET name = tags.name
  RETURNING * INTO v_tag;

  INSERT INTO public.recipe_tags (recipe_id, tag_id)
  VALUES (p_recipe_id, v_tag.id)
  ON CONFLICT DO NOTHING;

  RETURN v_tag;
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_tag(uuid, text) TO authenticated;

-- Orphan cleanup: with no tag-management screen (spec approach A), tags exist
-- only while >=1 recipe carries them. SECURITY DEFINER so cascades fired by
-- recipe deletion clean up regardless of the deleting user's tag policies;
-- trigger functions are not callable via PostgREST.
CREATE OR REPLACE FUNCTION public.cleanup_orphan_tag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.tags t
   WHERE t.id = OLD.tag_id
     AND NOT EXISTS (SELECT 1 FROM public.recipe_tags rt WHERE rt.tag_id = OLD.tag_id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_orphan_tag ON public.recipe_tags;
CREATE TRIGGER trg_cleanup_orphan_tag
  AFTER DELETE ON public.recipe_tags
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_orphan_tag();
