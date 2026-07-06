'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, ClipboardCheck, ChefHat, UtensilsCrossed,
  ShieldAlert, BarChart3, Users, AlertTriangle, Truck, Factory,
  FileText, BookOpen, ShieldCheck, Settings, ChevronsLeft, ChevronsRight,
} from 'lucide-react'

const nav = [
  { section: null, items: [
    { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  ]},
  { section: 'Compliance', items: [
    { label: 'Checklists', href: '/checklists', icon: ClipboardCheck },
    { label: 'HACCP Pack', href: '/haccp-pack', icon: ShieldCheck },
    { label: 'Reports', href: '/reports', icon: BarChart3 },
  ]},
  { section: 'Kitchen', items: [
    { label: 'Recipes', href: '/recipes', icon: ChefHat },
    { label: 'Menu', href: '/menu', icon: UtensilsCrossed },
    { label: 'Allergens', href: '/allergens', icon: ShieldAlert },
  ]},
  { section: 'Operations', items: [
    { label: 'Team', href: '/team', icon: Users },
    { label: 'Incidents', href: '/incidents', icon: AlertTriangle },
    { label: 'Deliveries', href: '/deliveries', icon: Truck },
    { label: 'Suppliers', href: '/suppliers', icon: Factory },
    { label: 'Documents', href: '/documents', icon: FileText },
    { label: 'Diary', href: '/diary', icon: BookOpen },
  ]},
]

function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="100 50 370 430" fill="none" className={className}>
      <path d="M241 97V203.426C254.606 198.617 269.247 196 284.5 196C356.573 196 415 254.427 415 326.5C415 398.573 356.573 457 284.5 457C212.594 457 154.272 398.843 154.003 327H154V97H241ZM284.5 283C260.476 283 241 302.476 241 326.5C241 350.524 260.476 370 284.5 370C308.524 370 328 350.524 328 326.5C328 302.476 308.524 283 284.5 283Z" fill="currentColor" />
    </svg>
  )
}

interface SidebarProps { collapsed: boolean; onToggle: () => void }

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className={cn(
      'group/sidebar flex h-screen shrink-0 flex-col bg-sidebar-background transition-all duration-300 ease-in-out',
      collapsed ? 'w-16' : 'w-[234px]',
    )}>
      <div className={cn('flex h-[62px] items-center gap-2.5 px-[18px]', collapsed && 'justify-center px-0')}>
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-brand">
          <LogoMark className="h-[17px] w-[17px] text-[#06281a]" />
        </div>
        {!collapsed && <span className="text-[17px] font-bold tracking-tight text-white">BlueRoll</span>}
      </div>

      <nav className="flex-1 overflow-y-auto px-[14px] pb-2">
        {nav.map((group, gi) => (
          <div key={gi}>
            {!collapsed && group.section && (
              <p className="px-2.5 pb-2 pt-[17px] font-mono text-[10.5px] font-medium uppercase tracking-[0.13em] text-[#646a73]">
                {group.section}
              </p>
            )}
            {collapsed && gi > 0 && <div className="mx-auto my-2 h-px w-6 bg-sidebar-border" />}
            {!collapsed && !group.section && <div className="h-1.5" />}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                const Icon = item.icon
                return (
                  <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex items-center gap-[11px] rounded-[10px] px-[11px] py-[9px] text-[14px] font-semibold transition-colors duration-150 ease-out',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground hover:bg-white/[0.06] hover:text-[#e7e9ec]',
                      collapsed && 'justify-center px-0',
                    )}>
                    <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-sidebar-accent-foreground' : 'text-[#7b8089]')} strokeWidth={1.7} />
                    {!collapsed && item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mx-[14px] border-t border-sidebar-border pb-[14px] pt-[14px] space-y-0.5">
        <Link href="/settings" className={cn(
          'flex items-center gap-[11px] rounded-[10px] px-[11px] py-[9px] text-[14px] font-semibold transition-colors duration-150 ease-out',
          pathname.startsWith('/settings')
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-white/[0.06] hover:text-[#e7e9ec]',
          collapsed && 'justify-center px-0',
        )}>
          <Settings className={cn('h-[18px] w-[18px] shrink-0', pathname.startsWith('/settings') ? 'text-sidebar-accent-foreground' : 'text-[#7b8089]')} strokeWidth={1.7} />
          {!collapsed && 'Settings'}
        </Link>
        <button onClick={onToggle} className={cn(
          'flex w-full items-center gap-[11px] rounded-[10px] px-[11px] py-[9px] text-[14px] font-semibold text-sidebar-foreground/60 transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-[#e7e9ec]',
          collapsed && 'justify-center px-0',
        )}>
          {collapsed ? <ChevronsRight className="h-4 w-4 text-[#7b8089]" strokeWidth={1.7} /> : <><ChevronsLeft className="h-4 w-4 text-[#7b8089]" strokeWidth={1.7} /><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  )
}
