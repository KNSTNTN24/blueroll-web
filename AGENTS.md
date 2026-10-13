<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Blueroll web — map for developers and AI assistants

Blueroll is a food-safety (HACCP / FSA *Safer Food, Better Business*) app for UK food businesses: daily checklists,
recipes and allergens, suppliers and deliveries, documents, incidents, and an inspector-ready HACCP Pack and Plan.
This repo is the web app **and** the shared backend (Supabase migrations and edge functions). The mobile app
(Flutter) is a separate repo and talks to the same database.

## Read before you change anything

1. **`docs/domain/README.md`** — what every entity and rule *is*, its parameters and allowed values, who may do what,
   and the gotchas. Find the page for the thing you are about to touch and read it first.
2. **`docs/domain/concepts/roles-and-capabilities.md`** and **`concepts/periods-and-due-checks.md`** — the two rules
   that most changes get wrong (permissions; when a check is due/done/missed).
3. **Specs** in `docs/superpowers/specs/` — *why* a feature was built the way it was (history, newest by date).
4. Open issues on GitHub (`gh issue list`) — known bugs; many are linked from the domain pages' *Gotchas*.
5. **`docs/handoff-2026-10.md`** — what changed in October 2026 (new docs, working rules, recent features, open issues).

When you change how something behaves, **update its `docs/domain/` page in the same PR**. When the live database and
the docs or the repo disagree, the live database wins — several objects exist only in production (see issue #59).

## Systems

| System | Where | Notes |
|---|---|---|
| Web app (Next.js 16 App Router, TS, Tailwind, shadcn/ui, TanStack Query) | this repo, `src/` | prod https://app.blueroll.app (Vercel, deploys on push to `main`) |
| Database, auth, storage | Supabase project `rszrggreuarvodcqeqrj` | schema in `supabase/migrations/`; RLS everywhere; some objects are live-only |
| Edge functions (Deno) | `supabase/functions/` | shared code in `_shared/`; deployed manually (below) |
| Mobile app (Flutter, App Store + Google Play) | repo `KNSTNTN24/haccp-mobile` | same DB; often behaves differently — check the domain page |
| CRM API (Python) | repo `KNSTNTN24/blueroll-crm` on Railway | outreach tools, letters, QR tracking |
| Landing + public tools | repo `mariaiontseva/blueroll-landing` (GitHub Pages) | https://blueroll.app |
| Messaging | WhatsApp Cloud API, Telegram Bot API | see `docs/domain/concepts/channels.md` |
| Payments | Stripe (web), App Store / Google Play (mobile) | see `docs/domain/concepts/subscription-and-entitlement.md` |
| Email | Resend | invites, feedback |
| AI | Anthropic API (setup assistant, recipe import, checklist wizard) | |

## Code map

| Area | Location |
|---|---|
| Pages | `src/app/(dashboard)/<feature>/` — checklists, recipes, menu, allergens, suppliers, deliveries, documents, incidents, team, haccp-pack, haccp-setup, reports, diary, settings; auth & onboarding in `src/app/(auth)/` |
| Shared logic | `src/lib/` — `permissions.ts`, `constants.ts`, `checklist-status.ts`, `dishes.ts`, `dietary.ts`, `haccp-pack/`, `haccp-plan/`, `haccp-setup/`, `whatsapp/` |
| Auth & current user/business/site | `src/hooks/use-auth.ts`, `src/stores/` |
| UI kit | `src/components/ui/` (shadcn), feature components in `src/components/` |
| Edge functions | `supabase/functions/<name>/`, shared in `supabase/functions/_shared/` (`checklists-core`, `channels`, `haccp-plan`, `assistant-core.ts`, `draft-method.ts`) |
| Migrations | `supabase/migrations/` (timestamped) |

## Commands

```bash
npm run dev      # local dev server
npm test         # vitest
npm run build    # production build (run before a PR)
npm run lint
```

Edge function tests: `deno test supabase/functions/...`. Type-check a function: `deno check supabase/functions/<name>/index.ts`.

## Workflow

- Branches `KNS/*` (Maria works in her own branches) → PR → squash merge to `main` → Vercel deploys.
- Edge functions: `SUPABASE_ACCESS_TOKEN=<token> supabase functions deploy <name> --project-ref rszrggreuarvodcqeqrj --no-verify-jwt`
  (functions verify the caller themselves — every new function **must** check the user; see issues #64, #83).
- Migrations: apply to prod deliberately (Supabase CLI or Management API) and keep the repo in step — don't change prod
  without a migration file.
- Secrets never go into the repo (keys live in `.env.local`, Supabase secrets, Vercel env).

## Conventions

- Permissions: check **capabilities** (`has_capability` in SQL), not the tier text in `profiles.role` — the UI still uses
  the tier in many places (issue #55); don't add new tier checks.
- Data is scoped by **business**, then **site** (`site_id`, `can_see_site_row`); see `docs/domain/entities/site.md`.
- Writes are blocked for businesses without an active subscription (`entitlement_write_gate_*` policies).
- Plain-English UI copy, British spelling.
