# Note for Maria's Claude — what changed in Blueroll web (Oct 2026)

From: Konstantin's Claude session, 2026-10-13. Repo: `KNSTNTN24/blueroll-web`.

## TL;DR

1. There is now a verified domain glossary in **`docs/domain/`** (PR #99) and a generated database reference in
   **`docs/reference/db.md`** (PR #100). Read the page for whatever you are about to touch *before* changing it, and
   update that page in the same PR.
2. **`AGENTS.md` is the entry point** (systems, code map, commands, workflow, conventions). `CLAUDE.md` is now short
   and imports it. The old Russian work log moved to `docs/history.md`; `docs/01–04` are marked outdated.
3. **Issues #50–#117 were filed** from what the documentation work uncovered: #50–#98 from the first pass,
   reference-data issues #101–#111, and follow-ups #112–#117 from the 2026-10-13 review pass (which re-checked the
   domain pages against code and the live DB and corrected them). Check `gh issue list` before starting work in an
   area; many domain-page *Gotchas* link to them.

## Where to start

- `docs/domain/README.md` — index of 17 pages: Business, Site, Member & invite, Checklist template, Checklist
  completion, Document, Recipe, Menu & allergens, Supplier & delivery, HACCP Pack, Set up my HACCP session, HACCP Plan,
  Incident & notification; concepts: roles & capabilities, subscription & entitlement, channels (WhatsApp/Telegram),
  periods & due checks.
- Every page: what it is for, parameters with allowed values and where they're enforced, *Known drift* in live data,
  lifecycle (every create path: web, mobile, edge, RPC, trigger), who can do what (RLS vs UI vs edge), where in code,
  gotchas, history. Verified against `main@b50e9d1` and the live DB on 2026-10-13.
- `docs/reference/db.md` — exact structure (tables, columns, constraints, indexes, RLS, triggers, function signatures
  and grants, cron schedules, storage). Regenerate with
  `SUPABASE_ACCESS_TOKEN=… npx tsx scripts/gen-db-reference.ts` after schema changes (`tsx` is not a devDependency;
  npx will fetch it).

## Rules that changed how we work

- **Live DB wins.** Several objects exist only in production (cron `generate-checklist-instances`, `get_my_role`,
  `remove_member`, some columns and policies) — #59. Check the live DB (read-only) before relying on a migration file.
- **Permissions: use capabilities, not the tier text.** The DB enforces `has_capability(cap)`; most UI still checks
  `profiles.role` in owner/manager (#55). Don't add new tier checks. See `concepts/roles-and-capabilities.md`.
- **Periods are defined several different ways** (DB in UTC, web, edge in site time zone, mobile, reports). Read
  `concepts/periods-and-due-checks.md` before touching anything "due/overdue/missed" (#58, #98).
- **Edge functions are deployed with `--no-verify-jwt`**, so every function must verify the caller itself (several
  don't: #64, #83).
- **Don't `git stash` in worktrees for baseline checks** — the stash list is shared across worktrees of the repo
  (a bare `stash pop` once pulled an old WIP stash into the wrong worktree).
- Edge functions `import-recipe` / `ai-generate-checklist` now use `claude-sonnet-4-6` in the repo too (PR #47) —
  prod had it since June; redeploying from an older checkout would bring back the 404 model.

## Recently shipped (main)

- HACCP Plan document: in-app view, inspector share links, server PDF (PR #37, #38).
- Migration history repaired (#39, #40); allergens text list removed from the pack (#41).
- *Set up my HACCP* v2: single entry on the HACCP Pack page, full question coverage, method context, documents step,
  review with "switch on checklists" (PR #42).
- Own words → plan text: `haccp-assistant` action `draft_method` with deterministic guards (number+unit grounding,
  tick whitelist), 6 optional "Describe…" questions (PR #45, #46).
- WhatsApp teams (team checklists in 1:1 chats) is #49 (not from this session).

## Open issues worth knowing first

- Security (labelled `security`): #64 `create-subscription` has no auth · #65 `send-invite` is an open mail relay ·
  #68 plaintext secret in cron `haccp-drip-hourly` (rotate) · #82 anyone can insert notifications with arbitrary links ·
  #83 AI edge functions have no auth · #51 `document_access` readable by all · #66 any member can update the business row.
  (#63 profile self-update was closed as an accepted risk.)
- Customer-facing: #84 meat dishes auto-labelled Vegan/Vegetarian (dietary derived from allergens only) ·
  #52 editing a checklist template deletes its answer history · #89 ingredient allergens are shared across recipes.
- Data/consistency: #56 mobile never writes `assigned_role_ids` · #60 value drift · #72 stale `subscription_status`.
- If you work on **recipes/menu (chef parity)**: read `entities/recipe.md` and `entities/menu.md` first — #84, #89,
  #90, #91 are in that area (shared ingredients, null `instructions` vs NOT NULL, dishes not editable, mobile
  `maybeSingle` with two dishes per recipe).

## Housekeeping

- An old Supabase access token is in git history (`CLAUDE.md`, commits `cf19a43`, `cd9ab55`); it is not the current
  one — Konstantin will revoke it. Never commit secrets; tokens live in `~/Secrets/…`, Supabase secrets, Vercel env.
- Mobile repo `KNSTNTN24/haccp-mobile` talks to the same DB and often behaves differently — each domain page has a
  web-vs-mobile section.
