# Blueroll Web — HACCP Management Platform

Desktop-first SaaS web application for food safety and HACCP management, built as a full port of the Blueroll Flutter mobile app. Shares the same Supabase backend — a user created on mobile logs in on web and sees the same data.

- **Production**: https://app.blueroll.app
- **Repository**: https://github.com/KNSTNTN24/blueroll-web
- **Mobile repo**: https://github.com/KNSTNTN24/haccp-mobile
- **Landing**: https://blueroll.app (GitHub Pages from mariaiontseva/blueroll-landing)
- **Supabase project**: `rszrggreuarvodcqeqrj`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) + TypeScript |
| Styling | Tailwind CSS + shadcn/ui (base-ui) |
| Backend | Supabase (PostgreSQL + Auth + RLS + Storage + Edge Functions) |
| Server State | TanStack Query v5 |
| Client State | Zustand |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| PDF Export | @react-pdf/renderer |
| Notifications | Sonner |
| Icons | Lucide React |
| Date Utils | date-fns |
| Hosting | Vercel |
| Domain | app.blueroll.app (CNAME → cname.vercel-dns.com) |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# 3. Run dev server
npm run dev

# 4. Open http://localhost:3000
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key |

Both are set in Vercel project settings for production.

## Architecture

### Auth Flow
- New user → `/onboarding` → name → choice (new business / join team) → postcode search or invite code → pain points → signup → dashboard
- Existing user → `/login` → email/password → dashboard
- Join team flow: invite code generated in Team page (case-sensitive, 32 chars) → new user enters during onboarding
- After signup: `setup_business` RPC (new) or `join_with_invite` RPC (join) → full page reload to `/dashboard`
- Default HACCP checklists (5 templates) seeded automatically for new businesses

### Menu Logic
- **Active recipe = menu item**. No separate `menu_items` table for display.
- Menu page shows two tabs: Recipes (active recipes grouped by category) and Allergens (14 EU allergen matrix)
- Toggle active/inactive from Menu or Recipes pages — same effect
- CSV and PDF export available from both Menu and Allergens pages

### Domain Setup
- Landing `blueroll.app` → GitHub Pages (mariaiontseva/blueroll-landing, branch `gh-pages`)
- Web app `app.blueroll.app` → Vercel (CNAME record `app` → `cname.vercel-dns.com`)
- DNS managed at GoDaddy (ns33/ns34.domaincontrol.com)

## Feature Parity Checklist (vs Mobile)

| Feature | Status | Notes |
|---------|--------|-------|
| **Onboarding** | ✅ | FSA postcode lookup, business selection, rating reveal, pain-points funnel, signup. Matches mobile flow order. |
| **Auth** | ✅ | Email/password login, signup with invite code support |
| **Dashboard** | ✅ | Metrics cards, check-in with mood, tasks list, incidents panel, notifications |
| **Checklists — List** | ✅ | Today + Library tabs, active toggles, data table |
| **Checklists — Detail** | ✅ | Fill with all item types (tick, temp, text, yes_no), auto-flagging, sign-off |
| **Checklists — Manage** | ✅ | Create/edit with all fields, item types, temperature ranges |
| **Checklists — History** | ✅ | Expandable completion cards with response details |
| **Default Checklists** | ✅ | 5 UK HACCP templates seeded on new business creation |
| **Recipes — List** | ✅ | Data table with category filter, search, allergen badges |
| **Recipes — Detail** | ✅ | Full view with ingredients, allergens, dietary labels |
| **Recipes — New/Edit** | ✅ | Full form with dynamic ingredients and allergen selection |
| **AI Recipe Import** | ✅ | Three-tab input (text/PDF/photo), Edge Function call, preview and save |
| **Menu** | ✅ | Two tabs (Recipes + Allergens) matching mobile. Active recipes = menu. |
| **Allergen Matrix** | ✅ | Matrix table with 14 EU allergens, card view, CSV/PDF export |
| **Reports** | ✅ | Date range picker, template selection, summary stats |
| **Team** | ✅ | Data table with roles, invite with token + instructions matching mobile |
| **Incidents** | ✅ | Tabbed list, create/edit/resolve dialogs, status badges |
| **Deliveries** | ✅ | Table with supplier info, new delivery form |
| **Suppliers** | ✅ | Table with all fields, add/edit/delete dialogs |
| **Documents** | ✅ | Category filter, search, upload form, detail with access management |
| **Diary** | ✅ | Date picker, timeline of day's activity |
| **Notifications** | ✅ | List with type-specific icons, mark read, mark all read |
| **Settings/Profile** | ✅ | Profile editing, business info, sign out |
| **Check-in/Check-out** | ✅ | Dashboard-integrated with mood emojis |
| **Payments** | ⏳ | Stripe integration planned (mobile uses native IAP) |

## Project Structure

```
src/
├── app/
│   ├── (auth)/           # Login, onboarding (no sidebar)
│   ├── (dashboard)/      # All authenticated pages (sidebar + topbar)
│   │   ├── dashboard/
│   │   ├── checklists/   # list, [id], [id]/history, new, edit/[id]
│   │   ├── recipes/      # list, [id], new, edit/[id], import
│   │   ├── allergens/
│   │   ├── menu/         # Recipes + Allergens tabs (active recipes = menu)
│   │   ├── reports/
│   │   ├── team/
│   │   ├── incidents/
│   │   ├── deliveries/   # list, new
│   │   ├── suppliers/
│   │   ├── documents/    # list, [id], upload
│   │   ├── diary/
│   │   ├── notifications/
│   │   └── settings/
│   └── layout.tsx
├── components/
│   ├── layout/           # Sidebar, Topbar, CommandPalette, PageHeader
│   ├── shared/           # EmptyState, StatusBadge
│   └── ui/               # shadcn/ui components
├── hooks/                # useAuth hook
├── lib/                  # Supabase client, constants, utilities
├── stores/               # Zustand auth store
└── types/                # Database type definitions
```

## Deployment

Deployed to Vercel. Auto-deploys on push to `main` are NOT enabled — deploy manually:

```bash
npx vercel --prod
```

Environment variables set in Vercel project settings:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Known Issues / TODO

- [ ] Stripe integration for web payments (mobile uses native Apple/Google IAP)
- [ ] Sidebar doesn't collapse responsively with content area padding
- [ ] Photo upload in checklists shows "available on mobile" placeholder
- [ ] Recipe edit page not yet implemented (new page works)
