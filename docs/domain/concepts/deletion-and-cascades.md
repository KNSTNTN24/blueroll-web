# Deletion and cascades

> What "delete", "remove", "deactivate" and "archive" really do for each thing in Blueroll, and which other rows and
> files go with it. Most deletes are **hard** and **cascade**; only businesses, sites and members have a soft delete.

**Touches:** [Business](../entities/business.md), [Site](../entities/site.md), [Member](../entities/member.md),
[Checklist template](../entities/checklist-template.md), [Checklist completion](../entities/checklist-completion.md),
[Recipe](../entities/recipe.md), [Menu](../entities/menu.md), [Supplier & delivery](../entities/supplier-and-delivery.md),
[Document](../entities/document.md), [Incident](../entities/incident-and-notification.md) ·
**Last verified:** 2026-10-13 against `main@3d6f5b6` and the live DB (133 foreign keys in `public`)

## The rule in plain words

```
soft delete  = a column hides the row; nothing else changes       (business, site, member, template "off", share link)
hard delete  = DELETE ... and Postgres follows every FK:
                 CASCADE  → child rows deleted too (repeats down the chain)
                 SET NULL → child row kept, link blanked (who/what is lost)
                 NO ACTION / RESTRICT → the whole DELETE fails
storage      = never follows a row. Files go only if code calls storage.remove() (or the business purge).
```

Postgres FK actions are the real behaviour (live `pg_constraint.confdeltype`); UI copy like "records kept" is not.
The entitlement gate blocks only INSERT/UPDATE (`entitlement_write_gate_ins/_upd`), so a business that stopped paying
can still delete. Food-safety records are **inspection evidence**: SFBB says it is a legal requirement to keep a record
of what food you bought and who from (`knowledge-sfbb.ts`, id `sfbb-p6-2`, SFBB p.6). The "kept for 4 years" in the site
removal toast (`src/app/(dashboard)/settings/sites-settings.tsx:152-158`) is house policy, not SFBB, and nothing enforces it.

## Per entity

