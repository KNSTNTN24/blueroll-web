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

Planned (not written yet): Recipe, Ingredient, Menu, Supplier, Delivery, HACCP Pack,
Setup session, HACCP Plan, Incident, Training record, Channel identity, Channel group, Notification;
concepts: business vs site scoping, periods & missed checks, out-of-range & corrective action, sign-off,
SFBB sections / safe methods / recipe HACCP methods, allergens & dietary, channels, entitlement,
soft delete, auto-fill, FSA/FHRS rating, checklist library.

## Conventions

- English, plain words. Name things as the product does (UI label) and give the DB name in `code`.
- Every factual claim about behaviour cites where it lives: `path:line` in the repo, or the DB object
  (`function public.has_capability`, policy `documents_select`). No citation → mark it *(unverified)*.
- **Values**: list allowed values, say where they are enforced (DB `CHECK` / code constant / nowhere),
  and record values found in live data that break the rule under *Known drift*.
- **Gotchas** are the most valuable section. If something surprised you, write it down.
- Keep pages short: link instead of repeating. One page per entity or concept.
