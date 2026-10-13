# HACCP Plan (`haccp_plan_shares`, `haccp_signoffs`)

> The inspector-ready document: the site's HACCP Pack answers laid out as the 26 SFBB safe methods, each with
> 28 days of real Blueroll records as proof, ready to show on screen, send as a link or download as a PDF.

**Tables:** `haccp_plan_shares` (inspector links and PDF tokens), `haccp_signoffs` (one sign-off per site); reads
`haccp_pack_data` and most operational tables · **Scope:** site · **Last verified:** 2026-10-13 (review pass) against
`main@b50e9d1` and the live DB (4 share rows, 9 sign-offs)

## What it is for

The [HACCP Pack](haccp-pack.md) is a form; the Plan is the document an EHO reads. It is **never stored**: every view
recomputes it from the pack, auto-fill and the last 28 days of records. One renderer (`PlanDocument`,
`src/components/haccp-plan/PlanDocument.tsx:7-16`) serves three surfaces: the in-app page `/haccp-pack/document`, the
public link `/plan/<token>`, and a server PDF. Spec: `docs/superpowers/specs/2026-10-11-haccp-plan-document-design.md`.

## How a Plan is built

1. **Load** — edge function `haccp-plan` (`supabase/functions/haccp-plan/index.ts`) authorises the caller
   (`handler.ts:52-83`) and runs `loadBundle` (`_shared/haccp-plan/load.ts:37-172`) with the **service role**.
2. **Build** — the browser runs pure `buildPlan(bundle)` (`src/lib/haccp-plan/build.ts:47-184`) → `PlanDoc`.
3. **Render** — `PlanDocument` in `screen` or `print` mode.

### Sections and where each number comes from

| Part | Content | Source |
|---|---|---|
| Cover (`pages.tsx:26`) | business, site, address (site first, then business), FSA rating, operator, site manager, % per section, sign-off, next review, QR (inspector link only) | `businesses`, `sites`; operator = first active `owner` profile; site manager = `sites.manager_id` (`load.ts:127-128`) |
| At a glance (`pages.tsx:119`) | **Plan complete %** = filled ÷ asked fields (`build.ts:52-112`); **Days recorded /28** = days with any completion on any template (`build.ts:129-130`); **Out-of-range readings** = flagged responses, *N corrected* = `corrective_status='done'`; **Training documents** = documents with category `training`/`certificate` (`build.ts:133`); people; open points | below |
| 26 method pages (`MethodPage.tsx:65`) | ref `s.m` (`copy.ts:42-48`), Safety point / Why? (static `METHOD_COPY`, FSA SFBB under OGL v3, `copy.ts:12-39`), infographic, *What we do*, attached documents, *Prove it* | pack + auto-fill; proof below |
| Corrective actions (`pages.tsx:191`) | newest 20 flagged responses in the period: template, item, value, notes, status, who | `buildCorrective` (`scope.ts:39-59`) |
| Review & sign-off (`pages.tsx:230`) | last 4-weekly review, next due (+28 days), sign-off, "edited after sign-off", OGL line | `haccp_signoffs`, review completions |

**Not used:** incidents, notifications, `haccp_setup_sessions`.

**What we do** (per field the pack still asks — the same scope rule as the pack, `build.ts:50,61`): checked toggles become
tick bullets; a text/select shows the **manual value if non-blank, else the auto-fill value** when auto-fill is on, the
field has `autoSource` and is not overridden, labelled "From your …" (`answerFor`, `build.ts:38-45`). File fields show the
document title from the web `{"id","title"}` value (`parseFileRef`, `build.ts:13-22`), including files the pack no
longer asks for (`:69-73`). Method status: all toggles ticked → *In place*, none → *open*, else *partial*; methods
without toggles use the other fields (`build.ts:93-97`).

**Prove it** maps each method to checklist templates by `library_key`, `sfbb_section` or a name regex
(`src/lib/haccp-plan/proof-map.ts:11-29`): e.g. `chilled_storage` ← `fridge_temps`/section `temperature`/`/fridge|freezer|chiller/`;
`suppliers` and `stock_control` ← deliveries; `daily_diary` ← every template. Methods with no rule (personal hygiene,
cloths, …) or no matching template show "No records linked yet". Stats: records, out-of-range (with corrected), initials (max 4).

### Period aggregation (`_shared/haccp-plan/aggregate.ts`)

