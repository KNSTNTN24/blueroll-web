# Checklist template (`checklist_templates`)

> A reusable checklist — "Opening checks", "Fridge temperatures", "Weekly deep clean": a list of items, how often
> it must be done, who does it and who signs it off. Staff fill it in; each fill-in is a *completion*.

**Tables:** `checklist_templates`, `checklist_template_items` (items) · **Scope:** business, optionally one site ·
**Last verified:** 2026-10-13 against `main@b50e9d1` and the live DB (1,438 templates, 8,255 items)

## What it is for

Safer Food, Better Business (SFBB) asks a food business to prove it does its checks. A template describes one
recurring check; Blueroll turns it into "due" checks for every site, reminds people (app, WhatsApp, Telegram),
records who did it and what they found, and feeds the reports, the HACCP Pack and the HACCP Plan.

## Parameters

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Name, Description | `name`, `description` | What staff see. | text | — |
| Frequency | `frequency` | How often it must be done. Defines the *period* a completion counts for. | `daily`, `weekly`, `monthly`, `four_weekly`, `custom` | DB `CHECK`; TS `CHECKLIST_FREQUENCIES` `src/lib/constants.ts:33`. **Periods differ by layer — Gotcha 3** |
| Deadline | `deadline_time` | Time of day (HH:MM) it should be done by. Drives "Overdue" and channel reminders (from 30 min before). | `HH:MM` or null | nothing in DB; web compares with the *browser* clock (`src/lib/checklist-status.ts:20-26`), edge functions with `sites.timezone` (`supabase/functions/_shared/checklists-core/time.ts:49-55`) |
| Several times a day | `multi_per_day`, `min_per_day` | Counter model: done when today's completions ≥ `min_per_day`; `0` = optional. | bool; int ≥ 0 | DB `CHECK (min_per_day >= 0)`; `checklist-status.ts:33-38`, `_shared/checklists-core/due.ts:18-20` |
| Assigned to | `assigned_role_ids` (new), `assigned_roles` (legacy) | Which roles must do it. Ids of `roles` rows; the legacy column holds the same as tiers. | uuid[]; tier[] | nothing keeps them in sync except the web save (`checklists/new/page.tsx:257-261`) — Gotcha 4 |
| Sign-off by | `supervisor_role` | A tier whose holder must countersign each completion. Null = no sign-off. Drives "Awaiting sign-off". | tier or null | UI only, by tier (`checklists/[id]/page.tsx:30,54`) — not the `sign_off` capability |
| SFBB section | `sfbb_section` | Which part of SFBB it proves. Read by the HACCP Pack auto-fill and the HACCP Plan. | canonical: `cross`, `cleaning`, `chilling`, `cooking`, `management` (+ `temperature`, `probes` in the library) | nothing (free text) — see *Known drift* |
| Active | `active` | Soft on/off. Inactive templates are not shown, not scheduled, not sent to channels. History stays. | bool | lists, cron, channels all filter `active` |
| Site | `site_id` | Null = every site of the business; set = that site only. | uuid or null | RLS `can_see_site_row(site_id)`. **Trigger `trg_site_id_default` replaces a null with the creator's primary site** (`set_site_id_default` → `get_my_site_id()`), so only server-side inserts stay business-wide — Gotcha 6 |
| Default | `is_default` | Seeded at onboarding (inactive until switched on). Also the "already seeded" guard. | bool | onboarding code |
| Library key | `library_key` | Which checklist of the *Set up my HACCP* library it came from; one per (business, site, key). | key from `src/lib/haccp-setup/content/checklists.ts` or null | partial unique index (`20261006120000_haccp_setup.sql:51`) |

**Items** (`checklist_template_items`):

| Field | DB column | Meaning | Allowed values / rule |
|---|---|---|---|
| Name, Description | `name`, `description` | The question. Description is dropped by the web form and the AI path (Gotcha 9). | text |
| Type | `item_type` | `tick` (done), `temperature` (number, with range), `text`, `yes_no`, `photo`, `initials` (who did it, `^[A-Z0-9]{2,5}$`) | DB `CHECK`; labels `ITEM_TYPE_LABELS` `constants.ts:36-43` |
| Required | `required` | Must be answered to submit. | bool |
| Range | `min_value`, `max_value`, `unit` | For temperatures: an answer outside `[min, max]` (inclusive) is **flagged** (out of range). Unit defaults to `°C`. | numbers |
| Order | `sort_order` | Display order. | int |
| SFBB reference | `sfbb_reference` | Optional pointer into SFBB. | text |

