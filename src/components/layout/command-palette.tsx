'use client'

import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command'
import {
  LayoutDashboard,
  ClipboardCheck,
  ChefHat,
  UtensilsCrossed,
  ShieldAlert,
  BarChart3,
  Users,
  AlertTriangle,
  Truck,
  Factory,
  FileText,
  BookOpen,
  ShieldCheck,
  Settings,
  Plus,
  Camera,
  Upload,
} from 'lucide-react'

const pages = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Checklists', href: '/checklists', icon: ClipboardCheck },
  { label: 'Recipes', href: '/recipes', icon: ChefHat },
  { label: 'Menu', href: '/menu', icon: UtensilsCrossed },
  { label: 'Allergens', href: '/allergens', icon: ShieldAlert },
  { label: 'Reports', href: '/reports', icon: BarChart3 },
  { label: 'Team', href: '/team', icon: Users },
  { label: 'Incidents', href: '/incidents', icon: AlertTriangle },
  { label: 'Deliveries', href: '/deliveries', icon: Truck },
  { label: 'Suppliers', href: '/suppliers', icon: Factory },
  { label: 'Documents', href: '/documents', icon: FileText },
  { label: 'Diary', href: '/diary', icon: BookOpen },
  { label: 'HACCP Pack', href: '/haccp-pack', icon: ShieldCheck },
  { label: 'Settings', href: '/settings', icon: Settings },
]

const quickActions = [
  { label: 'New recipe', href: '/recipes/new', icon: Plus },
  { label: 'AI import recipe', href: '/recipes/import', icon: Camera },
  { label: 'New checklist', href: '/checklists/new', icon: Plus },
  { label: 'Upload document', href: '/documents?upload=true', icon: Upload },
  { label: 'New delivery', href: '/deliveries/new', icon: Plus },
]

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter()

  const handleSelect = useCallback(
    (href: string) => {
      onOpenChange(false)
      router.push(href)
    },
    [router, onOpenChange]
  )

  // Global keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [open, onOpenChange])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages and actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Pages">
          {pages.map((page) => {
            const Icon = page.icon
            return (
              <CommandItem
                key={page.href}
                value={page.label}
                onSelect={() => handleSelect(page.href)}
              >
                <Icon className="h-4 w-4" />
                <span>{page.label}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick Actions">
          {quickActions.map((action) => {
            const Icon = action.icon
            return (
              <CommandItem
                key={action.href}
                value={action.label}
                onSelect={() => handleSelect(action.href)}
              >
                <Icon className="h-4 w-4" />
                <span>{action.label}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
