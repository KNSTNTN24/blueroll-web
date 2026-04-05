# Blueroll Web — Design System

## Design Philosophy

Desktop-first SaaS application following the design language of Linear, Vercel Dashboard, and Notion. High information density, generous whitespace, borders over shadows, and precise typography.

## Layout System

### Shell
- **Sidebar** (220px, collapsible to 52px icon rail): persistent left navigation with two-level hierarchy — main nav items and bottom utilities
- **Topbar** (53px height): business name + FSA badge (left), global search ⌘K (centre), notifications bell + user menu (right)
- **Content area**: max-width 1152px (max-w-6xl), 24px horizontal padding, 24px vertical padding

### Grid
- Dashboard: 4-column metric cards, 3-column main layout (2:1 ratio)
- Data tables: full width within content area
- Forms: max-width 512px (max-w-lg) for single-column, 2-column for wider forms
- Detail views: max-width 768px (max-w-3xl) for readable content

## Colour Tokens

### Brand
| Token | Value | Usage |
|-------|-------|-------|
| Emerald 600 | `#059669` / `oklch(0.52 0.14 160)` | Primary actions, active nav states, positive status |
| Emerald 700 | `#047857` | Primary hover |
| Emerald 50 | `#ecfdf5` | Active nav background, success backgrounds |
| Emerald 100 | `#d1fae5` | Avatar fallback background, selected states |

### Semantic
| Token | Value | Usage |
|-------|-------|-------|
| `--foreground` | `oklch(0.145 0 0)` | Primary text |
| `--muted-foreground` | `oklch(0.52 0.015 264)` | Secondary text, descriptions |
| `--border` | `oklch(0.91 0.004 264)` | All borders (1px hairlines) |
| `--accent` | `oklch(0.97 0.003 264)` | Hover backgrounds |
| `--destructive` | Red 600 | Errors, delete actions |

### Status Colours
- **Success**: emerald-50 bg, emerald-700 text, emerald-200 border
- **Warning**: amber-50 bg, amber-700 text, amber-200 border
- **Error**: red-50 bg, red-700 text, red-200 border
- **Info**: blue-50 bg, blue-700 text, blue-200 border
- **Neutral**: gray-50 bg, gray-600 text, gray-200 border

## Typography

**Font**: Inter (Google Fonts, `--font-sans`)

### Scale
| Size | Usage |
|------|-------|
| 32px (`text-3xl`) | Marketing headings only |
| 24px (`text-2xl`) | Metric values |
| 20px (`text-xl`) | Page titles |
| 16px (`text-base`) | Large body text (rarely used) |
| 14px (`text-sm`) | Default body, form labels |
| 13px (`text-[13px]`) | **Primary UI text** — nav items, table cells, buttons, descriptions |
| 12px (`text-[12px]`) | Metadata, helper text, timestamps |
| 11px (`text-[11px]`) | Sub-metadata, item counts, fine print |
| 10px (`text-[10px]`) | Tags, role badges, smallest labels |

### Weight
- **Semibold (600)**: page titles, card headings, metric values
- **Medium (500)**: nav items, table headers, buttons, form labels
- **Normal (400)**: body text, descriptions

### Tracking
- Tight tracking (`tracking-tight`) on headings (20px+)
- Default tracking on body text
- `tabular-nums` on all numeric data in tables and metrics

## Spacing Scale

Based on 4px grid:
- **0.5** (2px): hairline gaps
- **1** (4px): tight internal spacing
- **1.5** (6px): label-to-input gap
- **2** (8px): between related elements
- **2.5** (10px): padding within compact elements (nav items, table cells)
- **3** (12px): between list items
- **4** (16px): section padding, card padding
- **6** (24px): between page sections, main content padding
- **8** (32px): large section gaps

## Component Conventions

### Buttons
- **Primary**: `bg-emerald-600 hover:bg-emerald-700 text-white` — one per page section
- **Secondary/Outline**: `variant="outline"` — secondary actions
- **Ghost**: icon-only actions in tables and toolbars
- **Size sm**: most UI buttons (`text-[12px]`, compact padding)

### Data Tables
- Full-width within content area
- Rounded border container (`rounded-lg border border-border bg-white`)
- Sticky header with `text-[12px] font-medium text-muted-foreground`
- Row hover: `hover:bg-accent/50`
- 1px dividers between rows (`divide-y divide-border`)
- Inline actions: icon buttons on right side
- No heavy shadows

### Status Badges
- Pill shape with dot indicator
- `text-[11px] font-medium`
- Semantic colour mapping (see Status Colours above)

### Cards
- `rounded-lg border border-border bg-white p-4`
- Title: `text-[13px] font-medium`
- No box shadows (borders only)

### Forms
- Labels: `text-[13px] font-medium`
- Helper text: `text-[12px] text-muted-foreground`
- Error text: `text-[12px] text-destructive`
- Gap between fields: `space-y-4`
- Label-to-input gap: `space-y-1.5`
- Sticky footer for long forms

### Empty States
- Centred, with icon in bordered container
- Title: `text-[14px] font-medium`
- Description: `text-[13px] text-muted-foreground`
- Primary CTA button

### Loading States
- Skeleton placeholders matching final layout dimensions
- Spinner: `h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent`

## Interactions

- **⌘K Command Palette**: global navigation + quick actions
- **Keyboard shortcuts**: standard patterns (Enter to submit, Escape to close)
- **Optimistic updates**: via TanStack Query mutation + invalidation
- **Slide-over panels**: detail/edit views where full-page navigation isn't needed
- **Toast notifications**: Sonner, bottom-right position

## Iconography

Lucide React icons throughout:
- Navigation: 16×16px, `strokeWidth={1.5}` (inactive), `strokeWidth={2}` (active)
- Inline: 14×14px (`h-3.5 w-3.5`)
- Feature: 20×20px (`h-5 w-5`)
- Decorative (empty states): 20×20px in bordered container

## Border Radius

- `rounded-md` (6px): buttons, inputs, nav items, tags
- `rounded-lg` (8px): cards, tables, panels
- `rounded-full`: avatars, status dots, badges
- `rounded-xl` (12px): empty state icon containers
