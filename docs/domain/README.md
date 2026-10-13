# Blueroll domain docs

What every thing in Blueroll **is**, what its parameters **mean**, and how it connects to the rest.
Written for developers and their AI assistants. Read the page for the thing you are about to touch
*before* changing it, and update the page in the same PR when you change its behaviour.

- **Entities** (`entities/`) — things with identity that live in the database (a checklist template, a document).
- **Concepts** (`concepts/`) — rules that cut across entities and have no table of their own (who may do what, how a check becomes "missed").
- **Templates** — `_template-entity.md`, `_template-concept.md`. Copy one to start a page.

Source of truth, in order: the live database (schema, RLS, functions, cron) → the code on `main` → specs in
`docs/superpowers/specs/` (history: *why* it was built) → these pages (the current picture, with links to all three).
When a page and the database disagree, the database wins and the page has a bug.

## Index

| Page | One line |
|---|---|
| [entities/checklist-template.md](entities/checklist-template.md) | A reusable checklist (items, frequency, who does it, who signs off); the cron turns it into due checks per site. |
| [entities/document.md](entities/document.md) | A file a business keeps for compliance (certificates, policies, contracts), with category, visibility and expiry. |
| [concepts/roles-and-capabilities.md](concepts/roles-and-capabilities.md) | Tiers, roles, capabilities and per-person overrides: how Blueroll decides who may do what, and on which sites. |
| [entities/business.md](entities/business.md) | The customer account: profile, FSA rating, settings, channel switches, soft delete and purge, demo business. |
| [entities/site.md](entities/site.md) | One premises of a business: status, removal, time zone, billing, and which data is per-site vs business-wide. |
| [entities/member.md](entities/member.md) | A person in a business (profile) and how they get there (invite, join, removal, check-ins). |
| [entities/checklist-completion.md](entities/checklist-completion.md) | One fill-in of a checklist: answers, flags, corrective actions, sign-off, drafts, due/missed instances, reports. |
| [concepts/subscription-and-entitlement.md](concepts/subscription-and-entitlement.md) | Stripe / App Store / Google Play / manual sources, trial, grace, what "entitled" unlocks and the paywall. |
| [entities/recipe.md](entities/recipe.md) | A dish's recipe: ingredients and their allergens, dietary flags, HACCP methods, tags, AI import. |
| [entities/menu.md](entities/menu.md) | Dishes on the menu per site, categories, and the allergen & dietary rules shown to customers and inspectors. |
| [entities/supplier-and-delivery.md](entities/supplier-and-delivery.md) | Who supplies food and the goods-in check (temperature, photos) for each delivery. |
| [entities/haccp-pack.md](entities/haccp-pack.md) | The site's SFBB/HACCP answers (5 sections, 26 methods), auto-fill, scope rule, Set up my HACCP, HACCP Plan. |
| [entities/incident-and-notification.md](entities/incident-and-notification.md) | Incidents and complaints; in-app notifications (who creates them, no push/email); barely used diary tables. |
| [entities/setup-session.md](entities/setup-session.md) | *Set up my HACCP*: the questionnaire session, answer kinds, apply (pack + checklists), the AI assistant and its guards. |
| [entities/haccp-plan.md](entities/haccp-plan.md) | The inspector-ready HACCP Plan: sections and where each number comes from, inspector links, PDF, sign-off. |
| [concepts/channels.md](concepts/channels.md) | WhatsApp teams and Telegram groups: linking, consent, daily lists and reminders, forms, first-submit-wins, billing. |
| [concepts/periods-and-due-checks.md](concepts/periods-and-due-checks.md) | What "due", "done", "overdue" and "missed" mean in each layer (DB, web, edge, mobile, reports, Plan) — read before touching schedules. |

Not yet separate pages (covered inside the pages above): business vs site scoping (`site.md`), out-of-range &
corrective action and sign-off (`checklist-completion.md`), SFBB sections / safe methods (`haccp-pack.md`), allergens &
dietary (`menu.md`, `recipe.md`), soft delete, auto-fill (`haccp-pack.md`), FSA/FHRS rating (`business.md`), checklist
library (`setup-session.md`). Candidates for their own pages if they grow.

## Conventions

- English, plain words. Name things as the product does (UI label) and give the DB name in `code`.
- Every factual claim about behaviour cites where it lives: `path:line` in the repo, or the DB object
  (`function public.has_capability`, policy `documents_select`). No citation → mark it *(unverified)*.
- **Values**: list allowed values, say where they are enforced (DB `CHECK` / code constant / nowhere),
  and record values found in live data that break the rule under *Known drift*.
- **Gotchas** are the most valuable section. If something surprised you, write it down.
- Keep pages short: link instead of repeating. One page per entity or concept.
