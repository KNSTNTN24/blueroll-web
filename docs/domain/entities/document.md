# Document (`documents`)

> A file a business keeps to prove compliance — a hygiene certificate, a pest-control contract, an allergen policy,
> an inspection report — with a category, who may see it, and when it expires.

**Tables:** `documents`, `document_access` (per-person access) · **Storage:** private bucket `documents` ·
**Scope:** business, tagged with a site · **Last verified:** 2026-10-13 against `main@b50e9d1` and the live DB (148 documents)

## What it is for

The Documents page is the business's paperwork drawer, "organised by expiry" (`src/app/(dashboard)/documents/page.tsx:123`):
an inspector asks for a certificate, the owner opens it on the phone. Documents also back the HACCP Pack's file
fields, fill in pack answers automatically (training records, pest-control company) and are listed in the HACCP Plan.

## Parameters

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Title, Description | `title`, `description` | What it is. Titles are what the HACCP Pack auto-fill and the Plan show. | text | — |
| Category | `category` | Kind of paper. Drives filters and auto-fill. | `certificate`, `license`, `policy`, `instruction`, `contract`, `inspection`, `training`, `other` | code only: `DOCUMENT_CATEGORIES` `src/lib/constants.ts:64-66`, mobile enum `haccp-mobile/lib/models/document.dart:1-9`. No DB `CHECK` |
| Who can see it | `access_level` | Visibility inside the business. | `all` (everyone), `managers_only` (needs `manage_documents`), `owner_only` (needs `view_documents`), `custom` (named people in `document_access`) | RLS `documents_select`. **Web list writes `managers`, which RLS does not know** — Gotcha 1 |
| Expires | `expires_at` | When the document stops being valid. Drives badges and reminders. | timestamp or null | badges on web (Expired / "N d left" within 30 days); reminders only from the mobile app (Gotcha 4) |
| Site | `site_id` | Which site it belongs to. Null = all sites. | uuid or null | not checked by RLS (no `can_see_site_row`) |
| File | `file_url` | **A storage path, not a URL**: `{business_id}/{timestamp}_{filename}` in bucket `documents`. Opened through a signed URL (120 s on the list, 3600 s on detail and in the pack). | path | storage policies key on the first folder = caller's business |
| File name, type, size | `file_name`, `file_type`, `file_size` | From the uploaded file. | — | no limits on web; mobile full upload allows pdf, jpg, jpeg, png, docx, xlsx |
| Uploaded by | `uploaded_by` | Member who uploaded it. | profile id | FK `ON DELETE CASCADE` (a hard-deleted member takes their documents) |

**Per-person access** (`document_access`): `(document_id, profile_id, granted_by)` — who may see a `custom`
document. Written only by the mobile app (on upload and via owner-only "Manage access"); the web never writes it.

### Known drift (live data, 2026-10-13)

- `category`: `other` 55, `training` 27, `policy` 24, `instruction` 18, `certificate` 12, `license` 4, `inspection` 2,
  **`inspections` 2, `certificates` 1, `insurance` 1, `operations` 1** — the bold values are written by no code in
  either repo (manual/SQL inserts). Mobile shows them as `other`; web shows the raw string. Canonical: the eight above.
- `access_level`: `all` 133, **`managers` 7**, `managers_only` 7, `custom` 1. Canonical: `managers_only`.
- `site_id`: no live row is null; 19 documents have an expiry, 2 already expired.

## Lifecycle

**Created by:**

| Path | Sets `site_id`? | Access options |
|---|---|---|
| Web `/documents` slide-over (main) | yes | `all`, `managers` (sic) — `page.tsx:96-111,235-238` |
| Web *document picker* (HACCP Pack file fields, *Set up my HACCP* documents step) | no | `all`, `managers_only`, `owner_only` — `src/components/shared/document-picker-modal.tsx:90-133` |
| Web `/documents/upload` (legacy, unlinked) | no | `all`, `managers_only`, `owner_only` |
| Mobile quick upload | yes | `all`, `managers_only` — `haccp-mobile/lib/screens/documents/documents_screen.dart:772-830` |
| Mobile full upload | no | + `custom` with people — `document_upload_screen.dart:145-155`, `providers/documents_provider.dart:47-118` |

**Edited:** title, description, category, expiry; replacing the file uploads the new object, updates the row, then
best-effort removes the old object (web `documents/edit/[id]/page.tsx:70-97`, mobile `documents_provider.dart:144-211`).
Access level is not editable on the web.

**Expiring:** mobile `StartupChecks` (on dashboard open) notifies managers at 30 days, 7 days and ≤1 day before
`expires_at` (type `document` in `notifications`) — `haccp-mobile/lib/utils/startup_checks.dart:70-104`. No server job.

