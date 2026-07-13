'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { supabase } from '@/lib/supabase'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { CommandPalette } from '@/components/layout/command-palette'
import { NotifBell } from '@/components/layout/notif-bell'
import { Search, ChevronDown, Settings, LogOut, Check, Menu, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const { profile, business, user, sites, currentSiteId, setCurrentSiteId } = useAuthStore()
  // Group-shared pages carry a chip clarifying the switcher is context-only here
  const sharedChip = pathname?.startsWith('/haccp-pack') ? 'Pack shared across all sites'
    : pathname?.startsWith('/suppliers') ? 'Approved list shared across all sites'
    : pathname?.startsWith('/recipes') || pathname?.startsWith('/menu') || pathname?.startsWith('/allergens') ? 'Shared across all sites'
    : null
  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'User'
  const displayEmail = profile?.email || user?.email || ''
  const businessName = business?.name || 'My Business'
  // Settings is org-level — no site switcher there (design spec)
  const multiSite = sites.length > 1 && !pathname?.startsWith('/settings')
  const canSwitchSites = multiSite && !!profile?.is_group_admin
  const currentSite = sites.find((s) => s.id === currentSiteId) ?? null
  const [commandOpen, setCommandOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [siteMenuOpen, setSiteMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const siteRef = useRef<HTMLDivElement>(null)

  const handleSignOut = useCallback(() => {
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('sb-') || k.includes('supabase')) localStorage.removeItem(k)
      })
    } catch {}
    supabase.auth.signOut().catch(() => {})
    window.location.href = '/onboarding'
  }, [])

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  // Close site switcher on outside click
  useEffect(() => {
    if (!siteMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (siteRef.current && !siteRef.current.contains(e.target as Node)) setSiteMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [siteMenuOpen])

  return (
    <>
      <header className="flex h-[62px] shrink-0 items-center justify-between gap-2 border-b border-[#eceef0] bg-card px-4 sm:px-6">
        {/* Left */}
        <div className="flex min-w-0 items-center gap-2.5">
          <button onClick={onMenuClick} aria-label="Open menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#5c626b] transition-colors hover:bg-muted hover:text-foreground lg:hidden">
            <Menu className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <h1 className="truncate text-[15px] font-bold text-foreground">{businessName}</h1>
          {sites.length <= 1 && business?.fsa_rating && (
            <span className="hidden shrink-0 items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand-deep sm:inline-flex">
              <Check className="h-3 w-3" strokeWidth={2.4} />
              {business.fsa_rating}/5
            </span>
          )}

          {/* Site switcher — only for multi-site groups */}
          {canSwitchSites && (
            <div ref={siteRef} className="relative shrink-0">
              <button onClick={() => setSiteMenuOpen((o) => !o)}
                className="flex items-center gap-1.5 rounded-[9px] border border-input bg-card px-2.5 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-accent">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} />
                <span className="max-w-[120px] truncate sm:max-w-[160px]">{currentSite ? currentSite.name : 'All sites'}</span>
                <span className="rounded-full bg-secondary px-1.5 text-[11px] font-semibold text-muted-foreground">{sites.length}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {siteMenuOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg">
                  {profile?.is_group_admin && (
                    <button onClick={() => { setCurrentSiteId(null); setSiteMenuOpen(false) }}
                      className={cn('flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted', !currentSiteId ? 'font-semibold text-brand-deep' : 'text-foreground')}>
                      <span className="flex items-center gap-2"><Building2 className="h-4 w-4" strokeWidth={1.8} /> All sites</span>
                      {!currentSiteId && <Check className="h-4 w-4 shrink-0" strokeWidth={2.2} />}
                    </button>
                  )}
                  {profile?.is_group_admin && <div className="my-1 h-px bg-border" />}
                  <div className="max-h-[300px] overflow-y-auto">
                    {sites.map((s) => (
                      <button key={s.id} onClick={() => { setCurrentSiteId(s.id); setSiteMenuOpen(false) }}
                        className={cn('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted', currentSiteId === s.id ? 'font-semibold text-brand-deep' : 'text-foreground')}>
                        <span className="truncate">{s.name}</span>
                        {currentSiteId === s.id && <Check className="h-4 w-4 shrink-0" strokeWidth={2.2} />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {multiSite && !canSwitchSites && currentSite && (
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] font-medium text-foreground">
              <Building2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
              <span className="max-w-[160px] truncate">{currentSite.name}</span>
            </div>
          )}

          {/* Group-shared context chip */}
          {multiSite && sharedChip && (
            <span className="hidden shrink-0 items-center rounded-md bg-secondary px-2 py-1 text-[11.5px] font-semibold text-muted-foreground md:inline-flex">
              {sharedChip}
            </span>
          )}
        </div>

        {/* Center: search — hidden on small screens */}
        <button onClick={() => setCommandOpen(true)}
          className="mx-4 hidden h-[38px] w-full max-w-[420px] items-center gap-2.5 rounded-[10px] border border-[#ebedf0] bg-muted px-3 text-[13px] text-muted-foreground transition-colors hover:bg-[#eceef1] md:flex">
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="pointer-events-none hidden rounded-md border border-[#e5e7eb] bg-card px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground sm:inline">&#8984;K</kbd>
        </button>

        {/* Right */}
        <div className="flex items-center gap-1.5 shrink-0">
          <NotifBell />
          <span className="mx-1 h-6 w-px bg-[#eceef0]" />

          {/* Custom dropdown — no Base UI */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-brand-deep text-[10px] font-bold text-white">{getInitials(displayName)}</AvatarFallback>
              </Avatar>
              <span className="hidden font-medium text-foreground sm:inline">{displayName}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-lg z-50">
                <div className="border-b border-border px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-foreground truncate">{displayName}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{displayEmail}</p>
                </div>
                <button
                  onClick={() => { setMenuOpen(false); router.push('/settings') }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
                >
                  <Settings className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                  Settings
                </button>
                <div className="h-px bg-border" />
                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10"
                >
                  <LogOut className="h-4 w-4" strokeWidth={1.5} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  )
}
