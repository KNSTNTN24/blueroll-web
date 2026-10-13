# Checklist completion (`checklist_completions`)

> One fill-in of a checklist: who did "Opening checks" at which site and when, what they answered for every item,
> what was out of range and what they did about it, and (if required) who signed it off.

**Tables:** `checklist_completions`, `checklist_responses` (answers), `checklist_drafts` (half-filled forms),
`checklist_instances` (what was due), `channel_group_takes` (team claims) · **Scope:** site (business + `site_id`) ·
**Last verified:** 2026-10-13 against `main@b50e9d1` and the live DB (14,393 completions — 14,373 `app`, 6 `whatsapp`,
14 `telegram`, 2,682 of them demo; 104,559 responses; 44,982 instances; 7 drafts; 1 group take)

## What it is for

A completion is the evidence an EHO asks for: the SFBB diary entry for one check. The template
([checklist-template.md](checklist-template.md)) says *what* and *how often*; completions say *it was done*; instances
say *it was due* — so reports can show "missed". Flags and corrective notes are the "what went wrong and what you did" record.

## Parameters

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Checklist | `template_id` | Which template was filled in. | uuid | FK `ON DELETE CASCADE` |
| Completed by | `completed_by` | The person (profile). Channels use the linked / auto-created profile. | uuid | RLS insert: must be `auth.uid()` (app); service role for channels |
| Completed at | `completed_at` | When. Decides which *period* it counts for. | timestamptz | web sends the **browser clock** (`checklists/[id]/page.tsx:119`); mobile and channels use server time |
| Site | `site_id` | Where. Web: current site → template site → null; mobile: current site → template site → `profile.siteId`. A null becomes the creator's primary site. | uuid (live: never null) | trigger `trg_site_id_default`; `checklists/[id]/page.tsx:119`, mobile `checklist_detail_screen.dart:345` |
| Signed off by / at | `signed_off_by`, `signed_off_at` | Supervisor countersignature. Null = not signed. | uuid + timestamptz, both or neither (live: always both) | nothing in DB |
| Notes | `notes` | Completion-level note. **No path writes it** (live: 0 non-empty). | text | — |
| Source | `source` | Where it was recorded. | `app` (web + mobile), `whatsapp`, `telegram` | DB `CHECK checklist_completions_source_check` |
| — | `business_id`, `id` | Tenant and id. | | RLS |

**Answers** (`checklist_responses`, one row per item answered):

| Field | DB column | Meaning / rule |
|---|---|---|
| Item | `item_id` | FK to `checklist_template_items` **`ON DELETE CASCADE`** — editing the template deletes it (template Gotcha 1). |
| Answer | `value` | Text, encoded by item type — see *Value encoding*. NOT NULL; unanswered = `''` (web) or no row (mobile, channels). |
| Note | `notes` | Free note; for a flagged item it is the corrective action ("What did you do about it?" on web, pink field on mobile, "Action: details" on channels). |
| Flagged | `flagged` | Out of range: `yes_no = 'no'` or a temperature outside `[min,max]`. **Set by the client**, not checked by the DB (template Gotcha 7). |
| Corrective status | `corrective_status` | `needed` / `done` / null. **Only channels set it**; web and mobile always leave null. | DB `CHECK` |

**Value encoding** (live 2026-10-13): `tick` → `'true'` (web untick stores `''`); `yes_no` → `'yes'`/`'no'`;
`temperature` → plain number string (channels normalise `−18`, `-18,5`, `- 18 °C` → `-18.5`-style ASCII, max 3 digits + 2
decimals, `checklists-core/answers.ts:19-25`; web strips everything except `0-9.-`, `page.tsx:222`; ±0.5 buttons);
`text` → trimmed (channels cap 500 chars); `photo` → **storage path** `{business_id}/checklist-photos/{ms}_{filename}`
in the private `documents` bucket, opened by 1-hour signed URL (`page.tsx:101-111`, mobile `:525-549`);
`initials` → `^[A-Z0-9]{2,5}$` (`src/lib/initials.ts`; web remembers it in localStorage). Channels never ask `photo`/`initials`.

