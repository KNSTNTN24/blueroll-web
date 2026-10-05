-- supabase/migrations/20261006120000_haccp_setup.sql
set search_path = public;

-- ============================================================================
-- «Set up my HACCP» questionnaire (spec 2026-10-05)
--   haccp_setup_sessions — progress + audit of what was applied
--   checklist_templates.library_key — which library template a row came from
--   ai_usage_log — haccp-assistant token usage (service role only)
--   apply_haccp_setup — one-transaction apply of a confirmed draft
-- ============================================================================

create or replace function public.is_business_manager(b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.business_id = b and p.role in ('owner', 'manager')
  )
$$;
grant execute on function public.is_business_manager(uuid) to authenticated;

create table if not exists public.haccp_setup_sessions (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  site_id               uuid not null references public.sites(id) on delete cascade,
  questionnaire_version int  not null,
  answers               jsonb not null default '{}'::jsonb,
  status                text not null default 'in_progress' check (status in ('in_progress', 'applied', 'abandoned')),
  applied_summary       jsonb,
  created_by            uuid default auth.uid() references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  applied_at            timestamptz
);
create index if not exists idx_haccp_setup_sessions_site on public.haccp_setup_sessions(business_id, site_id, created_at desc);
alter table public.haccp_setup_sessions enable row level security;
drop policy if exists "managers read setup sessions" on public.haccp_setup_sessions;
create policy "managers read setup sessions" on public.haccp_setup_sessions
  for select using (public.is_business_manager(business_id));
drop policy if exists "managers create setup sessions" on public.haccp_setup_sessions;
create policy "managers create setup sessions" on public.haccp_setup_sessions
  for insert with check (public.is_business_manager(business_id) and status = 'in_progress'
                        and exists (select 1 from public.sites st where st.id = site_id and st.business_id = haccp_setup_sessions.business_id));
drop policy if exists "managers update setup sessions" on public.haccp_setup_sessions;
create policy "managers update setup sessions" on public.haccp_setup_sessions
  for update using (public.is_business_manager(business_id) and status = 'in_progress')
  with check (public.is_business_manager(business_id)
              and exists (select 1 from public.sites st where st.id = site_id and st.business_id = haccp_setup_sessions.business_id)
              and (status in ('in_progress', 'abandoned') or (status = 'applied' and applied_at is not null)));

alter table public.checklist_templates add column if not exists library_key text;
create unique index if not exists uq_checklist_templates_library_key
  on public.checklist_templates(business_id, site_id, library_key) where library_key is not null;

