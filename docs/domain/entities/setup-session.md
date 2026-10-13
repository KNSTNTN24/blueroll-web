# Set up my HACCP session (`haccp_setup_sessions`)

> One run of the *Set up my HACCP* questionnaire for one site: plain questions about how the kitchen works, saved as
> you go, then reviewed and applied to fill the HACCP Pack and add the checklists the FSA expects.

**Tables:** `haccp_setup_sessions`, `ai_usage_log` (assistant usage) · **Scope:** site · **Last verified:** 2026-10-13
against `main@b50e9d1` and the live DB (17 sessions: 8 abandoned, 6 applied, 3 in progress; 2 businesses, 6 sites)

## What it is for

Filling 115 SFBB fields by hand is the main reason packs stay empty. The session asks ~60 yes/no and multiple-choice
questions instead, confirms what Blueroll already knows (menu, recipes, suppliers, team, checklists), lets the owner
describe six methods "in your own words" (an AI turns them into plan text), and on apply writes the pack and creates
library checklists in one transaction. Specs: `2026-10-05-haccp-setup-questionnaire-design.md` (v1),
`2026-10-12-haccp-setup-v2-design.md` (tabs, confirm steps, documents, Phase B "own words → plan text").
The pack itself is described in [HACCP Pack](haccp-pack.md); the library checklists in [Checklist template](checklist-template.md).