**Deleted:** storage object first, then the row (web `page.tsx:87-91`, `[id]/page.tsx:61-69`; mobile
`documents_provider.dart:120-142`). `document_access` rows cascade. Business purge deletes rows and the edge function
`purge-deleted-businesses` empties the bucket folder.

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See | business member AND (`view_documents` OR `all` OR `managers_only`+`manage_documents` OR `owner_only`+`view_documents` OR `custom`+named in `document_access`) | RLS `documents_select` |
| Upload | `manage_documents` (+ business entitled) for the row; any business member for the file | RLS `documents_insert`, `entitlement_write_gate_ins`; storage `storage_documents_insert` |
| Edit | `manage_documents`, or `view_documents`, or the uploader | RLS `documents_update`, `documents_update_owner_manager` |
| Delete | **`view_documents`** for the row; owner or manager (by tier text) for the file | RLS `documents_delete`; storage `storage_documents_delete`, `documents_storage_delete_owner_manager` |
| Grant per-person access | insert needs `manage_documents`; remove needs `view_documents` | RLS on `document_access` |
| UI | web list shows Upload and Delete to everyone; web detail: Edit owner/manager, Delete owner; mobile: upload/delete managers, Access & Delete owner | `documents/page.tsx:125,181`, `[id]/page.tsx:42-43`, `documents_screen.dart:50,88,645`, `document_detail_screen.dart:167-191` |

Presets: Owner has `manage_documents` + `view_documents`; Manager has `manage_documents`; Chef and staff have neither.
See [Tiers, roles and capabilities](../concepts/roles-and-capabilities.md).

## Related

- **HACCP Pack** — file fields `fa_matrix_file`, `pc_contract_file`, `cs_file`, `oc_file`, `sup_file`, `tr_file`, `dd_file`
  store `{"id","title"}` of a document in `haccp_pack_data.files` (web). Auto-fill: `pc_company` = titles of
  `contract`/`inspection` documents, `tr_records` = titles of `training`/`certificate` documents (`src/lib/haccp-pack/auto-data.ts:204-209`).
- **HACCP Plan** — lists only documents with `access_level` null or `all` (`supabase/functions/_shared/haccp-plan/scope.ts:9-13`); "Training documents" counts `training` + `certificate`.
- **Same bucket, not documents:** checklist photo answers (`{business}/checklist-photos/…`), delivery photos (`{business}/delivery-photos/…`, in `delivery_photos`), mobile HACCP Pack uploads.
- **Notifications** — type `document` (expiry).

## Where in code

| Area | Location |
|---|---|
| Web pages | `src/app/(dashboard)/documents/` (list + slide-over upload, `[id]`, `edit/[id]`, legacy `upload`) |
| Shared | `src/components/shared/document-picker-modal.tsx`, `src/lib/constants.ts` (categories), `src/lib/haccp-pack/auto-data.ts` |
| Mobile | `haccp-mobile/lib/models/document.dart`, `providers/documents_provider.dart`, `screens/documents/`, `utils/startup_checks.dart` |
| Edge / DB | RLS `documents_*`, `document_access_*`; storage policies on `documents` bucket; `purge-deleted-businesses` |

## Gotchas

1. **`managers` documents are hidden from managers.** The web list saves "Managers" as `managers`; RLS only knows
   `managers_only`, so such a document is visible only to holders of `view_documents` (owners) — not even to the
   manager who uploaded it. Web detail labels it "Owner only"; mobile shows it as "All staff". 7 live rows.
2. **A manager's delete half-fails silently.** Storage lets a manager delete the file, but the row needs
   `view_documents`; the row delete matches nothing without an error, the UI says "Document deleted", and a row
   pointing at a missing file remains. Likewise a Chef can upload the file but not insert the row (orphan object).
3. **`view_documents` is owner-level**, not "view only": edit and delete any document, remove access grants.
4. **No server-side expiry reminders.** The web helper `notifyExpiringDocument` (`src/lib/notifications.ts:63-67`) is
   never called; reminders come only from a mobile app that someone opens, deduped in memory per device (duplicates
   across devices; already-expired documents are never notified).
5. **`document_access` is readable by every signed-in user** (live policy `document_access_select USING true`), across businesses.
6. **Site is cosmetic.** RLS ignores `site_id`; the pack, picker and Plan ignore it; site-filtered lists hide null-site rows.
7. **Web and mobile HACCP Pack files are incompatible.** Web stores `{"id","title"}`, mobile stores a raw storage path;
   each shows the other's as empty or garbage, and mobile pack files never appear in Documents or get expiry tracking.
8. **Mobile does not sanitise file names** (web replaces `[^a-zA-Z0-9._-]` with `_` because special characters gave storage "Invalid key" errors).
9. **Dead entry points:** list rows don't link to the detail page; the command palette's `/documents?upload=true` is
   ignored; `/documents/upload` is unlinked.
10. `docs/04-DATABASE.md` and `docs/02-FEATURES.md` describe documents incorrectly (no `site_id`, web access management) — use this page.

## History

- 2026-10-12 *Set up my HACCP* documents step uses the picker (`2026-10-12-haccp-setup-v2-design.md`).
- 2026-10-11 HACCP Plan lists documents (`2026-10-11-haccp-plan-document-design.md`).
- 2026-07-14 RBAC moved document RLS to capabilities (`20260714130300_rbac_rls_swap.sql:84-112`).
- 2026-07-12 account deletion purges documents and storage (`2026-07-12-account-deletion-design.md`).
- 2026-07-07 multisite added `site_id`.
- 2026-06-12 web document editing (`2026-06-12-web-document-editing-design.md`); 2026-06-11 mobile editing.
