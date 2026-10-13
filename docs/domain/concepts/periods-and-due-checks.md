# Periods, due checks and missed checks

> When a checklist is *due*, *done*, *overdue* or *missed* — and why eight places in Blueroll answer that differently.

**Touches:** [Checklist template](../entities/checklist-template.md) (`frequency`, `deadline_time`, `multi_per_day`, `min_per_day`),
[Checklist completion](../entities/checklist-completion.md) (`completed_at`, `checklist_instances`), [Site](../entities/site.md) (`timezone`) ·
**Last verified:** 2026-10-13 (review pass) against `main@b50e9d1` and the live DB (`rszrggreuarvodcqeqrj`) · **Issue:** [#58](https://github.com/KNSTNTN24/blueroll-web/issues/58)

## The rule in plain words

There is **no single rule**. Every layer recomputes "the current period" itself, with its own clock and its own idea of
`four_weekly` and `custom`. Only the database stores anything (`checklist_instances`); everything else is computed on the fly.
Read this page before changing any of it, and change all layers together or none.

```
period(template, t)  = the window [start, end) that contains t, by template.frequency   -- differs per layer, table A
done(period, site)   = completions of the template in that period (at that site) >= need  -- need = min_per_day per day if multi_per_day, else 1
overdue              = not done AND clock > today's deadline_time                          -- UI and channels only; never stored
missed               = the period has ended AND not done                                   -- stored only by SQL (instances.status='missed')
```

## A. Period definitions per layer

| Layer | daily | weekly | monthly | four_weekly | custom | Time zone |
|---|---|---|---|---|---|---|
| **SQL instances** — cron `generate-checklist-instances` (01:10 UTC) → `generate_checklist_instances(null, today−2, today+1)` + `link_checklist_instances`; trigger `_link_completion_instance` (`supabase/migrations/20260708140000_checklist_instances.sql:22-95`, identical live) | calendar day | `date_trunc('week')` = Mon–Sun | calendar month | **calendar month** | **daily** | **UTC** (`completed_at::date`, DB `TimeZone = UTC`) |
| **Web fill page + list** — `checklists/[id]/page.tsx:14-19`, `checklists/page.tsx:19-29,115-122`, `src/lib/checklist-status.ts` | today 00:00 | Monday 00:00 | 1st 00:00 | **rolling**: Monday of this week − 21 days | today | **browser** |
| **Web dashboard** — `dashboard/page.tsx:22-28,85,89`; estate `dashboard/estate-dashboard.tsx:35-36,72` | same starts as above, but only completions **since today 00:00** are loaded | ← (so a weekly done yesterday is "Pending") | ← | ← | ← | browser |
| **Edge / channels** — `_shared/checklists-core/time.ts:31-55`, `due.ts:13-32`, `reminders.ts:25-37`, `_shared/channels/team-day.ts` | today 00:00 | Monday 00:00 | 1st 00:00 | rolling, Monday − 21 days | today | **`sites.timezone`** (live: all 107 sites `Europe/London`, column default) |
| **Mobile Today / list / fill** — `haccp-mobile/lib/models/checklist.dart:3-24,247-271`, `screens/checklists/checklists_screen.dart:150-180` | today | Monday | 1st | **fixed 28-day cycles from 2024-01-01** | list: since 1970 (= **done forever** after one fill); fill screen: no period check | **device** |
| **Mobile History** — `haccp-mobile/lib/features/checks/history_score.dart:21-87` | that day | Monday of that day | 1st | 28-day cycles, counted in UTC | **excluded** | device |
| **Reports** — `reports/page.tsx:83,112-143` + RPC `report_due` | uses SQL instances (`due_date` in range) | ← | ← | ← | ← | range in browser time, instances in UTC |
| **HACCP Plan** — `_shared/haccp-plan/aggregate.ts:32-54,81,96-99`, `load.ts:52-57,94-97` | no own period: a 28-day grid of site-local days | — | — | — | — | completions: site tz; instances: UTC `due_date` |

## B. Deadline, several-a-day, done, overdue/missed and site, per layer

| Layer | `deadline_time` | `multi_per_day` / `min_per_day` | "Done" means | "Overdue" / "missed" | Site |
|---|---|---|---|---|---|
| SQL instances | ignored | ignored: one instance per period; the **first** completion completes it | any completion in the UTC period at the same site (earliest is linked) | `missed` when `period_end < current_date` at the 01:10 run and no completion; no overdue | every active template × **every** site of the business (no site status filter); `site_id` null fans out |
| Web fill + list | list: "Overdue" when nothing in the period and the browser clock is past **today's** deadline — for **any** frequency (`checklist-status.ts:20-26,41-43`) | period forced to today (`checklists/page.tsx:117`); done when n ≥ min; min 0 = always done; never Overdue (`checklist-status.ts:33-38`) | ≥ 1 completion since period start; "Awaiting sign-off" counts as done (`:46`) | Overdue only; no missed | list: current site (`checklists/page.tsx:100`); fill page "already done": **business-wide** (`[id]/page.tsx:49`, [#78](https://github.com/KNSTNTN24/blueroll-web/issues/78)) |
| Web dashboard | Overdue = Pending and past deadline (`dashboard/page.tsx:93`) | ignored: one completion = Done | a completion **today** | site: Overdue; estate: "overdue" = active templates at the site − completions today (`estate-dashboard.tsx:47-48,72`) | current site; estate per site, `site_id` null templates not counted |
| Edge / channels | today's deadline in site tz; overdue after it; Telegram groups remind 30 min before (`reminders.ts:4,33`); team overdue window 1 h (`team-day.ts:13`) | per day; need = `min_per_day`, 0 → never due (`due.ts:18-20`); team takes keyed `period#n` (`team-day.ts:74-77`) | completions at **that site** since period start ≥ need (`due.ts:22-24`) | overdue flag; WhatsApp team summary "missed" = still open at summary time for daily, multi-per-day or **any template with a deadline** (`team-day.ts:26,88-90`) | strict per site |
| Mobile list / fill | Overdue by device clock, today's deadline (`checklist.dart:259-268`) | today's count ≥ min (`checklist.dart:251-257`) | latest completion ≥ period start (`checklists_screen.dart:164-171`) | Overdue only | list: current site; fill "already done": business-wide (`checklist_detail_screen.dart:243-257`) |
| Mobile History | ignored | ignored ("was it done", counts once, `history_score.dart:81-83`) | a completion between period start and the end of that day | day score done/total; templates created after the day excluded | providers are site-scoped (`history_tab.dart:29`) |
| Reports | — | instances count 1 per day, completions count every fill | completion rows with `completed_at` in range | **Missed = max(0, due − completed)**, due = instances of **any** status | `p_site` = current site, null = all |
| HACCP Plan | ignored | ignored | day is "ok" if any completion on that site-local day | instance `status='missed'`, shown on its `due_date` cell | `bySite` filter; business-wide templates included |

## Worked examples

**1. Weekly "Deep clean", site in London, British Summer Time (UTC+1).**
- Done **Sunday 23:30** (= Sunday 22:30 UTC): every layer agrees — it counts for the week that is ending.
- Done **Monday 00:30** (= Sunday 23:30 UTC): web, mobile and channels say *this* week is done. SQL puts it in the
  *previous* UTC week: the trigger completes last week's instance, this week's instance stays `pending` and becomes `missed`
  on the Tuesday after the week ends — while every screen said "Completed" all week. Same for daily checks done
  00:00–01:00 BST: 32 live completions (all daily) fall on a different date in London than in UTC.

**2. Four-weekly "Management review", last done Friday 25 Sep 2026, looked at on Tuesday 13 Oct 2026.**
- Web / channels: window starts Monday 21 Sep → **Completed**. From Monday 19 Oct the window starts 28 Sep → Pending again.
- Mobile: cycle 5 Oct – 1 Nov → **Pending** (Overdue if it has a deadline).
- SQL: October instance (1 Oct – 1 Nov) → `pending`, `missed` on 2 Nov if nothing is done in October (UTC).
- HACCP Plan lists it under "Monthly" (`src/lib/haccp-plan/build.ts:165`).

**3. "Fridge temps" daily, `multi_per_day`, `min_per_day = 2`, deadline 14:00; one fill at 09:00.**
- Web / mobile: "1/2 today", never Overdue. Channels: still due; Telegram group reminder 13:30–14:00, overdue after 14:00;
  the next WhatsApp team take is `2026-10-13#2`.
- SQL: the 09:00 fill completes the day's instance → **never missed**. Live: 288 of 2,092 — counting, for each
  multi-per-day template, site and UTC date with completions, the days with fewer completions than `min_per_day`.
- Reports: 1 due, 1 completed → 100%. If staff fill it 3 times, 3 completions offset 2 real misses elsewhere in the total.

**4. `custom` ("As needed", `haccp-setup/draft-review.tsx:16`).** SQL and web schedule it **daily** (3,266 live `missed`
custom instances); mobile History ignores it; the mobile list shows it "Completed" forever after the first fill.

## Proposal, not implemented

One definition, owned by the database, read by everyone:

1. SQL function `checklist_period(frequency, at timestamptz, tz text) → (start date, end date)` in **`sites.timezone`**:
   daily = local day; weekly = Monday–Sunday; monthly = calendar month; four_weekly = fixed 28-day cycles from Monday
   2024-01-01 (what mobile already does — predictable for staff and EHOs); **custom = no period**: never due, never missed.
2. **Done** = completions at that site in the period ≥ need (need = `min_per_day` per day for multi-per-day, else 1).
   Sign-off is a separate state, not part of "done".
3. **Overdue** = not done and site-local now > `deadline_time` on the **last day** of the period (daily = today).
   **Missed** = the site-local period has ended and it is not done.
4. Instances only from the template's activation date and only for `active` sites; the cron in a migration ([#59](https://github.com/KNSTNTN24/blueroll-web/issues/59)),
   run hourly so each site's midnight is handled. Clients and edge call one RPC (e.g. `due_now(site)`) instead of recomputing.

## Gotchas

1. **UTC in SQL, local everywhere else.** Anything done 00:00–01:00 BST belongs to the previous day/week in instances,
   Reports and HACCP Plan "missed" — example 1.
2. **`four_weekly` has three meanings** (calendar month, rolling 22–28 days, fixed 28-day cycles) — example 2.
3. **`custom` is daily, "no period" or "done forever"** depending on the layer — example 4.
4. **SQL ignores `multi_per_day`**: the first fill completes the instance — example 3. Non-daily templates with
   `multi_per_day` have the same split — 77 live (74 `custom`, 2 weekly, 1 monthly; 17 of the `custom` ones active):
   counted per day by web/edge and per period by SQL.
5. **The deadline applies every day, whatever the frequency.** A weekly check with 10:00 shows "Overdue" from 10:00 each
   day until done; channels re-remind daily and the WhatsApp team summary lists it as "missed" each evening.
6. **The site dashboard only loads today's completions** (`dashboard/page.tsx:85`) but compares them with weekly/monthly
   period starts (`:89`), so a weekly check done on Monday is "Pending"/"Overdue" there from Tuesday while `/checklists`
   says Completed; one fill of a multi-per-day check counts as Done.
7. **Estate dashboard "overdue" ignores frequency**: active templates per site minus completions today
   (`estate-dashboard.tsx:72`) — a weekly check is "overdue" every day it is not repeated.
8. **"Missed" lags by a day.** A daily instance for yesterday has `period_end = today`, so `period_end < current_date` is
   false at today's run; it turns `missed` tomorrow. Reports count `pending` instances as due anyway.
9. **Instances exist for days before the template did and for onboarding sites.** The generator back-fills today−2 and
   ignores `created_at` and `sites.status`: 9,435 live instances predate their template's creation; 1,980 `missed` are on
   `onboarding` sites. Part of why 30,796 of 44,982 instances are `missed`.
10. **Reports compare different clocks.** Due = instances whose *period start* is in the range; completed = completions
    whose `completed_at` is in it. "Today" on a Tuesday has 0 weekly due (instance is Monday's) but 1 weekly completed.
    `periodsInRange` (`reports/page.tsx:21-27`) is dead code from the old estimate.
11. **HACCP Plan** puts a missed weekly/monthly instance only on its first day's cell, and mixes site-local completion
    days with UTC instance days.
12. **"Already done" on the fill page ignores the site** on web and mobile ([#78](https://github.com/KNSTNTN24/blueroll-web/issues/78)); the mobile fill screen skips the check for `custom`.
13. **The trigger only runs on INSERT** and swallows every error: changing `completed_at` later ([#71](https://github.com/KNSTNTN24/blueroll-web/issues/71)) does not move the instance.
14. **Mobile `getPeriodStart` four-weekly** uses a local-time `difference().inDays` (`checklist.dart:17-20`); during BST
    00:00–01:00 on a cycle's first day it returns the previous cycle *(from code reading)*. History fixed this with UTC.
15. **Web `completed_at` is the browser clock** (`checklists/[id]/page.tsx:119`): 24 live completions are dated in the future.

## History

- 2026-10-12 WhatsApp teams: takes per `period_key`, day summary "missed" (`2026-10-12-whatsapp-teams-design.md`).
- 2026-10-11 HACCP Plan reads instances (`2026-10-11-haccp-plan-document-design.md`).
- 2026-10-09 channels: `checklists-core/time.ts` brings site time zones (`sites.timezone`, `20261010120000_whatsapp_channel.sql:8`).
- 2026-07-08 `checklist_instances`, trigger and `report_due` replace the Reports estimate (`20260708140000`, `20260708150000`).
- 2026-06-07 counter model for multi-per-day and Overdue (`2026-06-07-v-next-fixes-design.md`).