### Known drift (live data, 2026-10-13)

- `sfbb_section`: `cleaning` 244, `chilling` 211, `cooking` 92, `management` 71, `general` 38, `cross_contamination` 38,
  `cross` 8, `training` 7, `probes` 2, `temperature` 1, null 726. Mobile writes `cross_contamination`/`general`/`training`
  (`haccp-mobile/lib/models/checklist.dart:94-128`), the library writes `cross`/`temperature`/`probes`, web writes nothing.
  **Canonical:** the five SFBB sections `cross | cleaning | chilling | cooking | management`; `temperature` and `probes`
  are library sub-kinds of `chilling`/`management`.
- `supervisor_role`, `deadline_time`, `assigned_role_ids` exist live but are added by no repo migration.

## Lifecycle

**Created by** (every path):

| Path | Sets | Notes |
|---|---|---|
| Web editor `/checklists/new` | name, description, frequency, role ids + tiers, sign-off, deadline, multi-per-day, `active=true` | sends no `site_id` → the trigger pins it to the creator's primary site; no `sfbb_section` (`src/app/(dashboard)/checklists/new/page.tsx:262-293`) |
| AI wizard (web) | fills the same form; saved by the editor | edge fn `ai-generate-checklist` only returns JSON, writes nothing |
| *Set up my HACCP* (`apply_haccp_setup` RPC) | everything incl. `library_key`, `sfbb_section`, `site_id`, items with descriptions; `active` only if "switch on" was ticked | also appends missing items to existing library templates |
| Onboarding defaults (web) | `is_default=true, active=false` | `src/app/(auth)/onboarding/page.tsx:1238-1345` (`src/lib/seed-checklists.ts` is an unused duplicate) |
| Mobile editor and defaults | name, frequency, **tiers only**, sign-off, section, deadline, multi-per-day, `site_id` | never writes `assigned_role_ids` (`haccp-mobile/lib/screens/checklists/checklist_manage_screen.dart:160-221`, `utils/default_checklists.dart`) |

**Scheduled** — live cron `generate-checklist-instances` (01:10 daily) runs
`generate_checklist_instances(null, today-2, today+1)` then `link_checklist_instances(null)`: one *instance* per
active template × site × period; instances whose period ended without a completion become `missed`. A completion
also upserts its instance as `completed` (trigger `_link_completion_instance`). See Gotcha 2.

**Edited** — web and mobile **delete all items and re-insert them** (`checklists/edit/[id]/page.tsx:182-202`,
`checklist_manage_screen.dart:176-185`). Gotcha 1.

**Deactivated** — `active=false`: hidden, unscheduled, history kept. Web toggles it on the list (`checklists/page.tsx:130-136`).

**Deleted** — mobile only (`checklist_detail_screen.dart:480-495`); web has no delete. Cascades (`ON DELETE CASCADE`)
to items, completions, responses, instances, drafts and the channel rows (`channel_flows`, `channel_group_checklists`,
form tokens, group takes, reminders).

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See a template | member of the business, and can see its site (`can_see_site_row`) | RLS "Business members can view templates" |
| See items | member of the business (no site check) | RLS "Business members can view items" |
| Create / edit / delete | `manage_checklists` capability, can see the site, business entitled | RLS "Managers can manage templates/items" + `entitlement_write_gate_*`. **UI shows the editor to owner/manager tier only** |
| Fill in (complete) | any member of the business who can see the site; `complete_checklists` is *not* checked | RLS on `checklist_completions` |
| Which templates a person is asked to do | owner or group admin: all; else `assigned_role_ids ∋ role_id` (web, edge) / tiers or "empty = everyone" (mobile) | `checklists/page.tsx:56-61`, `_shared/checklists-core/due.ts:4-6`, `haccp-mobile/lib/models/checklist.dart:137-149` |
| Sign off | completed + `supervisor_role` set + not yet signed + viewer is owner/manager tier | `checklists/[id]/page.tsx:30,54` (RLS lets any site member update a completion) |

See [Tiers, roles and capabilities](../concepts/roles-and-capabilities.md).

## Related

- **Completion & response** (`checklist_completions`, `checklist_responses`) — one fill-in and its answers; `source` = `app` | `whatsapp` | `telegram`; `flagged`, `corrective_status` (`needed` | `done`, channels only).
- **Checklist instance** (`checklist_instances`) — "this template is due at this site for this period": `pending` | `completed` | `missed`.
- **Draft** (`checklist_drafts`) — a half-filled form saved for later.
- **Channels** — WhatsApp Flow per template × site (`channel_flows`, synced on web save and nightly); team/group mapping (`channel_group_checklists`; first submit per period wins, `channel_group_takes`).
- **HACCP Pack / Plan** — templates prove methods by `sfbb_section` and `library_key`; the Plan reads instances.
- **Set up my HACCP** — creates library templates (`library_key`).

