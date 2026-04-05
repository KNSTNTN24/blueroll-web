# Blueroll Web — HACCP Management Platform

Desktop-first SaaS web application for food safety and HACCP management, built as a full port of the Blueroll Flutter mobile app. Shares the same Supabase backend — a user created on mobile logs in on web and sees the same data.

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

## Feature Parity Checklist (vs Mobile)

| Feature | Status | Notes |
|---------|--------|-------|
| **Onboarding** | ✅ | FSA postcode lookup, business selection, rating reveal, pain-points funnel, signup |
| **Auth** | ✅ | Email/password login, signup with invite code support |
| **Dashboard** | ✅ | Metrics cards, check-in with mood, tasks list, incidents panel, notifications |
| **Checklists — List** | ✅ | Today + Library tabs, active toggles, data table |
| **Checklists — Detail** | ✅ | Fill with all item types (tick, temp, text, yes_no), auto-flagging, sign-off |
| **Checklists — Manage** | ✅ | Create/edit with all fields, item types, temperature ranges |
| **Checklists — History** | ✅ | Expandable completion cards with response details |
| **Recipes — List** | ✅ | Data table with category filter, search, allergen badges |
| **Recipes — Detail** | ✅ | Full view with ingredients, allergens, dietary labels |
| **Recipes — New/Edit** | ✅ | Full form with dynamic ingredients and allergen selection |
| **AI Recipe Import** | ✅ | Three-tab input (text/PDF/photo), Edge Function call, preview and save |
| **Allergen Matrix** | ✅ | Matrix table with 14 EU allergens, card view, CSV export |
| **Menu** | ✅ | Table with category grouping, add/edit items |
| **Reports** | ✅ | Date range picker, template selection, summary stats |
| **Team** | ✅ | Data table with roles, invite dialog with token generation |
| **Incidents** | ✅ | Tabbed list, create/edit/resolve dialogs, status badges |
| **Deliveries** | ✅ | Table with supplier info, new delivery form |
| **Suppliers** | ✅ | Table with all fields, add/edit/delete dialogs |
| **Documents** | ✅ | Category filter, search, upload form, detail with access management |
| **Diary** | ✅ | Date picker, timeline of day's activity |
| **Notifications** | ✅ | List with type-specific icons, mark read, mark all read |
| **Settings/Profile** | ✅ | Profile editing, business info, sign out |
| **Check-in/Check-out** | ✅ | Dashboard-integrated with mood emojis |

## Project Structure

```
src/
├── app/
│   ├── (auth)/           # Login, onboarding (no sidebar)
│   ├── (dashboard)/      # All authenticated pages (sidebar + topbar)
│   │   ├── dashboard/    # Home with metrics, tasks, incidents
│   │   ├── checklists/   # list, [id], [id]/history, new, edit/[id]
│   │   ├── recipes/      # list, [id], new, edit/[id], import
│   │   ├── allergens/    # 14-allergen matrix view
│   │   ├── menu/         # Menu items management
│   │   ├── reports/      # Compliance report generation
│   │   ├── team/         # Staff management + invites
│   │   ├── incidents/    # Incident/complaint tracking
│   │   ├── deliveries/   # Delivery logging
│   │   ├── suppliers/    # Supplier contact book
│   │   ├── documents/    # Document storage + access control
│   │   ├── diary/        # Daily activity log
│   │   ├── notifications/
│   │   └── settings/     # Profile + business settings
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

Deploys to Vercel:

```bash
vercel --prod
```

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel project settings.
