# WhatsApp teams — rulings and deferred follow-ups (from SDD ledger, 2026-10-12)

## Rulings
- Ruling: F1 staff `team` → TEAM_TEXT.onlyManagers ("Only managers can add people to teams."), drop onlyManagersTeam — spec §6 wins — cost: none. (Task 8)
- Ruling: F2 morning list ALWAYS uses checklist_reminder_list, never checklist_reminder — spec §5 — cost if wrong: one-item mornings read slightly odd. (Task 6)
- Ruling: F3 morning button label stays "Show checks" (approved template, spec §10 reuse unchanged) — spec erratum, no code — cost: none.
- Ruling: F4 takes: keep PK (group,template,site,period) but claim a take for EVERY active team mapping that template at that site in one multi-row INSERT (all-or-nothing); add concurrent two-team test — spec §2 "never both record" — cost: one extra query per submit. (Tasks 1/3/7)
- Ruling: F5 Task 7 Step 9 grep limited to bot.ts, db.ts, bot.test.ts — plan grep was unsatisfiable — cost: none.
- Ruling: F6 Task 9 Step 7 grep drops revokeIdentity — it is a live Task 7 fake method — cost: none.
- Ruling: F7 Global Constraints amended: Task 9 may delete the 3 client.test.ts tests; Task 7 may edit alerts.test.ts (Telegram tests in it must keep passing) — cost: none.
- Ruling: F8 Task 3 extracts shared makeCoreDb(admin) in db.ts reused by db.ts and teams-db.ts; firstNames/completionsSince/TEMPLATE_COLS shared with groups-db.ts via export, not copy — avoid verbatim duplication — cost: Task 3 touches db.ts/groups-db.ts (tests must stay green).
- Ruling: F9 bot unavailable text reuses TEAM_TEXT.unavailable — cost: none. (Task 7)
- Ruling: F10 name cap 60 in both team-admin and team-api — cost: none. (Task 9)
- Ruling: F11 overdue nudge only within 1 h after the deadline; summary time capped 23:50 local — recorded here as rulings — cost if wrong: a nudge missed when cron is down >1 h.
- Ruling: F12 Tasks 3–5 add their new files to the deno check line (deno check <file>) — cost: none.
- Ruling: F13 no pushes by implementers; controller pushes/opens PR only in Task 12 after Kostya's «да» — cost: none.
- Ruling: F14 Task 7 concurrent-submit test must not assert the loser's menu header order-dependently (assert "Already done ✓ by" + no second completion) — cost: none.
- Ruling: activeMemberships skips teams at soft-removed sites too (real + fake) — consistent with removed_at ruling — cost: none.
- Ruling: I1 — managers' missed-summary APP notification gets its own claim (separate event kind), created once even when team_day_summary isn't approved / WhatsApp send fails; the WhatsApp day_end claim keeps release-on-failure — spec §5 "always an app notification" beats plan Review Focus 5 wording — cost if wrong: none (no duplicate app notifications thanks to own claim).
- Ruling: M2 cheap budget fixes in this task: skip a team early when nothing can be due this run, cache completions per business within a run, timeout on the Meta fetch — 60 s cron budget shared with Telegram step — cost: small diff.
- Ruling: I1 — port the 4 tests (3-pending-corrective cap, no corrective Flow → completion still recorded, two out-of-range → two corrective forms, Telegram alert log rows channel/billable) into the new suites — Global Constraints only allowed deleting role-based/LINK tests; same ruling as Telegram plan — cost: more tests.
- Ruling (Kostya 12.10, option 2): D1 — missed summary (WhatsApp + app notification) goes to owners (all teams) and to managers of the team's site only — cost if wrong: a business-wide manager without site assignment misses summaries.
- Ruling: final fix wave also takes cheap follow-ups: >10 teams cut silently (say "+N more"/use list), whatsapp-team-member getUser/profile inside try (CORS on 500), errText for PostgrestError, pin whatsapp-team-member verify_jwt=false in supabase/config.toml, Join moving a number marks that phone's memberships in other businesses removed — cost: small diff.