- **Period** = the 28 site-local dates ending **yesterday** (`periodFor`, `:47-54`), in `sites.timezone` (default
  `Europe/London`). Rows are fetched with a ±1–2 day UTC margin and bucketed by local date (`load.ts:53-55`).
- **Templates**: active templates of the business that are business-wide or on this site (`load.ts:84`); completions
  and `checklist_instances` filtered by `site_id`. A day is `flagged` > `corrected` > `ok` > `missed` > `none`
  (`:61-64`): any completion = ok; a flagged response without `corrective_status='done'` = flagged; an instance with
  `status='missed'` = missed. `readings` counts `temperature` items; initials from `completed_by`'s name.
- **Deliveries** (`:108-125`): out of range if chilled > 5 °C or frozen > −15 °C. There is no frozen flag: a reading
  ≤ −5 °C is treated as frozen (`load.ts:15,163`).
- **Last review**: newest completion of a template with `library_key='haccp_review'` or name `/4.?weekly|haccp review/`
  (any date), else `businesses.haccp_last_reviewed_at` (`load.ts:117-125`, `build.ts:123-126`).

### What the bundle may carry (`scope.ts`)

The link is anonymous, so only "everyone may see" data goes in: documents with `access_level` null or `all`
(`planDocuments`, `:9-13`) and owners/managers by name (`planTeam`, `:15-17`; removed members are excluded by
`load.ts:81`). Auto-fill in the Plan therefore runs on these filtered lists.

## Parameters

**`haccp_plan_shares`** (`20261012120000_haccp_plan_shares.sql`; live matches)

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| — | `kind` | `inspector` = shareable link; `pdf` = one-off token for the PDF renderer | `inspector`, `pdf` | DB `CHECK` |
| — | `token_hash` | sha256 hex of a 32-byte base64url token (43 chars). The token itself is shown once and **never stored** | 64 hex chars, unique | DB `CHECK` + `UNIQUE`; token made in `share.ts:7-12` |
| Label | `label` | e.g. "EHO visit 14 Oct" | ≤ 80 chars | DB `CHECK`; UI `maxLength=80` |
| Expires | `expires_at` | Inspector: 1, 7 (default) or 30 days; pdf: 10 min | inspector ≤ now+30 d (manager only); pdf ≤ now+15 min | RLS `haccp_plan_shares_insert`; TTLs `share.ts:5` |
| Revoke | `revoked_at` | Set by "Revoke" in the share dialog | timestamp | RLS `haccp_plan_shares_revoke` + trigger `haccp_plan_shares_guard` (members may change only this column) |
| Views | `view_count`, `last_viewed_at` | Bumped by the edge function on every non-check load (read-then-write, not atomic, `index.ts:45-49`) | — | service role only |
| Site / business / creator | `site_id`, `business_id`, `created_by` | Which plan; null site = business without sites | — | FKs all `ON DELETE CASCADE` |

`id`, `created_at` also exist. No delete policy: rows are never deleted except by cascade.

**`haccp_signoffs`**: `business_id`, `site_id` (NOT NULL, `UNIQUE (business_id, site_id)`), `signed_by` (FK `ON DELETE SET
NULL`), `signed_by_name` (text copy shown on the Plan), `signed_at` (default now), `id`.

### Known drift (live data, 2026-10-13)

- Shares: 2 `inspector` (1 revoked and also expired, 3 views; 1 live, 7-day, 1 view), 2 `pdf` (expired); all have a `site_id`.
- Sign-offs: 9 rows in 2 businesses; **5 have `signed_by` null** and date from 2026-06-18, before the table's migration
  (2026-07-07) — seeded/manual rows; **5 are on sites with no pack row** (signed off an empty plan); 1 site's pack was
  edited after its sign-off.
- `checklist_responses` with `flagged=true`: 561 have `corrective_status` null, 5 `done`, none `needed` — so nearly every
  out-of-range reading shows as "not corrected".
- 1 live template has `library_key='haccp_review'` (inactive). The name regex matches 21 templates in 8 businesses
  (4 active). Two pack-owning businesses have review completions (last 2026-09-28 and 2026-10-02), so their Plan review
  is not overdue. Only the pack page (which reads `haccp_last_reviewed_at`) always says "Never reviewed".

## Lifecycle