**Drafts** (`checklist_drafts`): one per (template, person) — `UNIQUE (template_id, created_by)`, not per site or period;
`responses` jsonb keyed by item id; `updated_at`.

**Instances** (`checklist_instances`): "this template is due at this site for this period". `due_date` = period start,
`period_end` exclusive, `completion_id` (FK `ON DELETE SET NULL`), `status` `pending` | `completed` | `missed`
(default `pending`; **no CHECK**). Unique on (template, site, due_date) `uq_checklist_instance`.

### Known drift (live data, 2026-10-13)

- `tick` = `'yes'` 1,794 and temperatures with a `°C` suffix (`'-15.6°C'`) 1,794 — one non-demo `app` batch dated
  2026-06-23 … 07-07 (origin *unverified*, probably an import). Canonical: `'true'`, bare number. Dart `double.tryParse`
  cannot read `'7.4°C'`, so mobile would not flag these.
- Temperature `'-'` 61 (up to 2026-10-12), 9 other non-numeric, 15 empty — web accepts a lone `-` as "answered" (Gotcha 6).
- `tick` `'false'` 12, `''` 1; text `''` 52; initials `''` 1; photo `''` 17.
- `flagged` 566: `corrective_status` null 561, `done` 5, `needed` 0. No flagged row on a non-`yes_no`/`temperature` item.
- 824 completions have **no responses** (all non-demo) — template edits (template Gotcha 1) or a failed second insert (Gotcha 5).
- Sign-off: 1,040 non-demo signed completions, **959 signed by the same person who completed them**; 654 are on templates
  with no `supervisor_role` (all 2,682 demo rows are self-signed by the seed).
- Instances: completed 13,555 (6 with `completion_id` null — the completion was deleted), pending 1,022, missed 30,796
  (all non-demo); 9,271 instances belong to templates now inactive.
- `checklist_drafts.responses` values: 13 objects (web shape) and 17 strings (mobile shape) — Gotcha 3.

## Lifecycle

**Recorded by** (every path):

| Path | How | Flags / corrective | Notifications |
|---|---|---|---|
| Web `/checklists/[id]` | insert completion, then **one row per item** (unanswered `''`), then delete draft (`page.tsx:113-131`). Two separate inserts, no transaction. | `autoFlag` (`:66-74`); note under a "no" | in-app "Flagged item" to managers per flagged item; "Sign-off required" to all profiles whose **tier** = `supervisor_role` (`src/lib/notifications.ts:53-61`) |
| Mobile detail screen | insert completion (server `now()`), rows only for answered items, delete draft (`checklist_detail_screen.dart:320-410`) | `_isFlagged` (`:508-523`); pink corrective field → `notes` | same two notices via `NotificationHelper` (`utils/notification_helper.dart:207-240`), reporter excluded |
| WhatsApp team Flow | `submitTeamForm` (`_shared/channels/bot.ts:240-293`): checks team membership and that the period is still open, claims the take, then `recordCompletion` (`checklists-core/record.ts`) with `source='whatsapp'` | `flagResponse`; flagged → `corrective_status='needed'` and a corrective Flow is sent; its reply sets `notes` + `done` (`bot.ts:349-357`, `channels/db.ts:154-170`) and alerts managers | in-app "Flagged item" to managers (`record.ts:33-38`). **No sign-off notice.** |
| Telegram group Mini App | edge fn `channel-form` → `handleFormPost` (`_shared/channels/form-api.ts:100-170`); first submit consumes the group form token (`takeGroupToken`), unknown Telegram users get a profile created | every flagged item **must** carry an action (`400 corrective_required`), so it is stored `done` with "Action: details" | managers in-app + WhatsApp-linked managers; no sign-off notice |

**Team "first submit wins"** (WhatsApp teams): `channel_group_takes` PK (group, template, site, `period_key`);
`claimTake` inserts one row for *every* team that maps the template at that site in one statement
(`teams-db.ts:252-264`); `multi_per_day` keys are `period#n` (`team-day.ts:75-77`). On record failure the take is released;
takes older than 60 days are deleted by `whatsapp-reminders` housekeeping (`whatsapp-reminders/index.ts:131`).