## Where in code

| Area | Location |
|---|---|
| Web pages | `src/app/(dashboard)/checklists/` (list, `new`, `edit/[id]`, `[id]` fill-in & sign-off) |
| Shared logic | `src/lib/checklist-status.ts` (status/overdue), `src/lib/constants.ts` (frequencies, item types), `src/lib/haccp-setup/content/checklists.ts` (library) |
| Edge / channels | `supabase/functions/_shared/checklists-core/` (`due.ts`, `time.ts`, `flagging.ts`, `answers.ts`, `reminders.ts`, `record.ts`), `whatsapp-sync-flows`, `whatsapp-*`, `telegram-*`, `channel-form`, `ai-generate-checklist` |
| Mobile | `haccp-mobile/lib/models/checklist.dart`, `screens/checklists/`, `utils/default_checklists.dart`, `utils/startup_checks.dart` |
| DB | functions `generate_checklist_instances`, `link_checklist_instances`, `_link_completion_instance`, `apply_haccp_setup`, `report_due`; cron `generate-checklist-instances` (live only) |

## Gotchas

1. **Editing a template deletes its answer history.** Edit = delete all items + re-insert; `checklist_responses.item_id`
   is `ON DELETE CASCADE`, so every past response of that template disappears (completions stay, empty).
2. **The schedule lives only in the live DB.** Cron `generate-checklist-instances` is not in any repo migration.
   It works in **UTC** (not `sites.timezone`), ignores `deadline_time` and `multi_per_day`, and treats
   `four_weekly` as a calendar month and `custom` as daily. 30,796 of 44,982 live instances are `missed` — partly
   because defaults and inactive-then-active templates are scheduled from the day they exist.
3. **"Period" has five definitions.** Web: week starts Monday, four-weekly = rolling 28 days from Monday−21,
   custom = today. Edge: same but in site time zone. Mobile: four-weekly = 28-day cycles from 2024-01-01, custom = no
   period. SQL: four-weekly = calendar month, custom = daily. `custom` has no defined schedule anywhere.
4. **Mobile ignores `assigned_role_ids`.** A template created or edited on mobile has no/stale role ids, so web and
   channels hide it from people who have a `role_id` (everyone, live), while mobile shows it to all.
5. **Mobile rewrites unknown sections to `general`.** Editing a library template on mobile overwrites `cross`,
   `temperature` or `probes` with `general` (`checklist.dart:122-127`, `checklist_manage_screen.dart:169`).
6. **"All sites" is hard to get and hidden when you get it.** Edge, cron and RLS treat `site_id IS NULL` as "all
   sites", but the insert trigger turns a null into the creator's primary site, and the web and mobile lists filter
   `.eq('site_id', current)` (`checklists/page.tsx:62,79`, `haccp-mobile/lib/providers/dashboard_provider.dart:66`), so
   a null-site template never shows in a site view. Live: 71 business-wide templates, all inactive (old seeds).
7. **Flags are decided by the client.** Web `autoFlag`, mobile `_isFlagged`, edge `flagResponse` each apply
   "yes_no = no, or temperature outside [min,max]"; the server does not re-check. Web and mobile never set
   `corrective_status`; only channels do.
8. **Sign-off is gated by tier, not by the `sign_off` capability**, and the UI uses the browser clock for "Overdue".
9. **Item descriptions are lost** when saving from the web editor or the AI wizard.
10. **Channels skip `photo` and `initials` items**; a *required* photo item makes the WhatsApp form unsupported.

## History

- 2026-10-12 WhatsApp teams (`2026-10-12-whatsapp-teams-design.md`); 2026-10-11 Telegram groups; 2026-10-10 Telegram; 2026-10-09 WhatsApp checklists.
- 2026-10-12 / 10-05 *Set up my HACCP* library and apply (`2026-10-12-haccp-setup-v2-design.md`, `2026-10-05-haccp-setup-questionnaire-design.md`).
- 2026-07-08 checklist instances; 2026-07-07 multisite (`site_id`).
- 2026-06-07 multi-per-day counter, drafts, statuses (`2026-06-07-v-next-fixes-design.md`).
- 2026-06-08 `initials` item type.
