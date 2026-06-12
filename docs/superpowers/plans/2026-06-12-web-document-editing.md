# Web Document Editing — Implementation Plan

> Execute with subagent-driven-development. Frontend-only (backend RLS already live).
> Spec: `docs/superpowers/specs/2026-06-12-web-document-editing-design.md`.

**Goal:** Full parity with mobile document editing on web — edit title/description/
category/expiry (+ clear) and optionally replace the file in place; owner+manager.

**Branch:** `KNS/web-document-editing` (from main). Gate: `npm run build` clean +
`npm test` green. Repo `/Users/knstntn/HACCP/web`.

---

### Task 1: Edit page — `src/app/(dashboard)/documents/edit/[id]/page.tsx` (NEW)

**Reference, read first:**
- `src/app/(dashboard)/documents/upload/page.tsx` — the form to MIRROR (imports,
  layout components, file picker, category select, expiry input, toast, mutation,
  storage upload, the filename sanitiser `name.replace(/[^a-zA-Z0-9._-]/g, '_')`,
  bucket `documents`, path `${business.id}/${Date.now()}_${safeName}`).
- `src/app/(dashboard)/documents/[id]/page.tsx` — the document query shape
  (`['document', id]`, select `'*, uploader:profiles!documents_uploaded_by_fkey(full_name,email)'`).
- `src/app/(dashboard)/recipes/edit/[id]/page.tsx` — the web edit-page idiom
  (route param via `use(params)`, load+prefill effect, loading / not-found states).

**Build the edit page** as a client component mirroring the upload form, with these
DELTAS from upload:

1. **Route param + load.** `export default function EditDocumentPage({ params }: { params: Promise<{ id: string }> })`,
   `const { id } = use(params)`. Query the document with `useQuery({ queryKey: ['document', id], queryFn: … })`
   (same select as the detail page). Loading + "Document not found" states like the
   recipes edit page.

2. **Manager guard (defence-in-depth).** `const isManager = profile?.role === 'owner' || profile?.role === 'manager'`.
   If not `isManager`, render a "not authorised" message / redirect to `/documents/${id}`.
   (RLS is the real gate; this just hides the UI.)

3. **Prefill state from the loaded doc** (in a `useEffect` guarded by a `loaded` flag,
   like recipes/edit): `title`, `description ?? ''`, `category`, and
   `expiresAt` = `doc.expires_at ? doc.expires_at.slice(0, 10) : ''` (the `<input type="date">`
   wants `YYYY-MM-DD`; `expires_at` is a DATE so the first 10 chars are safe).

4. **File is OPTIONAL.** State `const [file, setFile] = useState<File | null>(null)`.
   The file card shows the CURRENT file name (`doc.file_name`) with hint
   "Replace file (optional)" when nothing is picked, and the picked file's name when
   one is. No required-file validation.

5. **NO access_level field** — omit that section entirely.

6. **Header & button:** title "Edit Document"; submit label "Save Changes" /
   "Saving…".

7. **Save mutation** (mirrors mobile `updateDocument`):
   ```ts
   const mutation = useMutation({
     mutationFn: async () => {
       if (!business?.id) throw new Error('No business found')
       const update: Record<string, any> = {
         title: title.trim() || doc.file_name,
         description: description.trim() || null,
         category,
         expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
       }
       let oldFileUrl: string | null = null
       if (file) {
         const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
         const filePath = `${business.id}/${Date.now()}_${safeName}`
         const { error: upErr } = await supabase.storage.from('documents').upload(filePath, file)
         if (upErr) throw upErr
         oldFileUrl = doc.file_url
         update.file_url = filePath
         update.file_name = file.name
         update.file_size = file.size
         update.file_type = file.type || null
       }
       const { error: updErr } = await supabase.from('documents').update(update).eq('id', id)
       if (updErr) throw updErr
       if (oldFileUrl) {
         try { await supabase.storage.from('documents').remove([oldFileUrl]) } catch { /* best-effort */ }
       }
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['documents'] })
       queryClient.invalidateQueries({ queryKey: ['document', id] })
       toast.success('Document updated')
       router.push(`/documents/${id}`)
     },
     onError: (err: Error) => toast.error(err.message),
   })
   ```
   (Use the exact `supabase` import + `toast` + `useQueryClient` the upload page uses.
   `doc` here is the loaded document from the query — guard the mutation behind it
   being loaded.)

8. **Layout:** reuse the upload page's section/field components and Tailwind classes
   so it looks consistent. Category `<select>` from `DOCUMENT_CATEGORIES`
   (`@/lib/constants`), capitalised the same way the upload page does it.

**Gate:** `npm run build` passes; `npm test` green. Commit ONLY this file:
```bash
git add "src/app/(dashboard)/documents/edit/[id]/page.tsx"
git commit -m "feat(web): document edit page (parity with mobile)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Detail page — Edit action + Delete owner-only

**File:** `src/app/(dashboard)/documents/[id]/page.tsx`

1. Add an **Edit** button next to the existing actions, shown when `isManager`
   (owner+manager), routing to the edit page:
   ```tsx
   {isManager && (
     <Button variant="outline" size="sm" onClick={() => router.push(`/documents/edit/${id}`)} className="gap-1.5">
       <Pencil className="h-3.5 w-3.5" />
       Edit
     </Button>
   )}
   ```
   (Import `Pencil` from lucide-react; match the existing button styling/placement —
   put Edit before Delete. Ensure `router` is in scope — it is via `useRouter`.)

2. **Align Delete to owner-only** (spec decision 2): the Delete button is currently
   gated `{isManager && (…)}`. Change that gate to owner-only. Add
   `const isOwner = profile?.role === 'owner'` near `isManager`, and wrap Delete with
   `{isOwner && (…)}` instead of `{isManager && (…)}`. (Matches mobile + the live
   `documents_delete` policy which is owner-only; managers were seeing a button that
   RLS rejected.)

**Gate:** `npm run build` passes. Commit ONLY this file:
```bash
git add "src/app/(dashboard)/documents/[id]/page.tsx"
git commit -m "feat(web): Edit action on document detail (owner+manager); Delete owner-only

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review

- Spec coverage: edit all fields + clear expiry (Task 1 prefill + update payload);
  optional in-place file replace + old-object cleanup (Task 1 mutation); owner+manager
  edit (Task 1 guard + Task 2 Edit button); Delete owner-only (Task 2). Backend: none
  (RLS live, verified).
- No DB/migration work. No changes to the upload (create) flow.
- `expires_at` round-trip: load `slice(0,10)`, save `new Date(value).toISOString()`
  or null — consistent types/idiom with the upload page.