## Parameters

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| Business, Site | `business_id`, `site_id` | Whose pack is set up. Both required. | uuids; site must belong to the business | FKs `ON DELETE CASCADE`; RLS insert/update `EXISTS (sites …)` |
| Status | `status` | `in_progress` = being answered; `applied` = RPC ran; `abandoned` = "Start over" (or left behind). | `in_progress`, `applied`, `abandoned` | DB `CHECK haccp_setup_sessions_status_check` (v1 spec's `draft_ready` was never built) |
| Answers | `answers` | `{questionId: value}`, saved after every answer (`api.ts:37-41`, `page.tsx:113-118`). Shape per answer kind below. | jsonb object | code only |
| Version | `questionnaire_version` | `QUESTIONNAIRE_VERSION` at creation (`content/questions.ts:4`, now `2`). Never updated afterwards and never read by the app — Gotcha 5. | int | `NOT NULL` |
| Result | `applied_summary` | Written by the RPC: `{checklists: [library keys], item_adds: n, fields: [field ids], created, items_added, questionnaire_version}`. | jsonb or null | `apply_haccp_setup` |
| Applied at | `applied_at` | When applied. RLS lets status become `applied` only with this set. | timestamp | RLS update `WITH CHECK` |
| Created by | `created_by` | `auth.uid()` default. | uuid | FK `auth.users ON DELETE SET NULL` |

`id`, `created_at`, `updated_at` also exist; `updated_at` is set by `saveAnswers` and the RPC, **not** by abandon
(no trigger). Index `idx_haccp_setup_sessions_site (business_id, site_id, created_at desc)`; no unique index.

**Answer kinds** (`AnswerSpec`, `src/lib/haccp-setup/types.ts:26-36`; 59 questions in `content/questions.ts`):

| Kind | Count | Stored value |
|---|---|---|
| `yes_no` | 31 | `true` / `false` |
| `single` | 9 | option value string (e.g. `venue_type: 'restaurant'`) |
| `multi` | 6 | string[] (e.g. `processes: ['cook_hot','defrost']`) |
| `equipment_list` | 1 | `[{kind, label}]`, kind ∈ `fridge, freezer, display_chiller, blast_chiller, dishwasher, probe, hot_hold, other`; free text can be parsed by the assistant (`parse_equipment`) |
| `confirm_data` | 5 | `true` or `'missing'` — confirms raw products, menu methods, suppliers, team, checklists |
| `documents` | 1 | `{fileFieldId: '{"id","title"}'}` — documents for pack file fields Blueroll cannot cover |
| `own_words` | 6 | `{text, draft, ticks: {fieldId: bool}}` or `'skip'` (`pest_words`, `cooling_words`, `defrost_words`, `freezing_words`, `probe_words`, `training_words`) |

Each question has `META` (`questions.ts:275-335`): its SFBB `method` and the pack field ids it `fills`. Visibility
uses `showIf` conditions (`conditions.ts:3-17`): `{q, eq}`, `{q, has}`, `{equipment}`, `all/any/not`, plus
`{data: source}` (Blueroll has that data for the site) and `{auto: fieldId}` (auto-fill already fills that field) —
the last two come from `buildSetupContext` (`context.ts:27-57`).

### Known drift (live data, 2026-10-13)

- `questionnaire_version`: 16 rows `1`, 1 row `2` — including 2 v1 sessions applied on 2026-10-11 and all 3 open sessions, which now run with v2 questions.
- Answer keys found live are all current question ids (no orphans). 1 session belongs to a site that is not `active`.
- `ai_usage_log`: 7 rows (`draft_method` 5, `parse_equipment` 1, `answer` 1).

## Lifecycle

- **Start / continue** — opening `/haccp-setup` calls `loadOrCreateSession` (`api.ts:12-35`): newest `in_progress`
  session of the site, else **a new one seeded with the answers of the last `applied` session** of that site
  (re-run = "edit what changed"). The UI picks the site from `currentSiteId`, the only site, or a picker (`page.tsx:28-46`).
- **Answering** — the questionnaire is shown as tabs `profile → cross → cleaning → chilling → cooking → management →
  documents → review` (`engine.ts:53-61`); each tab shows its first visible unanswered question (`currentQuestionIn`,
  `:64-66`); the tab advances only when you answer at the frontier (`tabAfterAnswer`, `:69-75`). Answers to
  questions that became hidden stay stored but are ignored (`effectiveAnswers`, `:22-28`).
- **Review** — `buildDraft` (`draft.ts:22-33`) builds: pack fields (`FIELD_RULES`, 68 rules, `content/haccp-mapping.ts`;
  then own-words values; then documents), library checklists (`CHECKLIST_LIBRARY`, 17, `content/checklists.ts`),
  item additions to library checklists already on the site, and warning notes. `classifyField` (`draft-pack.ts:18-27`):
  **manual** = field in `overrides` (never touched); **kept** = has a value set by hand/elsewhere, or same value;
  **new** = empty, or a previous setup value (`sources = 'questionnaire'`) that changed. Only `new` fields are written.
  `reviewComposition` (`context.ts:118-145`) shows per section: from answers / from Blueroll / still open.
- **Default selection** (`apply.ts:17-24`): all new fields; all new checklists except those similar to an onboarding
  default (`SIMILAR_DEFAULTS`); **no** item additions. "Switch on" checkbox → `activate` (default off, `draft-review.tsx:68,175`).
- **Apply** — RPC `apply_haccp_setup(p_session, p_payload)` (security invoker; live = `20261012130000_haccp_setup_apply_pack_check.sql`):
  checks manager, `in_progress`, site; locks the pack and raises `pack_changed` if `pack_expected_updated_at` ≠ pack
  `updated_at` (only when the payload writes the pack); inserts checklists (`library_key`, tiers → `assigned_role_ids`,
  `is_default=false`, `active = activate`; `ON CONFLICT … DO NOTHING`; `empty_roles` if no matching roles); appends
  missing items; upserts the whole pack `data` (merged on the client, `mergePack` marks `sources[id]='questionnaire'`);
  sets `status='applied'`, `applied_at`, `applied_summary`. Errors are mapped in `draft-review.tsx:88-93`.
- **Start over** — `abandonSession` sets `abandoned` (`api.ts:43-46`, `page.tsx:150-155`) and reloads → a new session.
- **Deleted** — never by the app; cascades with the business or site.

## Own words → plan text (AI)

`OwnWordsCard` sends `{action:'draft_method', method, text, venue_type}` to edge function `haccp-assistant`
(`api.ts:135-137`). Server guards (`supabase/functions/_shared/draft-method.ts`): method must be one of 6
(`DRAFT_METHODS`, `:9-26`); text cut at 1,500 chars; ≤ 8 sentences × 300 chars; **number grounding** — a sentence is
dropped if it has a number the owner did not write, or a number+unit (min/h/day/week/month/°C) the owner did not
write with the same unit (`:63-86`, `:126-138`); **tick whitelist** — ticks/confirm only for that method's ids,
states `yes|no|confirm` (`:141-157`). The owner edits and "Use this", "Use my words as written", or "Skip".
**Answers win** (`own-words.ts:17-37`): the draft text and ticked points are dropped for any field that another
*answered* question `fills`. Own-words questions are hidden when auto-fill already fills their target (`{not:{auto}}`).

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See / start / answer / abandon | `profiles.role` ∈ owner, manager in that business (legacy tier, not capabilities) | RLS `managers read/create/update setup sessions` → `is_business_manager()`; UI `isManager` (`hooks/use-auth.ts:204`) |
| Apply | same + RLS on `checklist_templates`/items (`manage_checklists`, entitlement) and `haccp_pack_data` (entitlement), since the RPC is invoker | `apply_haccp_setup` |
| Use the assistant | owner/manager by `profiles.role`; 30 calls per business per rolling 24 h, shared by all actions | `haccp-assistant/index.ts:37-38,59-74` |
| Demo business | blocked in UI ("Not available in demo mode") | `page.tsx:34` |

See [Roles and capabilities](../concepts/roles-and-capabilities.md).

## Related

- [HACCP Pack](haccp-pack.md) — target of the fields; the pack page shows the *Set up my HACCP* panel (`haccp-pack/setup-hero.tsx`, managers only, `page.tsx:557`): Start / Continue — N% / Review (`hero.ts:14-28`).
- [Checklist template](checklist-template.md) — `library_key` templates; [Document](document.md) — documents step; [Site](site.md), [Member](member.md).
- **Mobile** — no questionnaire; a manager-only button opens `https://app.blueroll.app/haccp-setup` in the browser (`haccp-mobile/lib/features/haccp/site_haccp.dart:109-117`).

## Where in code

| Area | Location |
|---|---|
| Web pages | `src/app/(dashboard)/haccp-setup/` (`page.tsx`, `question-card.tsx`, `answer-input.tsx`, `data-steps.tsx`, `own-words-card.tsx`, `draft-review.tsx`, `side-panels.tsx`, `step-rail.tsx`), `src/app/(dashboard)/haccp-pack/setup-hero.tsx` |
| Shared logic | `src/lib/haccp-setup/` (`types`, `engine`, `conditions`, `context`, `draft*`, `apply`, `own-words`, `hero`, `api`, `content/{questions,haccp-mapping,checklists,thresholds}`) |
| Edge functions | `haccp-assistant` (`parse_equipment`, `answer`, `draft_method`; model Haiku 4.5), `_shared/assistant-core.ts`, `_shared/draft-method.ts` |
| DB | `haccp_setup_sessions`, `ai_usage_log`, `is_business_manager`, `apply_haccp_setup`, index `uq_checklist_templates_library_key` |

## Gotchas

1. **Setup text can be hidden on the pack page.** Own-words questions are skipped when auto-fill fills the target
   *at setup time*, but if auto data appears later the pack page shows the auto value over the setup text (the Plan
   prefers the text). [#86](https://github.com/KNSTNTN24/blueroll-web/issues/86)
2. **Manager = legacy `profiles.role`.** Session RLS, the edge function and the UI all check owner/manager tier, not
   capabilities or `removed_at`; but apply runs as invoker, so a "manager" without `manage_checklists` (or an
   unentitled business) gets a raw RLS error on apply. [#55](https://github.com/KNSTNTN24/blueroll-web/issues/55) [#57](https://github.com/KNSTNTN24/blueroll-web/issues/57)
3. **"Start over" does not start empty after an earlier apply.** It abandons the session, and the next one is seeded
   from the last applied session's answers (`api.ts:20-27`).
4. **Just opening `/haccp-setup` creates a session**, and nothing prevents two `in_progress` sessions per site (no
   unique index; the app takes the newest). After an apply, "Review with questions" creates a new open session, so the
   panel then says "Continue — N%".
5. **Version is decorative.** `questionnaire_version` is stamped at insert, never bumped when an old session continues
   under new questions (spec: "old sessions continue") and never read; `applied_summary.questionnaire_version` copies it,
   so v1-stamped sessions applied with v2 content are indistinguishable.
6. **"Answers win" is by `fills`, not by value.** An own-words tick is dropped if any answered question *could* set
   that field — e.g. `cooling_method = blast_chiller` sets no `cd_portions`, yet the owner's `cd_portions` tick is
   still discarded (`own-words.ts:17-24`, `haccp-mapping.ts:114`).
7. **Only `new` fields are written; values from elsewhere are never replaced.** A text typed on mobile or before
   setup is "kept" even if the answers now say otherwise; only earlier setup values are refreshed.
8. **The RPC trusts the client's pack.** It upserts the whole `data` merged in the browser; the guard is only the
   `updated_at` match. A checklist-only apply skips that guard.
9. **Assistant limit is per business, rolling 24 h**, counts failed model calls (reserved first), and the UI says
   "today's limit". `answer` with no knowledge match is free.
10. **Mobile link has no site**: the web opens on its own `currentSiteId`, which may differ from the site viewed on mobile.
11. Abandon does not touch `updated_at`; there is no `abandoned_at`.

## History

- 2026-10-12 v2 + Phase B own words (`2026-10-12-haccp-setup-v2-design.md`); `20261012130000` — pack check only when the pack is written, `activate`.
- 2026-10-06 table, RLS, `library_key`, `ai_usage_log`, `apply_haccp_setup` (`20261006120000_haccp_setup.sql`); spec `2026-10-05-haccp-setup-questionnaire-design.md`.
- Mobile: `haccp-mobile@3c60d76` link to the web questionnaire.
