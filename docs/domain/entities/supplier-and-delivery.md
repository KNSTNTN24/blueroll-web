# Supplier (`suppliers`) and Delivery (`deliveries`)

> A **supplier** is a company on the kitchen's approved list (who they are, how to reach them, which days they deliver).
> A **delivery** is one goods-in check at the back door: who brought it, when, the probe temperature, notes and photos.

**Tables:** `suppliers`, `deliveries`, `delivery_photos` · **Storage:** bucket `documents`, folder `{business_id}/delivery-photos/` ·
**Edge function:** `search-supplier-brands` · **Scope:** suppliers business-wide (optional `site_id`), deliveries per site ·
**Last verified:** 2026-10-13 (review pass) against `main@b50e9d1` and the live DB (49 suppliers in 9 businesses, 170 deliveries, 9 photos)

## What it is for

Inspectors ask "where does your food come from and how do you check it arrives safe?". The supplier list answers the
first half and feeds the HACCP Pack (`sup_list`, `sf_delivery_schedule`); deliveries answer the second half and are the
"Delivery checks" proof in the HACCP Plan. No spec page exists for either; history is in commits (see History).

## Parameters

**Supplier** (`suppliers`; also `id`, `business_id`, `created_at`)

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Supplier name | `name` | Company name; also the Brandfetch search text. | text, required | DB `NOT NULL`; UI requires non-blank |
| Goods supplied | `goods_supplied` | Free text, shown as the row subline. | text | — |
| Contact name, Phone, Email, Address, Website | `contact_name`, `phone`, `email`, `address`, `website` | How to reach them. Name/contact/phone/email go into the pack's `sup_list`. | text | — (no format checks). Mobile edits only name, contact, phone, goods (Gotcha 6) |
| Notes | `notes` | e.g. "min order £150"; shown after goods in the web subline. | text | — (`20260708120000_suppliers_notes.sql`) |
| Delivery days | `delivery_days` | Weekdays they deliver. Feeds `sf_delivery_schedule`. | canonical `Mon`…`Sun` | DB `NOT NULL DEFAULT '{}'`, no value `CHECK`; code constant `DAYS` (`suppliers/page.tsx:40`) — Known drift, Gotcha 1 |
| Site | `site_id` | Null = all sites. Set only by the dead `copy_kitchen` RPC / multisite migration; no UI writes or reads it. | uuid or null | FK `ON DELETE CASCADE`; RLS ignores it (Gotcha 5) |
| Logo | `logo_url` | Brandfetch CDN image; when null, coloured initials (`src/components/supplier-logo.tsx:54-59`). | `https://…`, ≤ 2048 chars | DB `suppliers_logo_url_check` |
| — | `logo_domain` | Brand domain picked (e.g. `brakes.co.uk`); fills Website on web if empty. | ≤ 253 chars | DB `suppliers_logo_domain_check` |
| — | `logo_source` | Where the logo came from. | `brandfetch`, `manual`, null | DB `suppliers_logo_source_check`. **Nothing writes `manual`** |
| — | `logo_verified` | User confirmed the brand. Web sets true on pick; mobile never sets it. Read by nothing. | bool, default false | — |
| — | `logo_updated_at` | Web stamps it on every save that has a logo (even unchanged), nulls it otherwise; mobile never sets it. | timestamp | — |

**Delivery** (`deliveries`; also `id`, `business_id`, `created_at`)

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Supplier | `supplier_id` | Who delivered. | supplier id | FK `ON DELETE SET NULL`; required by both UIs |
| Received by | `received_by` | Member who logged it. | profile id | FK `ON DELETE SET NULL` |
| Date & time | `received_at` | When it arrived. Web slide-over: "now" at panel open, not editable; mobile: DB default `now()`; legacy web `/deliveries/new` has a picker. | timestamp | DB default `now()` |
| Temperature | `product_temperature` | Probe reading in °C. Empty = ambient / not probed. | numeric or null | — (no range check; live min −19, max 45) |
| Notes | `notes` | Free text (condition, rejected items, docket no.). | text | — |
| Site | `site_id` | Site that received it. | uuid | trigger `trg_site_id_default` fills null with `get_my_site_id()`; RLS `can_see_site_row`; FK `ON DELETE CASCADE` |

