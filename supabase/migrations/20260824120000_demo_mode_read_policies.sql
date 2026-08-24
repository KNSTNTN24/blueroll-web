-- Demo mode: every authenticated user may READ (never write) the shared
-- showcase business "St James's Cafe". The web app overlays this business on
-- top of the user's own when the Settings → Demo mode toggle is on; RLS keeps
-- the demo strictly read-only because none of the write policies match it.
--
-- Policies are generated dynamically for every public table that is scoped to
-- a business, directly (business_id / site_id column) or via one foreign-key
-- hop (e.g. delivery_photos → deliveries). Re-running is safe: each policy is
-- dropped and recreated.

set search_path = public;

create or replace function public.demo_business_id()
returns uuid language sql immutable parallel safe as $$
  select 'a8ff4795-1dee-4a89-b693-0b1b6d2ddae3'::uuid
$$;
grant execute on function public.demo_business_id() to authenticated;

do $$
declare
  t record;
  fk record;
  pred text;
  -- User-private or invite/billing plumbing — the demo must not leak these.
  deny constant text[] := array[
    'notifications', 'invites', 'trial_grants', 'feedback_requests',
    'checklist_drafts', 'capability_catalog'
  ];
begin
  for t in
    select c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    if t.tbl = any(deny) then continue; end if;
    pred := null;

    if t.tbl = 'businesses' then
      pred := 'id = public.demo_business_id()';
    elsif exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = t.tbl and column_name = 'business_id') then
      pred := 'business_id = public.demo_business_id()';
    elsif exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = t.tbl and column_name = 'site_id') then
      pred := 'site_id in (select id from public.sites where business_id = public.demo_business_id())';
    else
      -- One FK hop to a parent that carries business_id or site_id.
      for fk in
        select kcu.column_name as col, ccu.table_name as parent
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
        where tc.table_schema = 'public' and tc.table_name = t.tbl
          and tc.constraint_type = 'FOREIGN KEY' and ccu.column_name = 'id'
      loop
        if fk.parent = any(deny) then continue; end if;
        if exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = fk.parent and column_name = 'business_id') then
          pred := format('%I in (select id from public.%I where business_id = public.demo_business_id())', fk.col, fk.parent);
          exit;
        elsif exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = fk.parent and column_name = 'site_id') then
          pred := format(
            '%I in (select id from public.%I where site_id in (select id from public.sites where business_id = public.demo_business_id()))',
            fk.col, fk.parent);
          exit;
        end if;
      end loop;
    end if;

    if pred is not null then
      execute format('drop policy if exists demo_read on public.%I', t.tbl);
      execute format('create policy demo_read on public.%I for select to authenticated using (%s)', t.tbl, pred);
      raise notice 'demo_read on %: %', t.tbl, pred;
    else
      raise notice 'demo_read SKIPPED (no business scope found): %', t.tbl;
    end if;
  end loop;
end $$;

-- Storage: demo documents and check photos live under <business_id>/… in the
-- "documents" bucket. Read-only, demo folder only.
drop policy if exists demo_read_documents on storage.objects;
create policy demo_read_documents on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = public.demo_business_id()::text);
