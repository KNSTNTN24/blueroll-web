create table if not exists public.feedback_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('question', 'feature', 'bug', 'feedback')),
  message text not null check (char_length(btrim(message)) between 5 and 4000),
  rating smallint check (rating between 1 and 5),
  status text not null default 'new' check (status in ('new', 'open', 'planned', 'resolved', 'closed')),
  response text,
  responded_at timestamptz,
  page_url text,
  page_path text,
  metadata jsonb not null default '{}'::jsonb,
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  email_provider_id text,
  email_error text,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_feedback_requests_business_created
  on public.feedback_requests (business_id, created_at desc);
create index if not exists idx_feedback_requests_creator_created
  on public.feedback_requests (created_by, created_at desc);
create index if not exists idx_feedback_requests_status_created
  on public.feedback_requests (status, created_at desc);

alter table public.feedback_requests enable row level security;

drop policy if exists feedback_requests_select_own on public.feedback_requests;
create policy feedback_requests_select_own on public.feedback_requests
  for select to authenticated
  using (created_by = auth.uid() and business_id = public.get_my_business_id());

drop policy if exists feedback_requests_insert_own on public.feedback_requests;
create policy feedback_requests_insert_own on public.feedback_requests
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and business_id = public.get_my_business_id()
    and status = 'new'
    and response is null
    and responded_at is null
    and (
      site_id is null
      or exists (
        select 1 from public.sites
        where sites.id = feedback_requests.site_id
          and sites.business_id = public.get_my_business_id()
      )
    )
  );

revoke all on public.feedback_requests from anon, authenticated;
grant select on public.feedback_requests to authenticated;
grant insert (
  business_id,
  site_id,
  created_by,
  kind,
  message,
  rating,
  page_url,
  page_path,
  metadata
) on public.feedback_requests to authenticated;
