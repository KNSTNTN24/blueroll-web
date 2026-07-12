-- Gate get_my_business_id() on the business not being soft-deleted.
-- ~50 RLS policies across child tables key off this single function, so
-- returning NULL here for a soft-deleted business denies read/write access
-- to all of that business's child-table data (recipes, checklists, etc.)
-- immediately, instead of leaving it accessible for the 30-day purge grace
-- period.
CREATE OR REPLACE FUNCTION public.get_my_business_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.business_id
  FROM profiles p
  JOIN businesses b ON b.id = p.business_id
  WHERE p.id = auth.uid()
    AND b.deleted_at IS NULL
$function$;