- **View in app**: `/haccp-pack/document` (`src/app/(dashboard)/haccp-pack/document/page.tsx`), linked from the pack
  page (`haccp-pack/page.tsx:548`). Calls the function with `POST {site_id}` + the user's JWT (`api.ts:7-11`). Uses the
  pack page's site (`currentSiteId`, or the only site); on "All sites" with >1 site it shows "Pick a site" (`page.tsx:28-29,78-82`).
- **Inspector link**: `ShareDialog` → `createShare({kind:'inspector'})` inserts the hash and shows `…/plan/<token>` once;
  the dialog lists live links for this site and revokes them (`share.ts:23-74`). `/plan/[token]` (`src/app/plan/[token]/page.tsx`)
  fetches `GET ?t=` with the anon key, renders read-only, offers "Download PDF" and shows a QR back to itself
  (inspector kind only, `:50`). Layout is `noindex`, `no-referrer` (`src/app/plan/layout.tsx`); responses are `no-store`.
  Expired, revoked or unknown → 404 → "This link has expired or was withdrawn".
- **PDF**: in app, "Download PDF" creates a 10-minute `pdf` share and fetches `/api/haccp-plan/pdf?t=` (`document/page.tsx:46-64`).
  The route (`src/app/api/haccp-plan/pdf/route.ts`, Node runtime, `maxDuration 60`) pre-checks the token with `?check=1`
  (no view counted), throttles one render per token per 15 s per instance, then `renderPlanPdf` (`src/lib/haccp-plan/pdf.ts:43-80`)
  launches `puppeteer-core` with `@sparticuz/chromium` (or `CHROME_EXECUTABLE_PATH` locally), opens
  `/plan/<token>?print=1`, waits for `data-plan-state="ready"` (fonts loaded), prints A4 with a footer "… — HACCP Plan · Page X of Y".
  `next.config.ts` lists both packages in `serverExternalPackages` and adds `node_modules/@sparticuz/chromium/bin/**` via
  `outputFileTracingIncludes`, since the Chromium archive is read from disk. A `pdf` token serves at most 3 loads
  (`PDF_MAX_LOADS`, `handler.ts:7,65`). Errors: 404 bad token, 429 throttled, 502 upstream, 504 timeout (25 s), 500.
- **Sign-off**: "Sign off" / "Sign again" upserts `haccp_signoffs` for the site (`api.ts:26-32`). Also from the pack
  page badge (multi-site only, **insert**, `site-signoff.tsx:40-48`) and mobile (upsert, `haccp_provider.dart:124-138`).
  The Plan shows *Draft — not signed off* or *Edited after sign-off* when `pack.updated_at` > `signed_at` + 60 s (`build.ts:115-122`).
  *Inspection-ready* = ≥ 90 % complete and signed off and not edited after (`build.ts:176`).

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| View in app | active member of a non-deleted business who can see the site (group admin or no `member_sites` rows = all sites); null-site plan only for those who see all sites | `decideAccess` (`handler.ts:26-38`), `memberAccess` (`index.ts:54-67`) — not RLS |
| Download PDF | any member who can view (pdf share insert) | RLS `haccp_plan_shares_insert` |
| Create inspector link | `profiles.role` in `owner`/`manager` (legacy tier text, not capabilities) | RLS via `is_active_business_manager`; UI `viewer.canManage` = same role test (`handler.ts:32`) |
| List / revoke links | list: member who can see the site; revoke: owner/manager | RLS `haccp_plan_shares_select`, `_revoke`, trigger guard |
| Open a link | anyone with the token until expiry/revoke | edge function, service role |
| Sign off | owner/manager of an entitled business, site visible | RLS `haccp_signoffs_write` + restrictive `_manager_*`, `entitlement_write_gate_*` |

## Related

- [HACCP Pack](haccp-pack.md) — the answers, auto-fill and scope rule the Plan renders (short Plan summary there).
- [Checklist completion](checklist-completion.md) (proof, corrective, missed), [Checklist template](checklist-template.md)
  (proof mapping), [Supplier and delivery](supplier-and-delivery.md), [Document](document.md), [Menu](menu.md) (allergen
  matrix), [Recipe](recipe.md), [Site](site.md), [Member](member.md), [Roles and capabilities](../concepts/roles-and-capabilities.md).

## Where in code

