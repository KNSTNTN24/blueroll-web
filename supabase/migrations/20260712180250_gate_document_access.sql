-- Close a write-gate leak: Task 3 (20260712180200_entitlement_write_gate.sql)
-- gated 26 business tables but missed public.document_access. It has no
-- business_id column of its own — it ties to a business via
-- document_id -> public.documents.id -> documents.business_id — and carries a
-- permissive owner/manager INSERT policy with no entitlement check, so an
-- UNentitled (unpaid/expired) business's owner/manager could still INSERT
-- document-access grants.
--
-- Gated the same way as the other five child tables (parent join through the
-- FK), AS RESTRICTIVE so it AND-composes with the existing permissive
-- document_access_insert policy without touching it. SELECT and DELETE are
-- left untouched, consistent with every other table in the write-gate.

drop policy if exists entitlement_write_gate_ins on public.document_access;
create policy entitlement_write_gate_ins on public.document_access
  as restrictive for insert to authenticated
  with check (public.is_business_entitled((select business_id from public.documents d where d.id = document_id)));
drop policy if exists entitlement_write_gate_upd on public.document_access;
create policy entitlement_write_gate_upd on public.document_access
  as restrictive for update to authenticated
  using (public.is_business_entitled((select business_id from public.documents d where d.id = document_id)))
  with check (public.is_business_entitled((select business_id from public.documents d where d.id = document_id)));
