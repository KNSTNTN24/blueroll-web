'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
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
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Checklists', href: '/checklists', icon: ClipboardCheck },
  { label: 'Recipes', href: '/recipes', icon: ChefHat },
  { label: 'Menu', href: '/menu', icon: UtensilsCrossed },
  { label: 'Allergens', href: '/allergens', icon: TriangleAlert },
  { label: 'Reports', href: '/reports', icon: FileText },
  { label: 'Team', href: '/team', icon: Users },
  { label: 'Incidents', href: '/incidents', icon: AlertCircle },
  { label: 'Deliveries', href: '/deliveries', icon: Truck },
  { label: 'Suppliers', href: '/suppliers', icon: Building2 },
  { label: 'Documents', href: '/documents', icon: FolderOpen },
  { label: 'Diary', href: '/diary', icon: BookOpen },
] as const

const BOTTOM_ITEMS = [
  { label: 'Settings', href: '/settings', icon: Settings },
] as const

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-30 flex h-screen flex-col border-r border-border bg-white transition-[width] duration-200',
        collapsed ? 'w-[52px]' : 'w-[220px]'
      )}
    >
      {/* Logo */}
      <div className={cn(
        'flex h-[53px] items-center border-b border-border px-3',
        collapsed ? 'justify-center' : 'gap-2'
      )}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-[11px] font-bold text-white">
          B
        </div>
        {!collapsed && (
          <span className="text-[15px] font-semibold tracking-tight text-foreground">
            Blueroll
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon

            const linkContent = (
              <Link
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  collapsed && 'justify-center px-0'
                )}
              >
                <Icon
                  className={cn(
                    'h-[16px] w-[16px] shrink-0',
                    isActive ? 'text-emerald-600' : 'text-muted-foreground/70'
                  )}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )

            if (collapsed) {
              return (
                <li key={item.href}>
                  <Tooltip>
                    <TooltipTrigger>{linkContent}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                </li>
              )
            }

            return <li key={item.href}>{linkContent}</li>
          })}
        </ul>
      </nav>

      {/* Bottom */}
      <div className="border-t border-border px-2 py-2">
        <ul className="space-y-0.5">
          {BOTTOM_ITEMS.map((item) => {
            const isActive = pathname === item.href
            const Icon = item.icon

            const linkContent = (
              <Link
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  collapsed && 'justify-center px-0'
                )}
              >
                <Icon
                  className={cn(
                    'h-[16px] w-[16px] shrink-0',
                    isActive ? 'text-emerald-600' : 'text-muted-foreground/70'
                  )}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )

            if (collapsed) {
              return (
                <li key={item.href}>
                  <Tooltip>
                    <TooltipTrigger>{linkContent}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                </li>
              )
            }

            return <li key={item.href}>{linkContent}</li>
          })}
        </ul>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            collapsed && 'justify-center px-0'
          )}
        >
          {collapsed ? (
            <ChevronsRight className="h-[16px] w-[16px]" strokeWidth={1.5} />
          ) : (
            <>
              <ChevronsLeft className="h-[16px] w-[16px]" strokeWidth={1.5} />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