create table if not exists public.ai_usage_log (
  id            bigserial primary key,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  fn            text not null,
  input_tokens  int  not null default 0,
  output_tokens int  not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_ai_usage_log_business on public.ai_usage_log(business_id, created_at desc);
alter table public.ai_usage_log enable row level security;  -- no policies: service role only

create or replace function public.apply_haccp_setup(p_session uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  s          public.haccp_setup_sessions%rowtype;
  t          jsonb;
  it         jsonb;
  v_add      jsonb;
  v_tid      uuid;
  v_tiers    text[];
  v_role_ids uuid[];
  v_pack_id  uuid;
  v_pack_upd timestamptz;
  v_next     int;
  v_created  int := 0;
  v_added    int := 0;
  n          int;
begin
  -- Plain read first: under RLS, SELECT … FOR UPDATE also applies the UPDATE policy's USING
  -- (status = 'in_progress'), which would hide an applied session and turn already_applied into
  -- session_not_found. Then lock; a session applied concurrently is filtered out of the lock read.
  select * into s from public.haccp_setup_sessions where id = p_session;
  if not found then raise exception 'session_not_found'; end if;
  if not public.is_business_manager(s.business_id) then raise exception 'forbidden'; end if;
  if s.status <> 'in_progress' then raise exception 'already_applied'; end if;
  select * into s from public.haccp_setup_sessions where id = p_session for update;
  if not found or s.status <> 'in_progress' then raise exception 'already_applied'; end if;
  if not exists (select 1 from public.sites st where st.id = s.site_id and st.business_id = s.business_id) then
    raise exception 'forbidden';
  end if;

  -- Concurrency guard: the draft was built against this version of the pack.
  select id, updated_at into v_pack_id, v_pack_upd from public.haccp_pack_data where business_id = s.business_id and site_id = s.site_id for update;
  if (p_payload->>'pack_expected_updated_at')::timestamptz is distinct from v_pack_upd then
    raise exception 'pack_changed';
  end if;

  for t in select * from jsonb_array_elements(coalesce(p_payload->'checklists', '[]'::jsonb)) loop
    if coalesce(t->>'key', '') = '' then raise exception 'missing_key'; end if;  -- NULL library_key bypasses the partial unique index
    v_tiers := array(select jsonb_array_elements_text(t->'assigned_roles'));
    if coalesce(array_length(v_tiers, 1), 0) = 0 then raise exception 'empty_roles'; end if;
    v_role_ids := array(select r.id from public.roles r where r.business_id = s.business_id and r.base_tier = any(v_tiers));
    if coalesce(array_length(v_role_ids, 1), 0) = 0 then raise exception 'empty_roles'; end if;  -- empty assigned_role_ids = invisible template
    v_tid := null;
    insert into public.checklist_templates
      (business_id, site_id, library_key, name, description, frequency, sfbb_section, deadline_time,
       assigned_roles, assigned_role_ids, is_default, active)
    values
      (s.business_id, s.site_id, t->>'key', t->>'name', t->>'description', t->>'frequency', t->>'sfbb_section',
       t->>'deadline_time', v_tiers, v_role_ids, false, false)
    on conflict (business_id, site_id, library_key) where library_key is not null do nothing
    returning id into v_tid;
    if v_tid is not null then
      v_created := v_created + 1;
      n := 0;
      for it in select * from jsonb_array_elements(t->'items') loop
        insert into public.checklist_template_items
          (template_id, name, item_type, required, sort_order, min_value, max_value, unit, description)
        values
          (v_tid, it->>'name', it->>'item_type', coalesce((it->>'required')::boolean, true), n,
           (it->>'min_value')::numeric, (it->>'max_value')::numeric, it->>'unit', it->>'description');
        n := n + 1;
      end loop;
    end if;
  end loop;

  for v_add in select * from jsonb_array_elements(coalesce(p_payload->'item_adds', '[]'::jsonb)) loop
    v_tid := (v_add->>'template_id')::uuid;
    perform 1 from public.checklist_templates
      where id = v_tid and business_id = s.business_id and site_id = s.site_id and library_key is not null;
    if not found then continue; end if;
    if exists (select 1 from public.checklist_template_items where template_id = v_tid and name = v_add->'item'->>'name') then continue; end if;
    select coalesce(max(sort_order), -1) + 1 into v_next from public.checklist_template_items where template_id = v_tid;
    insert into public.checklist_template_items
      (template_id, name, item_type, required, sort_order, min_value, max_value, unit, description)
    values
      (v_tid, v_add->'item'->>'name', v_add->'item'->>'item_type', coalesce((v_add->'item'->>'required')::boolean, true), v_next,
       (v_add->'item'->>'min_value')::numeric, (v_add->'item'->>'max_value')::numeric, v_add->'item'->>'unit', v_add->'item'->>'description');
    v_added := v_added + 1;
  end loop;

  -- ApplyPayload.pack is `PackData | null`; JSON null arrives as jsonb 'null' (not SQL NULL), so test the type.
  if jsonb_typeof(p_payload->'pack') = 'object' then
    -- The pack is per site: prod has UNIQUE (business_id, site_id) (uq_haccp_pack_business_site).
    insert into public.haccp_pack_data (business_id, site_id, data, updated_at)
    values (s.business_id, s.site_id, p_payload->'pack', now())
    on conflict (business_id, site_id) do update set data = excluded.data, updated_at = now();
  end if;

  update public.haccp_setup_sessions
     set status = 'applied', applied_at = now(), updated_at = now(),
         applied_summary = coalesce(p_payload->'summary', '{}'::jsonb)
                           || jsonb_build_object('created', v_created, 'items_added', v_added,
                                                 'questionnaire_version', s.questionnaire_version)
   where id = s.id;

  return jsonb_build_object('created', v_created, 'items_added', v_added);
end;
$$;
grant execute on function public.apply_haccp_setup(uuid, jsonb) to authenticated;