| Entity | Soft delete (column → who sets → what hides it) | Hard delete (who, from where) | Cascades (CASCADE) | Blanked (SET NULL) / blocked |
|---|---|---|---|---|
| Business `businesses` | `deleted_at` → edge `delete-account` only (owner by text role, mobile only, `profile_screen.dart:135,425`); trigger `protect_business_deleted_at` stops clients; `get_my_business_id()` returns null → RLS hides everything | cron → edge `purge-deleted-businesses` → `purge_deleted_businesses()` after **30 days**; no DELETE policy | all 34 FKs to `businesses` are CASCADE; purge deletes in FK order, then profiles **and `auth.users`** | `trial_grants`, `template_leads` have no FK — kept |
| Site `sites` | `status='removed'` + `removed_at` → web Settings → Sites (`sites-settings.tsx:155`, `manage_sites`); hidden from lists and channel teams (`src/lib/whatsapp/teams.ts:53`) — but still billed and scheduled (#74) | client DELETE allowed by RLS `sites_write` (`manage_sites`); used only by multi-site onboarding (web `onboarding/page.tsx:746`, mobile `auth_provider.dart:258-261`) | 25 FKs: templates→completions→responses, instances, deliveries→photos, documents→access, incidents, pack, sign-offs, setup sessions, plan shares, recipes (site-tagged), suppliers (site-tagged), member_sites, menu_categories, check-ins, channel rows | SET NULL: `profiles.site_id`, `invites.site_id`, `feedback_requests`, `channel_messages_log`. `menu_items.site_ids` is a uuid array — no FK, not cleaned |
| Member `profiles` | `removed_at` (+ `role_id`, `site_id` null) → RPC `remove_member`, **only** when the hard delete hits an FK error; mobile only (`team_tab.dart:625`); mobile list filters it (`ops_provider.dart:62`), RLS does not (#57) | `remove_member` **tries hard delete first**; channel signup rollback (`_shared/channels/members.ts:30-38`); purge; deleting the `auth.users` row (FK CASCADE) | documents they uploaded (#114) → document_access; `document_access`, `member_sites`, overrides, `notifications`, `staff_checkins`, `training_records.profile_id`, `checklist_drafts`, `haccp_plan_shares.created_by`, `feedback_requests`, channel identities/codes/members/tokens | SET NULL: `deliveries.received_by`, `haccp_signoffs.signed_by`, `menu_items.attested_by`, `sites.manager_id`, channel `linked_by`/`invited_by`/takes/log. **Blocks** (NO ACTION): completions `completed_by`/`signed_off_by`, incidents `reported_by`/`resolved_by`, `recipes.created_by`, `invites.invited_by`, `four_weekly_reviews`, `diary_entries.signed_by`, `document_access.granted_by`, `training_records.trained_by` |
| Checklist template | `active=false` → mobile switch (`checklists_screen.dart:533-536`); seeded defaults start `false` (`src/lib/seed-checklists.ts:94`). Live: 846 off / 592 on — "off" mixes *never switched on* and *retired* | mobile only (`checklist_detail_screen.dart:481-495`), RLS `manage_checklists` (#115) | items → **responses**; completions → responses; instances; drafts; channel flows/tokens/takes/reminders/group links | — |
| Template item | none | web and mobile **edit = delete all + re-insert** (`checklists/edit/[id]/page.tsx:183-188`, `checklist_manage_screen.dart:182-185`) | `checklist_responses.item_id` CASCADE → every past answer (#52) → `channel_form_tokens` | — |
| Completion | none | mobile only (`checklist_detail_screen.dart:1545-1553`); RLS: own completion, or `sign_off` | responses (photos stay in storage, #80) | `checklist_instances.completion_id` SET NULL; instance stays `completed` till the nightly cron (#80) |
| Recipe | `active=false` = greyed out only | web `recipes/page.tsx:95`, `recipes/[id]/page.tsx:112`; mobile `recipe_actions.dart:449-457`; `manage_recipes` | recipe_ingredients, recipe_sites, recipe_tags → trigger `cleanup_orphan_tag` deletes a tag with no recipes left | **RESTRICT** `menu_items.recipe_id`: both apps first convert linked dishes to hand-declared allergens |
| Dish `menu_items` | `active` exists, nothing sets it false (166 all true) | web `menu/page.tsx:124` when removed from its last site; mobile `kitchen_provider.dart:193` | none | — |
| Supplier | none | web `suppliers/page.tsx:125`, mobile `suppliers_tab.dart:297`; `manage_suppliers` | none | `deliveries.supplier_id` SET NULL — the delivery no longer says who supplied it (Gotcha 5) |
| Delivery | none | web `deliveries/page.tsx:129`, mobile `deliveries_tab.dart:966`; **any member** who sees the site | `delivery_photos` (files stay, #93) | — |
| Document | none | web `documents/page.tsx:89-90`, `documents/[id]/page.tsx:65-67`, mobile `documents_provider.dart:131-134`; RLS `view_documents` (#54) | `document_access` | file removed first, row second (#54) |
| Incident | `status` open/resolved is not a delete | **none works**: no DELETE policy; web `incidents/page.tsx:152` and mobile `ops_provider.dart:153` delete 0 rows and toast success (#87) | — | — |
| Role | none | web `members-roles.tsx:285`, mobile `team_tab.dart:1371-1374`; guard `guard_role_delete` blocks presets and assigned roles | — | `profiles.role_id`, `invites.role_id` SET NULL |
| HACCP Pack | none | RLS lets **any member** delete (#85); no UI does | — | — |
| Invite | `used_at` = consumed, not deleted | `remove_member` deletes **all** invites to that email, used ones too | — | — |
| Plan share link | `revoked_at` (`src/lib/haccp-plan/share.ts:72`) | none (purge, or creator's profile delete) | — | — |
| Channel team member | `status='removed'` + `removed_at` (`src/lib/whatsapp/teams.ts:103`); identities: `revoked_at` via trigger `trg_revoke_channel_identities` when a member is removed or moves business | — | — | — |
| Channel logs, codes | none | time-based cleanup in edge `whatsapp-reminders/index.ts:119-131`: used/expired codes >1 day, form tokens >2 days, reminders/takes/events >60 days, message log >1 year | — | — |

Live: 0 removed sites, 0 removed members, 1 business soft-deleted (2026-10-13). Setup sessions use `status='abandoned'`
(8), not a delete.

## Cascade map from the big roots

```
business ─(purge after 30 days)─► EVERYTHING below + profiles + auth.users      (storage: documents/ and videos/ under {business_id}/)
site ─► checklist_templates ─► checklist_template_items ─► checklist_responses ─► channel_form_tokens   (depth 4)
     │                      ├► checklist_completions ─► checklist_responses
     │                      └► instances, drafts, channel_flows/takes/reminders/group_checklists
     ├► checklist_completions, checklist_instances (site's own)   ├► deliveries ─► delivery_photos
     ├► documents ─► document_access                               ├► suppliers(site-tagged) ⇢ deliveries.supplier_id = NULL
     ├► recipes(site-tagged) ─► ingredients links, tags, recipe_sites   ✖ RESTRICT if a dish uses one → whole site delete fails
     └► incidents, haccp_pack_data, haccp_signoffs, setup sessions, plan shares, member_sites, menu_categories, staff_checkins, channel_groups ─► 6 child tables
profile ─► documents(uploaded_by) ─► document_access ; member_sites, overrides, notifications, staff_checkins,
           training_records, drafts, plan shares, feedback, channel rows        ✖ blocked by any completion/incident/recipe/invite they made
checklist template ─► items ─► responses ; completions ─► responses ; instances, drafts, channel rows
recipe ─► recipe_ingredients, recipe_sites, recipe_tags ─(trigger)─► orphan tags      ✖ RESTRICT from menu_items
supplier ⇢ deliveries.supplier_id = NULL                      document ─► document_access
```

## Files left in storage

Bucket `documents` holds everything, by path: `{business_id}/{ts}_{name}` (documents), `{business_id}/checklist-photos/…`
(photo answers, path inside `checklist_responses.value`), `{business_id}/delivery-photos/…` (`delivery_photos.photo_url`),
`{business_id}/avatars/…`. Bucket `videos`: `{business_id}/ai-import/…` (#116). Only document delete, web delivery-photo
edit (`deliveries/page.tsx:101-104`) and the business purge remove files. Live, 2026-10-13:

| Kind | Objects | Not referenced by any row |
|---|---|---|
| checklist photos | 515 | 47 (deleted completions / #52 responses) |
| document files | 155 | 18 (13 of them under 7 business ids that no longer exist) |
| delivery photos | 10 | 1 |
| avatars | 7 | 3 (replaced avatars) |
| videos | 4 | 4 |

And the reverse: 11 `documents` rows point to a missing file (6 demo seed paths `demo/…`, 5 real — #54 shape).
Storage DELETE is allowed only to owner/manager by **text role** (policies `storage_documents_delete`,
`documents_storage_delete_owner_manager`), so a chef's client could not clean files even if it tried.

## Where it is enforced

| Layer | What is checked | Location |
|---|---|---|
| Database | FK actions; DELETE policies per table (none on `businesses`, `profiles`, `incidents`, `checklist_responses`, `notifications`, `haccp_plan_shares`); guards `guard_role_delete`, `protect_business_deleted_at`; RPC `remove_member`, `purge_deleted_businesses` | live `pg_constraint`, `pg_policies` |
| Web UI | site soft delete; hard deletes listed above; no member removal, no business deletion | `src/app/(dashboard)/…` |
| Mobile | member removal, business deletion, template hard delete, completion delete | `haccp-mobile/lib/…` (origin/main) |
| Edge | `delete-account` (soft), `purge-deleted-businesses` (storage, then RPC), `whatsapp-reminders` (retention cleanup) | `supabase/functions/` |

## Gotchas

1. **`remove_member` hard-deletes first.** Soft removal is only the fallback on `foreign_key_violation`. A member with no
   completions, incidents, recipes or sent invites is deleted outright, and their uploaded documents, training records,
   check-ins and inspector share links cascade away (#114). `deliveries.received_by` and `haccp_signoffs.signed_by`
   go blank (sign-offs keep `signed_by_name`; deliveries keep no name).
2. **Editing a template deletes its history** (#52) and **deleting one deletes all of it** (#115). The only safe "remove" is
   `active=false`, mobile only; web has neither delete nor deactivate for templates.
3. **Site hard delete is a business wipe for that site** — 25 cascades including documents and site-tagged suppliers
   (#92). Only onboarding does it today, but RLS `sites_write` lets any `manage_sites` client do it. If a site-tagged recipe
   is on the menu, the RESTRICT on `menu_items.recipe_id` makes the whole delete fail instead.
4. **The purge is final and broad.** After 30 days it deletes every row, the members' logins (`auth.users`) and the
   storage folders. App-store subscriptions are not cancelled (#73). Storage is removed *before* the SQL purge; until the
   `guard_role_delete` fix (comment in the live function; not in any migration) the SQL step failed for every business after the files were gone.
5. **Deleting a supplier anonymises its deliveries.** Mobile says "Past deliveries keep their records"
   (`suppliers_tab.dart:292`), but `supplier_id` becomes null and `deliveries` has no supplier-name column, so the goods-in
   record no longer shows who supplied the food (1 live delivery already). That is the SFBB p.6 record.
6. **Some "deletes" do nothing.** Incidents (#87): no policy, 0 rows, success toast. Manager document delete removes the
   file and keeps the row (#54). Supabase returns no error when RLS filters a DELETE to 0 rows — check the row count.
7. **Unpaid businesses can still delete.** The entitlement gate covers INSERT/UPDATE only.
8. **Any member can hard-delete evidence** they can see: deliveries (no `manage_deliveries` check, #93), their own
   completions, the HACCP Pack (#85).
9. **Only the owner can delete an account, and it deletes the whole business.** A staff member has no way to delete their
   own login (`canDeleteBusiness(profile.role)`, `profile_screen.dart:425`; no web UI).
10. **Not every reference is an FK.** `menu_items.site_ids`, `checklist_templates.assigned_role_ids`, paths in
    `checklist_responses.value` and all storage paths are not cleaned by any cascade.

## Rule for developers

- **Records that are inspection evidence get a soft delete, never a hard one:** completions and responses, templates
  with history, deliveries, incidents, documents, sign-offs, training, sites, members. Hide with a column
  (`archived_at`/`removed_at`), keep the row.
- **Copy the "who/what" name onto evidence rows** (like `haccp_signoffs.signed_by_name`, `menu_items.attested_by_name`),
  so a SET NULL never erases it; reference evidence with `NO ACTION`/`RESTRICT`, not `CASCADE`.
- **Before adding a DELETE**, run the FK query in this page's *How to check* and read every CASCADE below the table;
  check the DELETE policy exists and the affected row count is > 0; remove storage files *after* the row delete succeeds;
  decide what happens to array/path references; update this page.

**How to check** (read-only): `select conrelid::regclass, confrelid::regclass, confdeltype from pg_constraint where
contype='f' and connamespace='public'::regnamespace` (`c` cascade, `n` set null, `a` no action, `r` restrict).

## History

- *(date unverified)* live `guard_role_delete` steps aside for deleted businesses so the purge can run (function comment).
  The repo version (`20260714150000_rbac_phase3_invites_and_guard.sql`) has no such check — live only (#59).
- 2026-07-13 site soft delete `removed_at` (`20260713110523_sites_soft_delete_removed_at.sql` is a placeholder, #59).
- 2026-07-12 account deletion: soft delete + 30-day purge + storage via edge (`docs/superpowers/specs/2026-07-12-account-deletion-design.md`, migrations `20260712140000`–`20260712170000`).