**Corrective reminders** (cron `whatsapp-reminders`, every 10 min): for `source='whatsapp'` answers still `needed` in the
last 2 days — 30 min → WhatsApp nudge to the person, 60 min → "No corrective action recorded" alert to managers and
Telegram Alerts groups; each step once, claimed in `channel_messages_log` (`whatsapp-reminders/index.ts:61-110`,
`checklists-core/reminders.ts:8-16`). App flags get no follow-up.

**Signed off** — web: button when completed + `supervisor_role` set + unsigned + viewer is owner/manager tier
(`page.tsx:54,134-138`). Mobile: only when the viewer's tier **equals** `supervisor_role` (`checklist_detail_screen.dart:263-275,422-460`).
Plain `UPDATE` of `signed_off_by/at`; no notification to the person who completed it.

**Drafts** — web autosaves 900 ms after every change plus "Save draft" (`page.tsx:86-99`); mobile saves only on "Save
draft" (`:1661-1675`). Loaded on open if the form is not already completed; deleted (fire-and-forget) on submit. Never expire.

**Instances** — cron `generate-checklist-instances` (01:10 UTC; live only, see template Gotcha 2) inserts
pending rows for active templates × sites for today−2 … today+1, then `link_checklist_instances` links the earliest
completion in each period and marks anything with `period_end < current_date` and no completion `missed`.
Trigger `trg_link_completion_instance` (`_link_completion_instance`, AFTER INSERT) upserts the completion's own period as
`completed`, swallowing all errors. Repo: `supabase/migrations/20260708140000_checklist_instances.sql`.

**Deleted** — mobile "Undo" on your own completion in read-only mode (`checklist_detail_screen.dart:1532-1560`); web has
no delete. Responses cascade; photo files stay in storage; the linked instance keeps `status='completed'` with
`completion_id` null until the nightly link re-links or marks it missed. Template, site or business delete cascades everything.

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See completions / instances | business member who can see the site | RLS "Business members can view completions", `ci_select` (+ `demo_read`) |
| See responses | any business member — **no site check** | RLS "Business members can view responses" |
| Record | `completed_by = auth.uid()`, own business, visible site, business entitled; `complete_checklists` not checked | RLS "Business members can create completions" + `entitlement_write_gate_ins`; responses: completion must be mine |
| Edit a completion / sign off | **any** site member may update any column (incl. `completed_at`, `completed_by`) | RLS "Users can sign off completions"; tier rule in UI only |
| Edit / delete responses | nobody from the app (no policy); service role only | — |
| Delete | own completion, or `sign_off` capability; visible site | RLS "Delete own or managed completions" |
| Drafts | own rows only | RLS "Own drafts" |
| Write instances | nobody from the app; cron and trigger (SECURITY DEFINER) | — |

## Related

- **Entities:** [Checklist template](checklist-template.md) (items, frequency, sign-off role, periods);
  [Document](document.md) (same `documents` bucket holds photo answers).
- **Concepts:** [Tiers, roles and capabilities](../concepts/roles-and-capabilities.md) (`sign_off`, unenforced `complete_checklists`).
- **Reports** (`src/app/(dashboard)/reports/page.tsx`): completions in range + `report_due` RPC (counts instances by site,
  any status) → "Missed = due − completed" (`:112-143`); PDF *Detailed* (per completion, items, Pass/Flagged, notes) and *Table* (items × dates).
- **HACCP Plan** (`supabase/functions/_shared/haccp-plan/load.ts:89-99`, `aggregate.ts:88-99`): per-day ok / flagged /
  corrected (`corrective_status='done'`) / missed (instance `missed`).

## Where in code