| Area | Location |
|---|---|
| Web pages | `src/app/(dashboard)/haccp-pack/document/page.tsx`, `src/app/plan/[token]/`, `src/app/api/haccp-plan/pdf/route.ts` |
| Shared logic | `src/lib/haccp-plan/` (`build`, `copy`, `proof-map`, `share`, `pdf`, `api`, `types`, `qr`, `fixtures` for tests) |
| Components | `src/components/haccp-plan/` (`PlanDocument`, `pages`, `MethodPage`, `infographics`, `ShareDialog`, `PresentOverlay`, `SectionChips`, `plan.css`) |
| Edge function | `supabase/functions/haccp-plan/index.ts`; `_shared/haccp-plan/{handler,load,scope,aggregate}.ts` (+ deno tests) |
| Mobile | none for the Plan; sign-off only (`haccp-mobile/lib/providers/haccp_provider.dart`) |
| DB objects | `haccp_plan_shares` + `haccp_plan_shares_guard`, `haccp_signoffs`, `is_active_business_manager`, `can_see_site_row` |

## Gotchas

1. **The edge function bypasses RLS.** Access is re-implemented in `decideAccess`; it does not check entitlement, so
   a lapsed business's members and old inspector links still get the full Plan. `haccp_plan_shares` has no
   `entitlement_write_gate`, so links can be created too. [#96](https://github.com/KNSTNTN24/blueroll-web/issues/96)
2. **"Manager" means `profiles.role` text**, not capabilities: a custom role with HACCP rights cannot share or sign; an
   owner-tier person always can ([#55](https://github.com/KNSTNTN24/blueroll-web/issues/55)).
3. **Plan ≠ pack page.** The Plan prefers typed text over auto-fill, the pack page the opposite; the Plan's auto-fill
   sees only `all` documents and current owners/managers; the pack page sees all documents and removed members. Recipes,
   suppliers and documents are business-wide in both — not per site.
4. **Sign-off is never invalidated**, only flagged "edited after"; web badge inserts, Plan and mobile upsert ([#86](https://github.com/KNSTNTN24/blueroll-web/issues/86)). Sites without a pack can be signed.
5. **Revoke is reversible.** The guard lets a manager set `revoked_at` back to null; the UI never does. [#96](https://github.com/KNSTNTN24/blueroll-web/issues/96)
6. **Inspector views include PDF renders**: the inspector page's Download PDF renders the same token, so `view_count`
   counts Chromium loads too. The in-app PDF never has a QR, even when an inspector link exists. [#96](https://github.com/KNSTNTN24/blueroll-web/issues/96)
7. **Frozen deliveries are guessed** (≤ −5 °C); a chilled product at −3 °C is "in range", a −10 °C frozen one is flagged.
8. **"Missed" days come from `checklist_instances`** and inherit its definition ([#58](https://github.com/KNSTNTN24/blueroll-web/issues/58));
   "N corrected" is almost always 0 because `corrective_status` is rarely set (see drift).
9. **CORS**: only `https://app.blueroll.app`, `http://localhost:3001` and `PLAN_EXTRA_ORIGINS` (`index.ts:13-17`); Vercel
   previews need the env var. Preview PDFs need `VERCEL_AUTOMATION_BYPASS_SECRET`; `PLAN_RENDER_ORIGIN` overrides the origin.
10. The spec, [HACCP Pack](haccp-pack.md) and the code (`share.ts:5`) all say the PDF token lives **10 min**; only RLS
    allows up to 15.
11. No Plan on mobile; no Plan for "All sites"; businesses without sites (3 live) get a null-site Plan with no sign-off.
12. `fetchAll` pages without `.order()` on several queries (`load.ts:70-103`), so >1000-row results could skip or repeat rows.
13. **The PDF route accepts any valid token kind.** An inspector link can trigger a 25 s Chromium render every 15 s;
    `PDF_MAX_LOADS` caps the `pdf` kind only.
14. **A deleted business gives 500, not 404**: `loadBundle` throws on it.
15. **Plan tokens are in URLs**, so they appear in request logs. "Never stored" is true for the database only (it keeps
    the hash).

## History

- 2026-10-12 `haccp_plan_shares`, restrictive manager-only sign-off policies (`20261012120000_haccp_plan_shares.sql`).
- 2026-10-11 HACCP Plan document: in-app view, inspector link, server PDF (`2026-10-11-haccp-plan-document-design.md`);
  replaced the pack page's plain HTML export.
- 2026-07-07 `haccp_signoffs` per site (`20260707184025_haccp_signoffs.sql`).