**Photos** (`delivery_photos`): `delivery_id` (FK `ON DELETE CASCADE`), `photo_url` = **storage path** (not a URL)
`{business_id}/delivery-photos/{ms}_{i}_{name}` (web, name sanitised) or `{ms}_{name}` (mobile), `file_name`, `created_at`.
Shown through 3600 s signed URLs (`deliveries/page.tsx:395,409`).

**How temperature is judged** — there is no stored verdict, flag, or notification; each place recomputes:

| Where | Rule | Location |
|---|---|---|
| Web list badge | ≤ 5 green, ≤ 8 amber, > 8 red; header counts "> 5" as breaches | `deliveries/page.tsx:28-32,78` |
| Web form hint | > 5 → "Above 5°C for chilled goods — check and consider rejecting" | `deliveries/page.tsx:134-135,248` |
| Mobile badge | same 5 / 8 bands | `haccp-mobile/lib/features/ops/ops_meta.dart:51-55` |
| Mobile list badge | `deliveryStatus()`: ≤ 8 "Accepted" | `ops_meta.dart:4,35-39`, used at `deliveries_tab.dart:995` |
| Mobile verdict | ≤ −15 "OK · frozen", ≤ 5 "OK to accept", else "Above 5°C — check" | `features/ops/deliveries_tab.dart:410-417` |
| HACCP Plan proof | reading ≤ −5 is *guessed* frozen and fails above −15; otherwise fails above 5 | `supabase/functions/_shared/haccp-plan/load.ts:15,159-165`, `aggregate.ts:33-34,108-124` |

For reference, SFBB: 8 °C is the legal maximum for chilled food, 5 °C or below is recommended; frozen food should be
−18 °C. The app's −15 °C for frozen is house policy, not SFBB.

### Known drift (live data, 2026-10-13)

- `delivery_days`: `Wed` 35, `Tue` 31, `Thu` 31, `Mon` 30, `Fri` 30, `Sat` 20, `Sun` 9, **`monday`, `tuesday`, `wednesday`,
  `thursday`, `friday`, `saturday` 1 each** (3 suppliers, 1 business). No code in either repo writes lowercase full names
  (manual/SQL insert). Web day chips match only `Mon`…`Sun`, so these suppliers show no days on web; mobile and the pack print them raw.
- `suppliers.site_id`: 41 null, 8 set. 3 suppliers have no delivery days. Logos: 17 (all `brandfetch`; 11 verified, 6 unverified = mobile-picked).
- `deliveries`: 1 with `supplier_id` null (supplier deleted), 1 with `received_by` null, 11 without temperature, all have `site_id`.
  8 readings below −15, 3 above 5, 2 above 8. `notifications` type `delivery`: 1 row, written by no code.

## Lifecycle

**Supplier created / edited by:** web `/suppliers` slide-over (`src/app/(dashboard)/suppliers/page.tsx:106-122`, all fields);
mobile Ops → Suppliers sheet (`haccp-mobile/lib/features/ops/suppliers_tab.dart:307-337`, name/contact/phone/goods/logo only).
Neither sets `site_id`. Mobile `screens/suppliers/suppliers_screen.dart` still has an older form with days and address, but
`/suppliers` routes to the new `SuppliersScreen` in `suppliers_tab.dart:570-574`; only its `suppliersProvider` is live.
`copy_kitchen(from_site, to_site)` (live RPC, `20260713130000_supplier_branding.sql`) copies suppliers to a site — called by no code.

**Logo (Brandfetch):** "Find logo" sends the name (2–100 chars) to `search-supplier-brands`, which checks the bearer token
and that the caller has a `business_id` (no capability check), calls Brandfetch search with `BRANDFETCH_CLIENT_ID`
(8 s timeout), keeps results with an `https://` icon, rewrites the icon to a 256×128 logo URL, returns at most 6
(`supabase/functions/search-supplier-brands/index.ts:42-97`). The user picks one; nothing is uploaded — the row keeps a hot-link
to `cdn.brandfetch.io`. No secret → 503; Brandfetch 429 is passed through; no per-user rate limit. Picking the wrong brand
is the user's call ("Choose the correct company"); `claimed` shows a "Verified" pill.

