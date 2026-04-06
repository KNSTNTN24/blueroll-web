# Blueroll Web v2 — HACCP Management Platform

Desktop-first SaaS web application for food safety and HACCP management. Full port of the Blueroll Flutter mobile app with new features. Shares the same Supabase backend — data syncs between mobile and web.

- **Production**: https://app.blueroll.app
- **Repository**: https://github.com/KNSTNTN24/blueroll-web (branch: `v2`)
- **Mobile repo**: https://github.com/KNSTNTN24/haccp-mobile
- **Landing**: https://blueroll.app (GitHub Pages, mariaiontseva/blueroll-landing)
- **Supabase project**: `rszrggreuarvodcqeqrj`

## Setup

```bash
npm install
cp .env.example .env.local   # add SUPABASE_URL + ANON_KEY
npm run dev                   # http://localhost:3000
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://rszrggreuarvodcqeqrj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |

## Tech Stack

Next.js 15 · TypeScript · Tailwind CSS · shadcn/ui · Supabase · TanStack Query · Zustand · React Hook Form + Zod · Sonner · Lucide · date-fns

## Features (17)

| # | Feature | Status |
|---|---------|--------|
| 1 | Auth (login, signup, invite join) | ✅ |
| 2 | Onboarding (FSA lookup, 7-step new / 5-step join, paywall) | ✅ |
| 3 | Dashboard (metrics, check-in, tasks, incidents, notifications) | ✅ |
| 4 | Checklists (list, fill, history, create/edit, 6 default templates) | ✅ |
| 5 | Recipes (CRUD, allergens, dietary, freezing/defrosting fields) | ✅ |
| 6 | AI Recipe Import (text/PDF/photo → Claude API) | ✅ |
| 7 | Menu (active recipes = menu, Recipes + Allergens tabs, CSV/PDF export) | ✅ |
| 8 | Allergen Matrix (14 EU allergens, card + matrix views, CSV/PDF export) | ✅ |
| 9 | Reports (date range, template filter, compliance %, PDF) | ✅ |
| 10 | Team (members, roles, invite with token + instructions) | ✅ |
| 11 | Incidents (complaint/incident, create/resolve, notifications) | ✅ |
| 12 | Deliveries (log with temp, supplier, photos) | ✅ |
| 13 | Suppliers (CRUD, delivery days) | ✅ |
| 14 | Documents (upload to Storage, categories, expiry tracking) | ✅ |
| 15 | Diary (daily timeline of checklists + incidents) | ✅ |
| 16 | Notifications (10 auto types, mark read) | ✅ |
| 17 | HACCP Pack (5 sections, 26 methods, auto-fill, 4-week review, XP, PDF export) | ✅ |

## New in v2 (vs v1)

- HACCP Pack with live auto-fill from recipes/checklists/suppliers/documents
- Paywall with Stripe integration (test stub active)
- Subscription gating (disabled until Stripe fully configured)
- 6 default checklist templates (including 4-Weekly HACCP Review)
- Recipe fields: freezing_instructions, defrosting_instructions
- 10 notification types (added HACCP review overdue)
- Spec-first architecture: 4 design documents in docs/

## Spec Documents

- `docs/01-DESIGN.md` — UI organization, colors, typography, components
- `docs/02-FEATURES.md` — all 17 features described
- `docs/03-ONBOARDING.md` — onboarding scenarios, edge cases
- `docs/04-DATABASE.md` — 21 tables, RPCs, Edge Functions, storage

## Deployment

```bash
npx vercel --prod
```

Domain: `app.blueroll.app` (CNAME → `cname.vercel-dns.com`)
