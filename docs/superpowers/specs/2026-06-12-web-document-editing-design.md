# Web Document Editing — Design Spec

**Date:** 2026-06-12
**Repo:** `blueroll-web` (Next.js App Router)
**Branch:** `KNS/web-document-editing` (from main)
**Goal:** Full parity with the mobile document-editing feature
(`haccp-mobile` spec `2026-06-11-document-editing-design.md`, shipped in app 1.5.0+22).

## Problem

The web app can view, upload, download and delete documents, but cannot EDIT an
existing one. Fixing a wrong category, updating/clearing an expiry date, or
replacing a stale file currently means delete + re-upload (loses the original
record, owner-only). Mobile gained inline editing; web has no counterpart.

## Goals (parity with mobile)

- Edit an existing document's **title, description, category, expiry date**
  (including **clearing** expiry → SQL NULL).
- Optionally **replace the stored file in-place** in the same save (old object
  removed, no versioning).
- **owner AND manager** may edit. Delete and (mobile's) Manage Access stay
  owner-only.

## Non-goals

- No file version history; replacement is in-place.
- Access level is NOT part of the edit form (web has no Manage-Access UI today;
  the upload form's `access_level` dropdown is unchanged for create).
- No DB/RLS work — the backend is already live (see "Backend" below).

## Backend — already live (verified 2026-06-12, no migration needed)

Same Supabase as mobile (`rszrggreuarvodcqeqrj`); the mobile document-editing
migration is applied:
- `documents` UPDATE policy **`documents_update_owner_manager`**: owner|manager of
  the document's business — LIVE.
- storage.objects DELETE **`documents_storage_delete_owner_manager`**: owner|manager
  may remove old objects in their business folder — LIVE.
- Storage INSERT (new object) + SELECT (signed URLs) already work (current upload
  proves it).
- RLS UPDATE requires a passing SELECT: `documents_select` already lets a manager
  SELECT documents per `access_level` (all / managers_only / custom-granted). A
  manager editing an `owner_only` document is correctly blocked at SELECT — same
  as mobile.

So this feature is **frontend-only**.

## UI / implementation

Follow the web codebase's own recipes precedent (separate `new` vs `edit/[id]`
pages), NOT mobile's "reuse the upload screen" — different framework idiom, same
behaviour.

### 1. Detail page — `src/app/(dashboard)/documents/[id]/page.tsx`
- Role idiom already present: `const isManager = profile?.role === 'owner' || profile?.role === 'manager'`.
- Add an **Edit** button (owner+manager, i.e. `isManager`) next to the existing
  actions, routing to `/documents/edit/${id}`.
- **Delete gating fix (flagged):** the live DB policy `documents_delete` is
  **owner-only**, but the page currently shows Delete to `isManager` — a manager's
  Delete is silently RLS-denied. Mobile gates Delete to owner only. Align web:
  gate Delete to `isOwner` (`profile?.role === 'owner'`). This both matches mobile
  and fixes the latent bug. *(One-line, reversible; called out for review.)*

### 2. Edit page — `src/app/(dashboard)/documents/edit/[id]/page.tsx` (NEW)
Mirrors `documents/upload/page.tsx` in an edit mode:
- Loads the document: `useQuery(['document', id], select '*, uploader:profiles!documents_uploaded_by_fkey(full_name,email)')` — same shape as the detail page.
- Prefills: `title`, `description`, `category`, `expires_at` (the `<input type="date">`
  value is the `YYYY-MM-DD` slice of `expires_at`; empty = no expiry).
- File card: shows the **current file name** with hint "Replace file (optional)".
  Picking a file is **optional**; no pick = keep stored file.
- **No access_level field** (excluded).
- Header "Edit Document"; submit button "Save Changes" / "Saving…".
- Page guards: redirect non-managers away (defence-in-depth; RLS is the real gate),
  and "Document not found" / loading states like other detail/edit pages.

### 3. Save handler (the mutation) — mirrors mobile `updateDocument`
1. If a new file is picked: upload to bucket `documents` at
   `${business.id}/${Date.now()}_${sanitizedName}` (same convention + the upload
   page's `name.replace(/[^a-zA-Z0-9._-]/g, '_')` sanitiser); remember the old
   `file_url`.
2. `supabase.from('documents').update({...}).eq('id', id)` with **always**:
   `title`, `description` (|| null), `category`, `expires_at`
   (`expiresAt ? new Date(expiresAt).toISOString() : null` — null clears); **plus**
   `file_url`, `file_name`, `file_size`, `file_type` when a file was uploaded.
3. Best-effort remove old object: `supabase.storage.from('documents').remove([oldFileUrl])`
   inside try/catch (ignore failure), only when the file was replaced.
4. Invalidate `['documents']` and `['document', id]`; toast; `router.push('/documents/'+id)`.

Ordering matches mobile: a mid-flow failure leaves the row consistent; worst case
is an orphaned new object (same exposure as the existing delete/upload flows).

## Derived decisions (flag for review)

1. Separate `edit/[id]` page (web recipes precedent), not a shared form component —
   lower risk, consistent with codebase. Sharing a `DocumentForm` is a possible
   later cleanup.
2. **Delete on web detail aligned to owner-only** (matches mobile + live RLS;
   fixes a latent manager-sees-but-can't-delete bug). Revert one line if undesired.
3. Edit excludes access level (parity with mobile; web has no Manage-Access UI).
4. `expires_at` is a DATE column; the date input round-trips via the `YYYY-MM-DD`
   slice on load and `new Date(value).toISOString()` on save (existing upload idiom).

## Verification

- `npm run build` clean (view-code gate; no unit tests for pages, per codebase
  convention). `npm test` stays green (no lib logic touched).
- Manual (owner + manager test accounts): edit metadata; clear expiry; replace a
  file (confirm old object gone, new served); a manager sees Edit; plain staff
  sees neither Edit nor (now) Delete.

## Out of scope

- Manage Access / `document_access` UI on web (doesn't exist; not part of editing).
- Changing the upload form or its `access_level` create behaviour.
- File versioning.
