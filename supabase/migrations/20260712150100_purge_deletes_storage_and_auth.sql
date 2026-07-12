-- Extend purge_deleted_businesses() to also remove storage objects
-- (bucket "documents", namespaced by "<business_id>/...") and the
-- auth.users rows for profiles that belonged to a purged business.
-- All previously-existing deletes are kept unchanged; only additions below.

-- Small helper: cast text to uuid only when it actually looks like one,
-- so filtering storage.objects.name (arbitrary user-controlled text) by
-- its uuid-shaped first path segment can never raise "invalid input
-- syntax for type uuid" on unrelated/legacy object names.
create or replace function public.try_uuid(v text)
returns uuid
language sql
immutable
set search_path to ''
as $function$
  select case
    when v ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then v::uuid
    else null
  end
$function$;

create or replace function public.purge_deleted_businesses()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_profile_ids uuid[];
begin
  select array_agg(id) into v_ids
  from public.businesses
  where deleted_at is not null and deleted_at < now() - interval '30 days';

  if v_ids is null then return; end if;

  select array_agg(id) into v_profile_ids
  from public.profiles
  where business_id = any(v_ids);

  -- Storage: files are namespaced "<business_id>/...". Guard the cast with
  -- try_uuid() so unrelated/malformed object names are simply skipped
  -- rather than aborting the whole purge.
  -- storage.objects has a protective BEFORE DELETE trigger that blocks
  -- direct DELETEs unless this session-local flag is set; this function is
  -- the intentional, audited admin path for bulk-purging a deleted
  -- business's files, so we opt in for the duration of this transaction.
  set local storage.allow_delete_query = 'true';
  delete from storage.objects
  where bucket_id = 'documents'
    and public.try_uuid(split_part(name, '/', 1)) = any(v_ids);

  -- Pass 1: tables with no other table referencing them (true leaves)
  delete from public.checklist_drafts where business_id = any(v_ids);
  delete from public.checklist_instances where business_id = any(v_ids);
  delete from public.checklist_responses cr
    using public.checklist_completions cc
    where cr.completion_id = cc.id and cc.business_id = any(v_ids);
  delete from public.delivery_photos dp
    using public.deliveries d
    where dp.delivery_id = d.id and d.business_id = any(v_ids);
  delete from public.diary_entries where business_id = any(v_ids);
  delete from public.document_access da
    where da.document_id in (select id from public.documents where business_id = any(v_ids))
       or (v_profile_ids is not null and da.profile_id = any(v_profile_ids));
  delete from public.four_weekly_reviews where business_id = any(v_ids);
  delete from public.haccp_pack_data where business_id = any(v_ids);
  delete from public.haccp_signoffs where business_id = any(v_ids);
  delete from public.incidents where business_id = any(v_ids);
  delete from public.invites where business_id = any(v_ids);
  delete from public.menu_items where business_id = any(v_ids);
  delete from public.notification_rules where business_id = any(v_ids);
  delete from public.notifications
    where v_profile_ids is not null and user_id = any(v_profile_ids);
  delete from public.recipe_ingredients ri
    using public.recipes r
    where ri.recipe_id = r.id and r.business_id = any(v_ids);
  delete from public.recipe_tags rt
    using public.recipes r
    where rt.recipe_id = r.id and r.business_id = any(v_ids);
  delete from public.staff_checkins where business_id = any(v_ids);
  delete from public.training_records where business_id = any(v_ids);

  -- Pass 2: tables that become leaves once pass 1 is done
  delete from public.checklist_completions where business_id = any(v_ids);
  delete from public.checklist_template_items ti
    using public.checklist_templates t
    where ti.template_id = t.id and t.business_id = any(v_ids);
  delete from public.deliveries where business_id = any(v_ids);
  delete from public.documents where business_id = any(v_ids);
  delete from public.ingredients where business_id = any(v_ids);
  delete from public.recipes where business_id = any(v_ids);
  delete from public.tags where business_id = any(v_ids);

  -- Pass 3: tables that become leaves once pass 2 is done
  delete from public.checklist_templates where business_id = any(v_ids);
  delete from public.suppliers where business_id = any(v_ids);

  -- Pass 4: profiles <-> sites have a circular FK (sites.manager_id, profiles.site_id).
  -- Null out the linking columns first so either side can be deleted safely.
  update public.profiles set site_id = null where business_id = any(v_ids);
  update public.sites set manager_id = null where business_id = any(v_ids);
  delete from public.profiles where business_id = any(v_ids);
  delete from public.sites where business_id = any(v_ids);

  -- Auth users for the profiles that were just deleted.
  if v_profile_ids is not null then
    delete from auth.users where id = any(v_profile_ids);
  end if;

  -- Pass 5: parent
  delete from public.businesses where id = any(v_ids);
end $$;
