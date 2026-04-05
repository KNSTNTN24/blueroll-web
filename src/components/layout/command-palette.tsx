'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  LayoutDashboard,
  ClipboardCheck,
  ChefHat,
  UtensilsCrossed,
  AlertTriangle as TriangleAlert,
  FileText,
  Users,
  AlertCircle,
  Truck,
  Building2,
  FolderOpen,
  BookOpen,
  Settings,
  Plus,
  Sparkles,
} from 'lucide-react'

const PAGES = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Checklists', href: '/checklists', icon: ClipboardCheck },
  { label: 'Recipes', href: '/recipes', icon: ChefHat },
  { label: 'Menu', href: '/menu', icon: UtensilsCrossed },
  { label: 'Allergen Matrix', href: '/allergens', icon: TriangleAlert },
  { label: 'Reports', href: '/reports', icon: FileText },
  { label: 'Team', href: '/team', icon: Users },
  { label: 'Incidents', href: '/incidents', icon: AlertCircle },
  { label: 'Deliveries', href: '/deliveries', icon: Truck },
  { label: 'Suppliers', href: '/suppliers', icon: Building2 },
  { label: 'Documents', href: '/documents', icon: FolderOpen },
  { label: 'Diary', href: '/diary', icon: BookOpen },
  { label: 'Settings', href: '/settings', icon: Settings },
]

const ACTIONS = [
  { label: 'New Recipe', href: '/recipes/new', icon: Plus },
  { label: 'AI Recipe Import', href: '/recipes/import', icon: Sparkles },
  { label: 'New Checklist', href: '/checklists/new', icon: Plus },
  { label: 'Upload Document', href: '/documents/upload', icon: Plus },
  { label: 'New Delivery', href: '/deliveries/new', icon: Plus },
]

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter()

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

  const navigate = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          {PAGES.map((page) => (
            <CommandItem key={page.href} onSelect={() => navigate(page.href)}>
              <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {page.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Quick Actions">
          {ACTIONS.map((action) => (
            <CommandItem key={action.href} onSelect={() => navigate(action.href)}>
              <action.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {action.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