## Deferred minors / residuals
- Task 1: minor (deferred): guard triggers don't lock id (add new.id is distinct from old.id)
- Task 1: minor (deferred, CARRY to Tasks 3/4/6/10): sites are soft-removed (sites.removed_at) — planner, menus, Settings must skip removed sites
- Task 1: minor (deferred): verify script lacks F4 two-team take case, INSERT stamping, unlink, cross-business site_id; bare NOT NULL if demo business has no template
- Task 1: minor (deferred): managers can update members of an unlinked team (harmless)
- Task 2: minor (deferred): contacts branch wa_id||phone fallback; parseStatuses emits id '' when missing; tests written after impl (no RED)
- Task 2: minor (deferred, CARRY to Task 8): shared contact name may be '' → use "New person"
- Task 3: minor (deferred): fake claimTake doesn't check site removal (real doesn't either)
- Task 4: minor (deferred, CARRY to Tasks 6/7): planner doesn't filter templates by site — callers must pass only active templates with site_id null or = team site
- Task 4: minor (deferred): done/min_per_day=0/weekly deadlines still shift morning & summary; 00:00-00:59 deadline → morning previous day; 1h offsets in absolute ms across DST hour; summaryParams {{5}} could be '' (safe: only fires when something open); test gaps (non-London cap, weekly, multiple overdue)
- Task 5: minor (deferred, FINAL REVIEW): sendTracked flags unreachable on 131047 for any send incl. replies (131047 = 24h window closed, not unreachable) — consider limiting to template sends
- Task 5: minor (deferred): setUnreachable by phone across businesses; Join silently revokes other business identity (no notice there); test gaps (Join on active, inviter notify fallback, too_soon via addPersonToTeam); no RED evidence
- Task 6: minor (deferred): M1 one overdue/summary claim per team — a member whose send fails transiently while others succeed never gets it
- Task 6: minor (deferred, ASK KOSTYA at finish): M3 managerContacts business-wide → a chain manager gets every team's missed summary (Bobo 7+ paid templates/day)
- Task 6: minor (deferred): M4 celebrateTeam never releases day_end claim (comment it); M5 cron response field sent→teams (controller verified: cron SQL doesn't read the body)
- Task 6: minor (deferred): notifyManagers throwing after day_end_app claim loses that day's app notification; makeSender 10 s timeout applies to all senders (delivered-but-timed-out can resend, same exposure as network error)
- Task 7: minor (deferred): concurrent last-two submits → no 🎉 (and no summary since all done); multi-per-day slot #2 shows "Already done" while slot #1 claimed but unrecorded; pending correctives re-offered only for team sites (product call, disclosed)
- Task 8: minor (deferred): picker slices teams to 10 silently (11th never offered); no forged add:<foreign group> test (rm tested, same check); `team` uncapped messages / duplicate titles on buttons; rmyes ignores removeMember result
- Task 9: minor (deferred): cleanName imported from team-admin (move to team-text); Team column shows "Invited" after 14-day expiry; getUser/profile lookup outside try/catch (500 without CORS); addTeamPerson outcome unchecked; team-create-channel-member now unused (decide at launch whether to undeploy)
- Task 10: minor (deferred): Resend/Remove/Delete no busy state (double click); errText may show [object Object] for PostgrestError; saving checklists remounts card (loses open Add form); a11y: Resend/Remove buttons unnamed, radios without fieldset; no component tests / visual check
- FINAL fix wave: commits bbb3456..8c99301 (7 items); re-review: all ADDRESSED, no new Critical/Important. Residual (surface to Kostya): `team` overview "Remove <first name>" rows can repeat (two people same first name) → Meta rejects that list. Minor: failed recipient lookup loses the day's app summary; failed Join cleanup can leave stale rows elsewhere.
