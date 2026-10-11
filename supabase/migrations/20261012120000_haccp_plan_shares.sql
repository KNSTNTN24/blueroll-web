-- HACCP Plan share links: an inspector link (read-only, up to 30 days) or a short-lived PDF render token.
-- Only sha256(token) is stored. Reads by token happen in the haccp-plan edge function with the service role;
-- members manage their own business's links through RLS. No anon access.
create table if not exists public.haccp_plan_shares (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  kind text not null check (kind in ('inspector', 'pdf')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label text check (label is null or length(label) <= 80),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz
);
create index if not exists idx_haccp_plan_shares_business on public.haccp_plan_shares(business_id, site_id, created_at desc);

alter table public.haccp_plan_shares enable row level security;

drop policy if exists haccp_plan_shares_select on public.haccp_plan_shares;
create policy haccp_plan_shares_select on public.haccp_plan_shares for select
  using (business_id = public.get_my_business_id() and (site_id is null or public.can_see_site_row(site_id)));

drop policy if exists haccp_plan_shares_insert on public.haccp_plan_shares;
create policy haccp_plan_shares_insert on public.haccp_plan_shares for insert
  with check (
    business_id = public.get_my_business_id()
    and created_by = auth.uid()
    and (site_id is null or public.can_see_site_row(site_id))
    and revoked_at is null and view_count = 0
    and (
      (kind = 'pdf' and expires_at <= now() + interval '15 minutes')
      or (kind = 'inspector' and public.is_active_business_manager(business_id) and expires_at <= now() + interval '30 days')
    )
  );

drop policy if exists haccp_plan_shares_revoke on public.haccp_plan_shares;
create policy haccp_plan_shares_revoke on public.haccp_plan_shares for update
  using (business_id = public.get_my_business_id() and public.is_active_business_manager(business_id))
  with check (business_id = public.get_my_business_id());

-- Members may only set revoked_at; every other column is fixed after insert (service role skips the check).
create or replace function public.haccp_plan_shares_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then return new; end if;
  if new.business_id is distinct from old.business_id or new.site_id is distinct from old.site_id
     or new.kind is distinct from old.kind or new.token_hash is distinct from old.token_hash
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at or new.label is distinct from old.label
     or new.view_count is distinct from old.view_count or new.last_viewed_at is distinct from old.last_viewed_at then
    raise exception 'only revoked_at can be changed';
  end if;
  return new;
end $$;
drop trigger if exists trg_haccp_plan_shares_guard on public.haccp_plan_shares;
create trigger trg_haccp_plan_shares_guard before update on public.haccp_plan_shares
  for each row execute function public.haccp_plan_shares_guard();
