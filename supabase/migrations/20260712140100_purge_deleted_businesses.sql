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

  -- Pass 5: parent
  delete from public.businesses where id = any(v_ids);
end $$;

-- Daily at 03:00 UTC
select cron.unschedule('purge-deleted-businesses')
  where exists (select 1 from cron.job where jobname = 'purge-deleted-businesses');

select cron.schedule('purge-deleted-businesses', '0 3 * * *',
  $$ select public.purge_deleted_businesses(); $$);
