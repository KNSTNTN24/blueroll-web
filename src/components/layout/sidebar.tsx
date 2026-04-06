'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip'
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
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'

const navItems = [
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
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()

  return (
    <TooltipProvider delay={0}>
      <aside
        className={cn(
          'flex h-screen flex-col border-r border-border bg-background transition-[width] duration-200',
          collapsed ? 'w-[52px]' : 'w-[220px]'
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            'flex h-[53px] items-center border-b border-border px-3',
            collapsed ? 'justify-center' : 'gap-2'
          )}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-[12px] font-semibold text-white">
            B
          </div>
          {!collapsed && (
            <span className="text-[14px] font-semibold text-foreground">
              Blueroll
            </span>
          )}
        </div>

        {/* Main nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          <ul className="flex flex-col gap-0.5">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + '/')
              const Icon = item.icon

              const linkContent = (
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                    isActive
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    collapsed && 'justify-center px-0'
                  )}
                >
                  <Icon
                    className="h-4 w-4 shrink-0"
                    strokeWidth={isActive ? 2 : 1.5}
                  />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              )

              if (collapsed) {
                return (
                  <li key={item.href}>
                    <Tooltip>
                      <TooltipTrigger className="w-full">
                        {linkContent}
                      </TooltipTrigger>
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

        {/* Bottom section */}
        <div className="border-t border-border px-2 py-2">
          <ul className="flex flex-col gap-0.5">
            {/* Settings */}
            {(() => {
              const isActive = pathname.startsWith('/settings')
              const settingsLink = (
                <Link
                  href="/settings"
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                    isActive
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    collapsed && 'justify-center px-0'
                  )}
                >
                  <Settings
                    className="h-4 w-4 shrink-0"
                    strokeWidth={isActive ? 2 : 1.5}
                  />
                  {!collapsed && <span>Settings</span>}
                </Link>
              )

              if (collapsed) {
                return (
                  <li>
                    <Tooltip>
                      <TooltipTrigger className="w-full">
                        {settingsLink}
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8}>
                        Settings
                      </TooltipContent>
                    </Tooltip>
                  </li>
                )
              }

              return <li>{settingsLink}</li>
            })()}

            {/* Collapse toggle */}
            <li>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger className="w-full">
                    <button
                      onClick={onToggle}
                      className="flex w-full items-center justify-center rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <PanelLeft className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    Expand sidebar
                  </TooltipContent>
                </Tooltip>
              ) : (
                <button
                  onClick={onToggle}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <PanelLeftClose className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>Collapse</span>
                </button>
              )}
            </li>
          </ul>
        </div>
      </aside>
    </TooltipProvider>
  )
}