**Delivery created / edited by:** web `/deliveries` slide-over (`deliveries/page.tsx:89-125`: site, supplier, temperature,
photos, notes); mobile Ops → Deliveries sheet (`deliveries_tab.dart:474-530`, also via `/deliveries/new` deep link and the
dashboard quick action); legacy web `/deliveries/new` (`deliveries/new/page.tsx:45-52`, with time picker, no photos, no site —
reached from the command palette). Photos: file uploaded to storage first, then a `delivery_photos` row.
Editing changes site (web only), supplier, temperature, notes and photos — never `received_at` or `received_by`.

**Deleted:**
- Supplier → its deliveries stay with `supplier_id` null (FK `SET NULL`); mobile says "Past deliveries keep their records",
  web lists them as "Supplier". The pack/Plan just lose the line.
- Delivery → `delivery_photos` rows cascade, **storage files are not removed** (web `deliveries/page.tsx:128-131`, mobile `deliveries_tab.dart:957-975`).
  Removing one photo while editing deletes the file on web, but only the row on mobile (`deliveries_tab.dart:502-507`).
- Site hard-delete cascades its deliveries and site-tagged suppliers. Business purge deletes everything and the bucket folder.
- Demo business: `demo_clone_day` copies deliveries forward; `demo_daily_refresh` drops those older than 45 days without photos.

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See suppliers | any member of the business (all sites) | RLS `Business members can view suppliers`; `demo_read` |
| Add / edit / delete supplier | `manage_suppliers` (Owner, Manager presets); add/edit also needs entitlement | RLS `Managers can manage suppliers` (ALL), restrictive `entitlement_write_gate_ins/upd` |
| UI for suppliers | buttons shown to tier owner/manager, not by capability | web `suppliers/page.tsx:65,177,218`; mobile `suppliers_tab.dart:40` |
| See / log / edit / delete delivery | any member who can see the delivery's site; insert/update need entitlement. **`manage_deliveries` is not checked anywhere** | RLS `Users can … deliveries in their business` (`can_see_site_row`); no UI gate on either platform |
| Photos | any member of the business (no site check) | RLS on `delivery_photos`; storage policies of the `documents` bucket (see [Document](document.md)) |

## Related

- **HACCP Pack** — auto-fill (`src/lib/haccp-pack/auto-data.ts:191-201`, mobile `providers/haccp_autofill_provider.dart:88-99`):
  `sup_list` = one line per supplier "Name (contact) — phone — email" (mobile: no email); `sf_delivery_schedule` = "Name: Mon, Thu".
  Both read **all** business suppliers, ignoring `site_id`. `sup_file` ("Upload supplier list") is hidden on web as covered
  when at least one supplier exists — "Your suppliers are listed in Blueroll." (`src/lib/haccp-pack/scope.ts:63`); mobile has no such rule.
- **HACCP Plan** — the *Suppliers* method shows the pack answers above plus a "Delivery checks" proof from the last 28 days of
  the site's deliveries: count, out-of-range, % accepted (`src/lib/haccp-plan/proof-map.ts:26-27,37-45`); `stock_control` reuses it.
- **Set up my HACCP** — the suppliers data step lists them and links to `/suppliers` (`src/app/(dashboard)/haccp-setup/data-steps.tsx:17,30-42`).
- **Entities:** [Business](business.md), [Site](site.md), [Member](member.md), [Document](document.md) (shared bucket).
  **Concepts:** [Roles and capabilities](../concepts/roles-and-capabilities.md), [Subscription and entitlement](../concepts/subscription-and-entitlement.md).

## Where in code

| Area | Location |
|---|---|
| Web pages | `src/app/(dashboard)/suppliers/page.tsx`, `deliveries/page.tsx`, legacy `deliveries/new/page.tsx`; `src/components/supplier-logo.tsx` |
| Shared | `src/lib/haccp-pack/{auto-data,scope,methods}.ts`, `src/lib/haccp-plan/proof-map.ts`, `src/lib/permissions.ts` |
| Mobile | `haccp-mobile/lib/features/ops/{suppliers_tab,deliveries_tab,ops_meta,supplier_logo}.dart`, `providers/ops_provider.dart:41-52`, `models/{supplier,delivery}.dart` |
| Edge / DB | `search-supplier-brands`; `_shared/haccp-plan/{load,aggregate}.ts`; trigger `trg_site_id_default`; RPC `copy_kitchen`; `demo_clone_day`, `demo_daily_refresh` |