| Area | Location |
|---|---|
| Web pages | `src/app/(dashboard)/checklists/[id]/page.tsx` (fill, draft, sign-off), `[id]/history/page.tsx`, `checklists/page.tsx`, `dashboard/`, `diary/`, `reports/page.tsx` |
| Shared logic | `src/lib/notifications.ts`, `src/lib/initials.ts`, `src/lib/checklist-status.ts` |
| Edge / channels | `_shared/checklists-core/{record,answers,flagging,reminders}.ts`, `_shared/channels/{bot,form-api,db,teams-db,groups-db}.ts`, `channel-form`, `whatsapp-webhook`, `telegram-webhook`, `whatsapp-reminders`, `_shared/haccp-plan/` |
| Mobile | `screens/checklists/checklist_detail_screen.dart`, `checklist_history_screen.dart`, `models/checklist.dart`, `utils/reports_export.dart`, `utils/notification_helper.dart` |
| DB | triggers `trg_link_completion_instance`, `trg_site_id_default`; functions `generate_checklist_instances`, `link_checklist_instances`, `report_due`; cron `generate-checklist-instances` (live only) |

## Gotchas

1. **"Already done" ignores the site on web and mobile.** The fill page looks for this period's completion by template +
   business only (`page.tsx:49`, mobile `:246-253`), so for a business-wide template a check done at site A shows as
   completed at site B for anyone who can see both. Channels and instances do key by site.
2. **Anyone on the site can rewrite a completion.** The UPDATE policy has no column or capability limit: any member can sign
   off (the UI's tier check is cosmetic), change `completed_at` (backdate) or `completed_by`. 959 live completions are self-signed.
3. **Web and mobile drafts are different shapes.** Web stores `{itemId: {value, notes, flagged}}`, mobile `{itemId: "value"}`.
   Mobile opening a web draft puts `"{value: …}"` into the fields (`:301-307`); web opening a mobile draft gets strings where
   it expects objects (`r.value` undefined; *unverified* whether it crashes). Live: both shapes present.
4. **Corrective status is channel-only.** App flags stay `corrective_status=null` forever, so the HACCP Plan shows them as
   "flagged", never "corrected", even with a note; reminders and the 60-min manager alert exist only for WhatsApp.
   The flag notice says "is out of range" for a yes/no "No" too.
5. **Two inserts, no transaction.** If the responses insert fails (web, mobile) the completion stays with no answers and
   still counts as done; 824 live completions have no responses. Channels have the same split (`record.ts:21-28`).
6. **Web accepts a lone `-` or `.` as a temperature** (`answered` only checks non-empty, `:79`); it is not flagged. 61 live.
7. **Missed counts disagree.** Reports compute `due − completed` from instances of *any* status (incl. today's and
   tomorrow's pending, inactive templates) against *all* completions (incl. extra multi-per-day ones), clamped at 0; the
   HACCP Plan uses instance `status='missed'`. Instances follow UTC calendar periods (template Gotchas 2–3).
8. **Sign-off rule differs.** Web: any owner/manager when `supervisor_role` is set; mobile: only the exact tier named;
   neither uses the `sign_off` capability, channels never send "Sign-off required", and notices go by `profiles.role` with
   no `removed_at` filter (#57).
9. **Responses are immutable from the app** (no UPDATE/DELETE policy) — a wrong answer can only be undone by deleting the
   whole completion, and only mobile can do that.
10. **Photo answers.** File names are not sanitised (web or mobile), unlike document uploads, so names with special
    characters can fail with "Invalid key" *(unverified live)*; files are not removed when the completion is deleted.
11. **Drafts are per template + person, not per site or period** — yesterday's half-filled draft reloads today.

## History

- 2026-10-12 WhatsApp teams + `channel_group_takes`; 2026-10-11 Telegram groups (Mini App, `channel-form`); 2026-10-09/10
  WhatsApp/Telegram checklists — `source`, `corrective_status` (`20261010120000_whatsapp_channel.sql`).
- 2026-10-11 HACCP Plan reads completions + instances (`2026-10-11-haccp-plan-document-design.md`).
- 2026-07-14 delete policy moved to `sign_off` capability (`20260714130300_rbac_rls_swap.sql`); 2026-07-12 entitlement write gate.
- 2026-07-08 instances, trigger, `report_due` (`20260708140000`, `20260708150000`).
- 2026-06-07 drafts, undo/delete policy, multi-per-day (`2026-06-07-v-next-fixes-design.md`).
