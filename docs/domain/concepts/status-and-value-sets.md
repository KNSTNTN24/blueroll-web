# Status and value sets

> Every enumerated value in Blueroll in one place: the allowed spellings, what each means, where (if anywhere) it is
> enforced, what is really in the live data, and the canonical choice when the two disagree. Use a value from here; never invent a new spelling.

**Touches:** every entity page (linked per row) · [Roles & capabilities](roles-and-capabilities.md) ·
[Subscription & entitlement](subscription-and-entitlement.md) · [Channels](channels.md) ·
**Last verified:** 2026-10-13 against `main@3d6f5b6` and the live DB

## The rule in plain words

- All of these columns are `text` (or `text[]`). Postgres enums are not used anywhere in `public`. A value is safe only
  when a **DB `CHECK`** exists. Without one, any client can write any string, and some have (see *Drift* below).
- **Canonical** = what the current web **and** mobile writers produce and the readers understand. When you add a value, add it to
  the `CHECK`, the TS constant, the Dart constant and this page in the same PR.
- In the tables, **CHECK** means a live constraint (`pg_constraint`). ⚠ = **no DB enforcement**. "repo ✗" = the
  constraint exists live but no repo migration creates it ([#59](https://github.com/KNSTNTN24/blueroll-web/issues/59)).
- Live counts are `select col, count(*) … group by 1` (arrays via `unnest`) taken on 2026-10-13. **Bold** = drift.
  Counts shown with "·" for brevity.

## Statuses

| Column | Values and meaning | Enforced | Live 2026-10-13 | Drift → canonical |
|---|---|---|---|---|
| `checklist_instances.status` | `pending` period still open · `completed` a completion in the period is linked · `missed` period ended with none | ⚠ none; comment only (`20260708140000_checklist_instances.sql:11`). Written only by `generate_checklist_instances` (default), `link_checklist_instances` and the completion trigger (`:66-90`) | missed 30,796 · completed 13,628 · pending 949 | none. Meaning of "missed" differs per layer: [periods](periods-and-due-checks.md), [#58](https://github.com/KNSTNTN24/blueroll-web/issues/58) |
| `haccp_setup_sessions.status` | `in_progress` being answered · `applied` RPC ran · `abandoned` Start over | CHECK `haccp_setup_sessions_status_check` | abandoned 8 · applied 6 · in_progress 3 | none ([setup session](../entities/setup-session.md)) |
| `incidents.status` | `open` · `resolved` | ⚠ none; both apps write only these (mobile `models/incident.dart:11`, `ops_provider.dart:108`) | resolved 22 · open 13 | none ([incident](../entities/incident-and-notification.md)) |
| `sites.status` | `onboarding` just added · `active` running · `removed` soft-deleted · `archived` read by billing only | ⚠ none; default `'active'`. `removed` written by `sites-settings.tsx:155`; `archived` only read by `billable_site_count` | active 85 · onboarding 22 | `archived` is written by nothing: billing counts `removed` sites ([#74](https://github.com/KNSTNTN24/blueroll-web/issues/74)). Canonical `onboarding`/`active`/`removed` |
| `channel_group_members.status` | `invited` · `active` joined · `removed` taken out of the team | CHECK `channel_group_members_status_check` | active 2 | none ([channels](channels.md)) |
| `channel_flows.status` | `published` · `error` · `unsupported` (template has items a Flow can't show) | CHECK `channel_flows_status_check` | published 37 | none |
| `feedback_requests.status` / `email_status` | `new`,`open`,`planned`,`resolved`,`closed` / `pending`,`sent`,`failed` | CHECK `feedback_requests_status_check`, `…_email_status_check` | new 2 / sent 2 | none |
| `checklist_responses.corrective_status` | null = nothing to do · `needed` · `done` | CHECK `…_corrective_status_check` | null 105,325 · done 5 | none. Never set by the apps ([#79](https://github.com/KNSTNTN24/blueroll-web/issues/79)) |
| `businesses.subscription_status` | **Computed** by trigger `trg_zz_subscription_arbiter` → `compute_entitlement`: `trialing` · `active` · `canceled` (a source existed, none live) · `none` (no source ever) | ⚠ no CHECK; only the arbiter writes it (direct writes ignored) | trialing 48 · active 21 · canceled 15 | stale, not drifted: 45 `trialing` have expired ([#72](https://github.com/KNSTNTN24/blueroll-web/issues/72)) |
| `businesses.stripe_status` | raw Stripe `sub.status` (`trialing`, `active`, `past_due`, `canceled`, …) or `canceling` = cancel at period end (`stripe-webhook/payload.ts:42`) | ⚠ none | null 77 · canceling 3 · active 3 · canceled 1 | none live. Any Stripe status can land here |
| `businesses.iap_status` | `active` (incl. grace) · `canceling` (Play) · `past_due` (Apple retry) · `canceled` (`apple-webhook/status-map.ts:3-15`, `play-webhook/status-map.ts:4-16`) | ⚠ none | null 69 · active 10 · canceled 4 · **`none` 1** | `'none'` → NULL [#60](https://github.com/KNSTNTN24/blueroll-web/issues/60) |
| `businesses.manual_status` | `trialing` signup trial · `active` comp · null = no manual grant | ⚠ none | trialing 58 · active 19 · null 6 · **`none` 1** | `'none'` → NULL. Probable origin: the backfill `SET manual_status = subscription_status` (`20260607120100_subscription_arbitration.sql:10-20`) copied a `'none'`. The arbiter reads `'none'` as "a source existed", so the business shows `canceled` instead of `none` |

`compute_entitlement` counts only `active`, `trialing`, `canceling` as live; a new spelling (`cancelled`, `past-due`)
silently means "not entitled". `is_business_entitled` also grants `past_due` with a future `stripe_until`
(`20260712180000_is_business_entitled.sql:15`). See [subscription](subscription-and-entitlement.md).

## Sources and kinds

| Column | Values and meaning | Enforced | Live | Drift → canonical |
|---|---|---|---|---|
| `checklist_completions.source` | `app` (web or mobile) · `whatsapp` · `telegram` | CHECK `checklist_completions_source_check`, default `app` | app 14,454 · telegram 14 · whatsapp 6 | none |
| `channel_form_tokens.kind` | `checklist` (person) · `corrective` (fix-it form for one response) · `group_checklist` (Telegram group) | CHECK `…_kind_check` + `…_group_kind_check` (owner per kind) | checklist 16 · group_checklist 11 · corrective 6 | none |
| `haccp_plan_shares.kind` | `inspector` (shareable link) · `pdf` (short-lived PDF token) | CHECK `haccp_plan_shares_kind_check` (repo `20261012120000_haccp_plan_shares.sql:8`) | pdf 2 · inspector 2 | none ([HACCP Plan](../entities/haccp-plan.md)) |
| `notifications.type` | `checklist` · `checkin` · `incident` · `document` · `team` (writers: web `src/lib/notifications.ts:29-71`, mobile `utils/notification_helper.dart:127-273`, edge `checklists-core/record.ts:36`, `team-members.ts:117`). Web also has `haccp` (`notifications.ts:76`, never called) | ⚠ none | checklist 8,665 · checkin 673 · team 82 · incident 52 · document 7 · **delivery 1 · signoff 1 · critical 1** | the last three are written by no code (demo-style rows). Readers accept even more aliases (`task`, `checklist_missed`, `doc`, `recipe`: web `notification-meta.tsx:29-34`; mobile `notif_meta.dart:42-60`) |
| `menu_items.allergen_source` | `recipe` allergens read live from the recipe · `manual` declared and attested by a named person | CHECK `menu_items_allergen_source_check` (+ attestation / recipe-id CHECKs) | manual 116 · recipe 50 | none ([menu](../entities/menu.md)) |
| `suppliers.logo_source` | null no logo · `brandfetch` · `manual` | CHECK `suppliers_logo_source_check` | null 32 · brandfetch 17 | none |
| `channel_identities.consent_source` | `team_invite` (WhatsApp team, `teams-db.ts:203`) · `group_form` (Telegram group form, `groups-db.ts:278`) · `qr_code` (default; retired link flow) | ⚠ none | qr_code 3 · group_form 2 · team_invite 1 | `qr_code` is legacy but legal consent evidence: keep it in any CHECK |
| `channel_identities.channel`, `channel_groups.channel` | `whatsapp` · `telegram` | CHECK on both; ⚠ none on `channel_flows.channel`, `channel_messages_log.channel` | telegram 4 · whatsapp 2 / telegram 2 · whatsapp 1 | none |
| `channel_messages_log.kind` | free log tag (`reply`, `flow`, `alert`, `team_morning`, …) | ⚠ none (log; no CHECK wanted) | 18 kinds, incl. retired `reminder` 41, `link` 8, `link_fail` 1 | historic, leave ([channels](channels.md)) |
| `channel_group_events.kind` | once-only key: `morning:<member id>`, `overdue`, `day_end`, `day_end_app` | ⚠ none (part of the PK) | 4 rows | by design |
| `feedback_requests.kind` | `question` · `feature` · `bug` · `feedback` | CHECK; TS `FEEDBACK_KINDS` `src/lib/feedback.ts:1` | question 2 | none |
| `template_leads.source` | landing-page form position (`haccp-template:hero`, …) | ⚠ none (marketing) | 10 values | not product data ([marketing](marketing-and-external-data.md)) |

## Categories and lists

| Column | Values and meaning | Enforced | Live | Drift → canonical |
|---|---|---|---|---|
| `documents.category` | `certificate`, `license`, `policy`, `instruction`, `contract`, `inspection`, `training`, `other` | ⚠ none; default `other`. TS `DOCUMENT_CATEGORIES` `src/lib/constants.ts:64`; mobile `DocumentCategory` (`models/document.dart:1`, unknown → `other`) | other 55 · training 27 · policy 24 · instruction 18 · certificate 12 · license 4 · inspection 2 · contract 1 · **inspections 2 · certificates 1 · insurance 1 · operations 1** | plurals → singular; `insurance`/`operations` → `other` (or add `insurance` on purpose). [#60](https://github.com/KNSTNTN24/blueroll-web/issues/60) |
| `documents.access_level` | `all` · `managers_only` · `owner_only` · `custom` (named people) | ⚠ none; read by RLS `documents_select` | all 133 · **managers 7** · managers_only 7 · custom 1 | `managers` → `managers_only`. Writer: the web list's inline select `documents/page.tsx:237`. RLS hides these from managers; mobile shows them as "All staff" (`document.dart:86-97`). [#53](https://github.com/KNSTNTN24/blueroll-web/issues/53) |
| `incidents.type` / `category` / `severity` | `incident`,`complaint` / `Injury`,`Equipment`,`Illness`,`Complaint`,`Other` (**Title-case**) / `low`,`medium`,`high`,`critical` | CHECK `incidents_type_check`; `incidents_category_chk`, `incidents_severity_chk` (repo ✗: both columns are live-only). Mobile `ops/incidents_tab.dart:17-18`; web never writes category/severity | incident 28 · complaint 7 / Other 17 · Equipment 9 · Complaint 7 · Injury 2 / medium 24 · high 4 · low 4 · critical 3 | none. Do not "fix" the category case: the CHECK wants Title-case |
| `recipes.category` (legacy course) | `starter`, `main`, `dessert`, `side`, `sauce`, `drink`, `other` | CHECK `recipes_category_check` (repo `001_initial_schema.sql:148`) | other 91 · main 66 · starter 24 · dessert 13 · side 8 · sauce 7 · drink 2 | none; superseded by tags ([recipe](../entities/recipe.md)) |
| `menu_items.category` (legacy) | grouping before per-site sections (`menu_categories`); web labels `DISH_CATS` Starters/Mains/Sides/Desserts/Other, slugs via `catSlug` (`src/lib/dishes.ts:38-48`) | ⚠ none, `NOT NULL` | 25 values: `main` 17 · `starter` 8 · `starters` 5 · `mains` 3 · … plus section names (`Small Plates` 19, `Noodles` 15 …) | `catLabel` folds singular/plural; section names fall to "Other". Retire, don't constrain ([menu](../entities/menu.md)) |
| `menu_items.dietary[]` | `Vegan`, `Vegetarian`, `Gluten-Free`, `Dairy-Free` (`DIETARY_FLAGS` `src/lib/dietary.ts:11`) | ⚠ none | Vegetarian 8 · **vegetarian 5** · Vegan 4 · **vegan 2 · gluten_free 1** | Title-case with hyphen [#60](https://github.com/KNSTNTN24/blueroll-web/issues/60) |
| `menu_items.declared_allergens[]`, `ingredients.allergens[]` | the 14 lowercase keys of `EU_ALLERGENS` (`src/lib/constants.ts:2-5`; `nuts` = tree nuts) | ⚠ none | dish: 13 keys + **`Milk` 1**; ingredients: all 14 canonical (milk 142 … lupin 1) | `Milk` → `milk` (web drops it: `dishes.ts:63`) |
| `checklist_templates.frequency` | `daily`, `weekly`, `monthly`, `four_weekly` (cron treats it as monthly), `custom` (several a day / own rule) | CHECK `checklist_templates_frequency_check`; TS `CHECKLIST_FREQUENCIES` `constants.ts:33` | daily 1,045 · weekly 208 · custom 79 · four_weekly 68 · monthly 38 | none ([periods](periods-and-due-checks.md)) |
| `checklist_templates.sfbb_section` | the 5 SFBB sections `cross`, `cleaning`, `chilling`, `cooking`, `management` (`HACCP_SECTIONS` `constants.ts:75-81`); library adds `temperature`, `probes` (`haccp-setup/content/checklists.ts`) | ⚠ none, nullable | null 726 · cleaning 244 · chilling 211 · cooking 92 · management 71 · **general 38 · cross_contamination 38** · cross 8 · **training 7** · probes 2 · temperature 1 | mobile enum `SfbbSection` writes `cross_contamination`/`training`/`general` (`models/checklist.dart:94-128`). Map `cross_contamination`→`cross`, `training`→`management`, `general`→null; decide whether `temperature`/`probes` stay [#60](https://github.com/KNSTNTN24/blueroll-web/issues/60) |
| `checklist_template_items.item_type` | `tick`, `temperature`, `text`, `yes_no`, `photo`, `initials` | CHECK `…_item_type_check`; `CHECKLIST_ITEM_TYPES` `constants.ts:34` | tick 2,807 · yes_no 2,484 · temperature 1,399 · text 1,106 · initials 424 · photo 60 | none. Answer *values* drift (`yes`, `°C`) — [completion](../entities/checklist-completion.md) |
| `checklist_template_items.unit` | `°C` on temperature items, else null | ⚠ none | null 6,881 · °C 1,399 | none |
| `recipes.haccp_methods[]` | 9 ids: `chilled_storage`, `chilling_down`, `defrosting`, `freezing`, `cooking_safely`, `extra_care`, `reheating`, `hot_holding`, `ready_to_eat` (`HACCP_RECIPE_METHODS` `src/lib/haccp-methods.ts:14-72`; mobile `kitchen/recipe_haccp.dart:10`) | ⚠ none | cooking_safely 34 · chilled_storage 26 · ready_to_eat 16 · chilling_down 14 · hot_holding 11 · reheating 11 · defrosting 9 · extra_care 5 · freezing 5 | none |
| `recipes.extra_care_flags[]` | `eggs`, `rice`, `pulses`, `shellfish` (web edit `recipes/edit/[id]/page.tsx:27-32`; mobile `recipe_form.dart:30`) | ⚠ none | eggs 8 · rice 8 · shellfish 2 · pulses 2 | none yet, but web **New** writes the free-text note or `'extra_care'` (`recipes/new/page.tsx:95`) [#90](https://github.com/KNSTNTN24/blueroll-web/issues/90) |
| `recipes.cooking_time_unit` | `minutes`, `hours` | CHECK `recipes_cooking_time_unit_check` (allows null) | minutes 202 · null 6 · hours 3 | null = minutes |
| `suppliers.delivery_days[]` | `Mon` … `Sun` (web `suppliers/page.tsx:40`, mobile `suppliers_screen.dart:22`) | ⚠ none | Wed 35 · Tue 31 · Thu 31 · Mon 30 · Fri 30 · Sat 20 · Sun 9 · **`monday`…`saturday` 1 each** | lowercase full names → `Mon`… [#60](https://github.com/KNSTNTN24/blueroll-web/issues/60) |
| `staff_checkins.mood` | `Smooth`, `Busy`, `Rough` (web `dashboard/page.tsx:15`, mobile `site_dashboard.dart:258-262`) | ⚠ none; nullable | 😎 50 · Smooth 46 · 😊 46 · Rough 33 · Busy 22 · null 19 · 💪 13 · 😴 9 · 🔥 9 · 🤒 3 | **emoji** (130 rows) from the old picker; the dead `MOOD_EMOJIS` (`constants.ts:72`, [#110](https://github.com/KNSTNTN24/blueroll-web/issues/110)) still lists them. Mobile colours unknown as Smooth (`utils/mood.dart`) |
| `roles.base_tier`, `profiles.role`, `invites.role` | `owner`, `manager`, `chef`, `kitchen_staff`, `front_of_house` (`USER_ROLES` `constants.ts:16`) | CHECK on all three (`invites_role_check`) | base_tier: kitchen_staff 95 · chef 86 · manager 85 · front_of_house 84 · owner 84 | none ([roles](roles-and-capabilities.md)) |
| `roles.capabilities[]` | the 15 names in the repo (`capability_catalog`; live has 14 until migration `20261015120000` adds `manage_reviews`) (`CAPS` `src/lib/permissions.ts:10`) | trigger `trg_validate_role_caps` → `validate_role_capabilities()` rejects unknown names | 14 names, all valid (live) | none |
| `member_capability_overrides.capability` | same names (14 live, 15 after `manage_reviews`); `granted` true = add, false = remove | ⚠ **none**: no FK to `capability_catalog`, no trigger | 14 rows, all `granted=true`, all valid | add an FK (Gotcha 4) |

## Overloaded words

| Word | Means, per table |
|---|---|
| **active** | `checklist_templates.active` = scheduled by the cron and shown (true 592 · false 846) · `recipes.active` = not greyed out (true 203 · false 8) · `menu_items.active` = a flag nothing toggles (all 166 true) · `notification_rules.active` (0 rows) · `sites.status='active'` = running · `channel_group_members.status='active'` = joined the team · `subscription_status='active'` = paid; `stripe_status`/`iap_status` `active` = that one source pays · a member is "active" when `profiles.removed_at IS NULL` (no column) |
| **status** | lifecycle of an instance, session, incident, site, team member, Flow, feedback; `corrective_status` is a to-do flag; `subscription_status` is **computed**, the `*_status` source columns are raw provider states |
| **source** | `checklist_completions.source` = channel used · `menu_items.allergen_source` = where allergens come from · `suppliers.logo_source` = logo provider · `channel_identities.consent_source` = how consent was given · pack `data.sources` = which field was filled by the questionnaire ([pack](../entities/haccp-pack.md)) · "payment source" = Stripe / store / manual · `template_leads.source` = landing form |
| **override** | `member_capability_overrides` = per-person capability grant/removal · pack `data.overrides` = a field the owner edited, so auto-fill leaves it (5 of 10 pack rows have some) · `recipes.vegan_override` etc. = forced dietary flag, null = auto (vegan 31, vegetarian 51, gluten-free 3, dairy-free 6 rows set) |
| **kind** | `channel_form_tokens.kind` = form type · `haccp_plan_shares.kind` = link vs PDF · `feedback_requests.kind` = what the user is asking · `channel_messages_log.kind` = log tag · `channel_group_events.kind` = dedupe key · setup answer *kinds* (`AnswerSpec`, [setup session](../entities/setup-session.md)) · equipment `kind` (`EQUIPMENT_KINDS` `src/lib/haccp-setup/types.ts:4`) |
| **type** | `incidents.type` (complaint/incident) · `notifications.type` (icon group) · `checklist_template_items.item_type` · `documents.file_type` (a MIME type, e.g. `application/pdf` 107) · `CHECKLIST_TYPES` (`constants.ts:45`) = AI wizard presets, never stored |

## Where it is enforced

| Layer | What is checked | Location |
|---|---|---|
| Database | 27 value `CHECK`s (listed above); capability names by trigger | `pg_constraint`, `validate_role_capabilities` |
| Web UI | selects from TS constants; no runtime validation of read values | `src/lib/constants.ts`, `dietary.ts`, `dishes.ts`, `haccp-methods.ts`, `permissions.ts` |
| Mobile | Dart enums with `orElse` fallbacks (unknown → `other` / `general` / `all` / Smooth), so drift is hidden, not fixed | `models/document.dart`, `models/checklist.dart`, `utils/mood.dart` |
| Edge functions | literal unions in TS types (`source: 'whatsapp' \| 'telegram'`) | `_shared/checklists-core/record.ts:5-12` |

**Recommended new CHECKs** (normalise data first, add `NOT VALID` then `VALIDATE`): `checklist_instances.status`,
`incidents.status`, `sites.status` (decide on `archived`), `documents.category`, `documents.access_level`,
`checklist_templates.sfbb_section`, `notifications.type`, `channel_identities.consent_source`, the four
`businesses.*_status` columns, and array checks (`col <@ array[...]`) on `suppliers.delivery_days`, `menu_items.dietary`,
`menu_items.declared_allergens`, `ingredients.allergens`, `recipes.haccp_methods`, `recipes.extra_care_flags`; an FK
`member_capability_overrides.capability → capability_catalog(cap)`. `staff_checkins.mood` only after the emoji rows are
mapped or nulled. **Leave unconstrained:** `menu_items.category` (legacy), `channel_messages_log.kind`,
`channel_group_events.kind`, `template_leads.source`, `checklist_template_items.unit`.

## Gotchas

1. **Mobile hides drift.** Its enums map unknown values to a default (`DocumentCategory.other`, `SfbbSection.general`,
   `AccessLevel.all`), and **saving a template on mobile writes `general` back** over a library section
   ([template](../entities/checklist-template.md) Gotcha). A row can look fine on mobile and broken on web.
2. **`managers` vs `managers_only`.** The same document is hidden from managers by RLS and labelled "All staff" on
   mobile. [#53](https://github.com/KNSTNTN24/blueroll-web/issues/53)
3. **The literal `'none'` is not NULL.** `compute_entitlement` checks `s IS NOT NULL` to decide `canceled` vs `none`, so
   a `'none'` source turns a never-paid business into `canceled`.
4. **Overrides are unvalidated.** `roles.capabilities` rejects unknown names, `member_capability_overrides.capability`
   does not. A typo there grants nothing and fails silently. Nothing writes overrides yet (roles page Gotcha 2).
5. **`sites.status='archived'` exists only in `billable_site_count`.** The UI writes `removed`, so a removed site would stay billed, and `generate_checklist_instances` ignores status
   altogether (116 instances in the last 7 days on non-`active` sites, all `onboarding`; no `removed` site exists yet).
   [#74](https://github.com/KNSTNTN24/blueroll-web/issues/74)
6. **Case differs per set on purpose.** Incident category and dietary flags are Title-case, allergens/sections/methods
   are lowercase snake, days are `Mon`. Copy from the constant, don't guess.
7. **Notification types are a free-for-all.** Readers accept aliases nobody writes and one writer (`haccp`) is never called.
   Fix the list when [#88](https://github.com/KNSTNTN24/blueroll-web/issues/88)/[#108](https://github.com/KNSTNTN24/blueroll-web/issues/108) land.
8. **Several CHECKs exist only live** (`incidents_category_chk`, `incidents_severity_chk`, the columns themselves). A DB
   rebuilt from the repo migrations would accept anything. [#59](https://github.com/KNSTNTN24/blueroll-web/issues/59)

## History

- 2026-10-13 — value drift catalogued in [#60](https://github.com/KNSTNTN24/blueroll-web/issues/60) (normalise + CHECKs).
- 2026-10-10…12 — channels: `source`, `corrective_status`, `kind`, `status` CHECKs added with their tables (`20261010120000_whatsapp_channel.sql`, `20261011130000_channel_groups.sql`, `20261012140000_whatsapp_teams.sql`).
- 2026-07-14 — RBAC: `roles.base_tier` CHECK, `capability_catalog` + trigger (`20260714130000_rbac_schema.sql`).
- 2026-06-07 — subscription arbitration: per-source `*_status` columns, backfill (`20260607120100_subscription_arbitration.sql`).
- 2026-06-08 — `initials` item type (`20260608090000_checklist_item_type_initials.sql`).
- Initial schema — role, frequency, item type, recipe category/unit, incident type CHECKs (`001_initial_schema.sql`).
