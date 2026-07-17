-- Test: RESTRICTIVE entitlement write-gate on public.document_access.
--
-- document_access has no business_id column of its own — it ties to a business
-- via document_id -> public.documents.id -> documents.business_id. Task 3
-- (entitlement_write_gate.sql) gated 26 tables but missed this one, leaving an
-- ungated write: an UNentitled business's owner/manager could still INSERT
-- document-access grants (permissive `document_access_insert` policy has no
-- entitlement check).
--
-- Proves the new `entitlement_write_gate_ins` restrictive policy:
--   1. An UNentitled (expired-trial) business's owner CANNOT insert into
--      document_access for one of that business's documents.
--   2. Once the same business is entitled, the owner CAN insert.
--   3. SELECT of a pre-existing row is UNAFFECTED while unentitled (reads stay open).
--
-- Runs entirely inside a rolled-back transaction. Reuses the existing throwaway
-- "Android Test Restaurant" fixture (real business + owner profile backed by a
-- real auth.users row) rather than minting a new auth user.
--
-- CRITICAL: every id is resolved (into transaction-local GUCs) by the privileged
-- role BEFORE we switch to `authenticated`. After the role switch, any lookup on
-- profiles/businesses/documents falls under RLS and would silently return NULL,
-- producing a false-positive pass. GUCs set with is_local=true survive the role
-- switch and are readable by any role, so we never re-query ids while impersonating.

begin;

-- ===== PRIVILEGED SETUP (resolve ids up front) =====
select set_config('wg.biz',
  (select b.id::text from public.businesses b
     join public.profiles p on p.business_id = b.id
    where b.name = 'Android Test Restaurant' and p.role = 'owner' limit 1), true);
select set_config('wg.owner',
  (select p.id::text from public.businesses b
     join public.profiles p on p.business_id = b.id
    where b.name = 'Android Test Restaurant' and p.role = 'owner' limit 1), true);

-- Fail loudly if the fixture is missing (would otherwise NULL out into false passes).
do $$ begin
  if nullif(current_setting('wg.biz', true), '') is null
     or nullif(current_setting('wg.owner', true), '') is null then
    raise exception 'FIXTURE MISSING: Android Test Restaurant owner not found';
  end if;
end $$;

-- Seed three documents (privileged) for the fixture business — this business
-- has no pre-existing documents. document_access has a unique (document_id,
-- profile_id) constraint and this fixture business has only one profile (the
-- owner), so each insert attempt below needs its own document to avoid
-- colliding with the pre-existing row on that constraint.
insert into public.documents (title, file_url, file_name, uploaded_by, business_id)
  values ('WG_DOC_PREEXISTING', 'https://example.test/wg-doc-0.pdf', 'wg-doc-0.pdf',
          current_setting('wg.owner')::uuid, current_setting('wg.biz')::uuid)
  returning set_config('wg.doc0', id::text, true);
insert into public.documents (title, file_url, file_name, uploaded_by, business_id)
  values ('WG_DOC_UNENT', 'https://example.test/wg-doc-1.pdf', 'wg-doc-1.pdf',
          current_setting('wg.owner')::uuid, current_setting('wg.biz')::uuid)
  returning set_config('wg.doc1', id::text, true);
insert into public.documents (title, file_url, file_name, uploaded_by, business_id)
  values ('WG_DOC_ENT', 'https://example.test/wg-doc-2.pdf', 'wg-doc-2.pdf',
          current_setting('wg.owner')::uuid, current_setting('wg.biz')::uuid)
  returning set_config('wg.doc2', id::text, true);

-- Seed a pre-existing document_access row (privileged) so the SELECT-unaffected
-- check has a row. Grants access to the owner themself (profile_id NOT NULL).
insert into public.document_access (document_id, profile_id, granted_by)
  values (current_setting('wg.doc0')::uuid, current_setting('wg.owner')::uuid, current_setting('wg.owner')::uuid)
  returning set_config('wg.access', id::text, true);

-- Make the business UNentitled: expired trial on the manual channel, no stripe/iap
-- grace, not soft-deleted. subscription_status/trial_ends_at are recomputed by the
-- _subscription_arbiter trigger from these raw channel columns, so we set the raw
-- columns (never the computed ones).
update public.businesses set
  manual_status = 'trialing', manual_until = now() - interval '1 day',
  stripe_status = null, stripe_until = null,
  iap_status = null, iap_expires_at = null,
  deleted_at = null
  where id = current_setting('wg.biz')::uuid;

-- ===== IMPERSONATE THE OWNER (authenticated) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('wg.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- CHECK 1: unentitled INSERT into document_access must be DENIED by the restrictive gate.
do $$ begin
  begin
    insert into public.document_access (document_id, profile_id, granted_by)
      values (current_setting('wg.doc1')::uuid, current_setting('wg.owner')::uuid, auth.uid());
    raise exception 'FAIL: unentitled owner was able to INSERT into document_access';
  exception when insufficient_privilege then null;  -- expected: RLS restrictive denial
  end;
end $$;

-- CHECK 3: SELECT of the pre-existing document_access row is UNAFFECTED while unentitled.
do $$
declare n int;
begin
  select count(*) into n from public.document_access where id = current_setting('wg.access')::uuid;
  if n <> 1 then
    raise exception 'FAIL: unentitled SELECT of existing document_access row returned % rows (expected 1)', n;
  end if;
end $$;

-- ===== BACK TO PRIVILEGED: make the business ENTITLED =====
-- Drive the manual channel to 'active'; the arbiter recomputes subscription_status.
reset role;
update public.businesses set
  manual_status = 'active', manual_until = now() + interval '30 days'
  where id = current_setting('wg.biz')::uuid;

-- ===== IMPERSONATE AGAIN (authenticated) =====
set local role authenticated;

-- CHECK 2: entitled INSERT into document_access must SUCCEED.
do $$
declare n int;
begin
  insert into public.document_access (document_id, profile_id, granted_by)
    values (current_setting('wg.doc2')::uuid, current_setting('wg.owner')::uuid, auth.uid());
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: entitled owner INSERT wrote % rows (expected 1)', n;
  end if;
end $$;

reset role;
select 'ALL PASS' as result;
rollback;
