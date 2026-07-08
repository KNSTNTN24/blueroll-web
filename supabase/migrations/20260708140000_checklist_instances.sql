-- Real scheduled-instances table so Reports "due / missed" is exact, not estimated.
-- One row per (template, site, period) that SHOULD be completed in the period.
create table if not exists public.checklist_instances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  due_date date not null,        -- period start
  period_end date not null,      -- exclusive
  completion_id uuid references public.checklist_completions(id) on delete set null,
  status text not null default 'pending', -- pending | completed | missed
  created_at timestamptz not null default now()
);
create unique index if not exists uq_checklist_instance on public.checklist_instances (template_id, coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid), due_date);
create index if not exists idx_ci_business_due on public.checklist_instances (business_id, due_date);

alter table public.checklist_instances enable row level security;
drop policy if exists ci_select on public.checklist_instances;
create policy ci_select on public.checklist_instances for select using (business_id = public.get_my_business_id());

-- Generate scheduled instances for active templates across their sites for a date range.
create or replace function public.generate_checklist_instances(p_business uuid, p_from date, p_to date)
returns int language plpgsql security definer set search_path=public as $$
declare v int;
begin
  insert into checklist_instances (business_id, template_id, site_id, due_date, period_end)
  select distinct t.business_id, t.id, s.id,
    case t.frequency
      when 'weekly'      then date_trunc('week',  d)::date
      when 'monthly'     then date_trunc('month', d)::date
      when 'four_weekly' then date_trunc('month', d)::date
      else d::date
    end as due_date,
    case t.frequency
      when 'weekly'      then (date_trunc('week',  d) + interval '7 days')::date
      when 'monthly'     then (date_trunc('month', d) + interval '1 month')::date
      when 'four_weekly' then (date_trunc('month', d) + interval '1 month')::date
      else (d + interval '1 day')::date
    end as period_end
  from checklist_templates t
  join sites s on s.business_id = t.business_id and (t.site_id is null or t.site_id = s.id)
  join generate_series(p_from, p_to, interval '1 day') gs(d) on true
  where t.active and (p_business is null or t.business_id = p_business)
  on conflict do nothing;
  get diagnostics v = row_count;
  return v;
end $$;

-- Link existing completions to their scheduled instance (earliest completion wins per instance).
create or replace function public.link_checklist_instances(p_business uuid)
returns int language plpgsql security definer set search_path=public as $$
declare v int;
begin
  with matches as (
    select distinct on (ci.id) ci.id as iid, c.id as cid
    from checklist_instances ci
    join checklist_completions c
      on c.template_id = ci.template_id
     and c.site_id is not distinct from ci.site_id
     and c.completed_at::date >= ci.due_date
     and c.completed_at::date <  ci.period_end
    where ci.completion_id is null
      and (p_business is null or ci.business_id = p_business)
    order by ci.id, c.completed_at
  )
  update checklist_instances ci set completion_id = m.cid, status='completed'
  from matches m where ci.id = m.iid;
  get diagnostics v = row_count;
  -- anything past its period with no completion is a real miss
  update checklist_instances set status='missed'
  where completion_id is null and period_end < current_date
    and (p_business is null or business_id = p_business) and status <> 'missed';
  return v;
end $$;

-- New completions auto-link to (or create) their instance.
create or replace function public._link_completion_instance() returns trigger language plpgsql security definer set search_path=public as $$
declare v_tpl record;
begin
  select frequency into v_tpl from checklist_templates where id = NEW.template_id;
  if v_tpl is null then return NEW; end if;
  insert into checklist_instances (business_id, template_id, site_id, due_date, period_end, completion_id, status)
  values (
    NEW.business_id, NEW.template_id, NEW.site_id,
    case v_tpl.frequency when 'weekly' then date_trunc('week',NEW.completed_at)::date when 'monthly' then date_trunc('month',NEW.completed_at)::date when 'four_weekly' then date_trunc('month',NEW.completed_at)::date else NEW.completed_at::date end,
    case v_tpl.frequency when 'weekly' then (date_trunc('week',NEW.completed_at)+interval '7 days')::date when 'monthly' then (date_trunc('month',NEW.completed_at)+interval '1 month')::date when 'four_weekly' then (date_trunc('month',NEW.completed_at)+interval '1 month')::date else (NEW.completed_at::date + 1) end,
    NEW.id, 'completed'
  )
  on conflict (template_id, coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid), due_date)
  do update set completion_id = coalesce(checklist_instances.completion_id, NEW.id), status='completed';
  return NEW;
exception when others then return NEW;
end $$;
drop trigger if exists trg_link_completion_instance on public.checklist_completions;
create trigger trg_link_completion_instance after insert on public.checklist_completions
  for each row execute function public._link_completion_instance();
