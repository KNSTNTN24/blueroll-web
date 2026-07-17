-- Soft-delete support for businesses
alter table public.businesses add column if not exists deleted_at timestamptz;

-- Clients (authenticated/anon) must never write deleted_at directly.
-- NOTE: this column-level revoke alone is NOT sufficient enforcement here,
-- because authenticated/anon already hold Supabase's default table-level
-- UPDATE grant on public.businesses, and a table-level grant permits
-- updating any column regardless of a column-level revoke. Kept as
-- defense-in-depth; the trigger below is what actually enforces this.
revoke update (deleted_at) on public.businesses from authenticated, anon;

create or replace function public.protect_business_deleted_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and current_user in ('authenticated', 'anon') then
    raise exception 'deleted_at is not client-writable'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_business_deleted_at on public.businesses;
create trigger trg_protect_business_deleted_at
  before update on public.businesses
  for each row execute function public.protect_business_deleted_at();

-- Hide soft-deleted businesses from normal users. Rewrite the SELECT policy
-- to also require deleted_at IS NULL. (Service role bypasses RLS → support can
-- still see and restore.)
drop policy if exists "Users can view own business" on public.businesses;
create policy "Users can view own business" on public.businesses
  for select using (id = public.get_my_business_id() and deleted_at is null);