## Gotchas

1. **Web cannot save a supplier without delivery days.** The save sends `delivery_days: null` when no day is ticked
   (`suppliers/page.tsx:115`), but the column is `NOT NULL` — the insert/update fails with a not-null error toast. Mobile omits the field, so it gets `{}`. [#92](https://github.com/KNSTNTN24/blueroll-web/issues/92)
2. **Day spelling is not enforced.** Canonical `Mon`…`Sun`, no `CHECK`; 3 live suppliers use `monday`… and look empty on web. [#60](https://github.com/KNSTNTN24/blueroll-web/issues/60)
3. **Temperature has no stored verdict and four rules.** Web/mobile badges treat everything ≤ 5 as OK; the mobile list
   badge `deliveryStatus()` says "Accepted" up to 8 °C; the mobile verdict knows frozen (≤ −15); the Plan guesses "frozen"
   from ≤ −5 and so marks −10 °C as out of range while the app said "OK to accept".
   Nothing records accept/reject, nothing sends a `delivery` notification (the type exists only for display), and `manage_deliveries` gates nothing.
   [#93](https://github.com/KNSTNTN24/blueroll-web/issues/93) [#102](https://github.com/KNSTNTN24/blueroll-web/issues/102)
4. **Web `sf_delivery_schedule` lists suppliers with no days** as "Name: " — the filter `s.delivery_days` is true for `[]` (`auto-data.ts:198`); mobile filters non-empty. [#92](https://github.com/KNSTNTN24/blueroll-web/issues/92)
5. **`suppliers.site_id` is decorative.** No UI writes or filters it, RLS ignores it, pack and Plan read every supplier
   of the business. Yet a site hard-delete cascades and deletes those 8 site-tagged suppliers.
6. **Mobile is a reduced editor:** no email, address, website, notes or delivery days; removing a logo leaves `logo_source='brandfetch'`;
   never sets `logo_verified`/`logo_updated_at`. Editing on mobile keeps the hidden fields (they are not in the payload). [#92](https://github.com/KNSTNTN24/blueroll-web/issues/92)
7. **Delivery deletion leaks files**: photo objects stay in `documents/{business}/delivery-photos/` after a delivery is deleted
   (both platforms) or a photo is removed on mobile. Business purge is the only cleanup. [#93](https://github.com/KNSTNTN24/blueroll-web/issues/93)
8. **UI checks tier, DB checks capability** for suppliers: a custom role with `manage_suppliers` but a staff tier sees no buttons;
   a manager-tier role without it sees buttons that fail. [#55](https://github.com/KNSTNTN24/blueroll-web/issues/55)
9. **Delivery time cannot be corrected** on the main web form or mobile (always "now"); only the legacy, half-hidden
   `/deliveries/new` allows backdating — and it skips photos and the site picker (trigger picks the user's primary site).
10. **Logos are hot-linked** to `cdn.brandfetch.io` with the client id in the URL; if Brandfetch drops the image the UI falls
    back to initials, but the row keeps the dead URL. Any member, even without `manage_suppliers`, can call the search function. [#92](https://github.com/KNSTNTN24/blueroll-web/issues/92)
11. `delivery_photos` RLS checks only the business, not the site — a site-limited member can read other sites' photo rows directly.
12. `suppliers`, `deliveries`, `delivery_photos` creation is not in `supabase/migrations` beyond `001_initial_schema.sql` (no
    `deliveries`/`delivery_photos` DDL at all). [#59](https://github.com/KNSTNTN24/blueroll-web/issues/59)

## History

- 2026-10 HACCP Plan "Delivery checks" proof; *Set up my HACCP* suppliers step.
- 2026-07-13 supplier branding: email, website, logo columns + `search-supplier-brands` (`20260713130000_supplier_branding.sql`); logos on deliveries (`cfe21f9`, `d54fc9e`).
- 2026-07-08 suppliers redesign with notes (`9e52a3f`, `20260708120000_suppliers_notes.sql`).
- 2026-07-07 multisite: `site_id` on both tables, deliveries site-scoped in RLS.
- Deliveries redesign, edit/delete, real photo upload, read-only view (`e99054b`, `77b7315`, `30f9ef8`, `2863491`).
