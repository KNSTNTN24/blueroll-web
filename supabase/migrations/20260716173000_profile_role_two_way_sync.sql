-- profiles.role_id is the source of truth: has_capability() joins through it and
-- gates 26 RLS policies. profiles.role is a legacy text mirror of the role's
-- base_tier, still read by ~10 web call sites, get_my_role(), and the shipped
-- mobile app (profile.dart, notification_helper.dart) — so it cannot be dropped
-- until mobile migrates.
--
-- The old trigger only fired ON UPDATE OF role_id, so a legacy writer that set
-- the text column alone relabelled a member without changing a single
-- permission. That is how mahin84@gmail.com ended up reading 'owner' while
-- holding Manager capabilities.
--
-- Make the sync two-way: whichever column a writer touches, the other follows.

CREATE OR REPLACE FUNCTION public.sync_profile_role_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tier text;
begin
  -- Preferred path: role_id was set/changed → derive the text from its tier.
  if new.role_id is not null
     and (tg_op = 'INSERT' or new.role_id is distinct from old.role_id) then
    select base_tier into v_tier from public.roles where id = new.role_id;
    if v_tier is not null then
      new.role := v_tier;
    end if;
    return new;
  end if;

  -- Legacy path: only the text was written. Adopt the matching preset role for
  -- this business so permissions actually follow the label. Presets are unique
  -- per (business_id, base_tier); custom roles are never auto-adopted.
  if new.role is not null
     and (tg_op = 'INSERT' or new.role is distinct from old.role) then
    select id into new.role_id
      from public.roles
     where business_id = new.business_id
       and is_system
       and base_tier = new.role
     limit 1;
  end if;

  return new;
end
$function$;

DROP TRIGGER IF EXISTS trg_sync_profile_role ON public.profiles;

CREATE TRIGGER trg_sync_profile_role
  BEFORE INSERT OR UPDATE OF role_id, role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role_text();
