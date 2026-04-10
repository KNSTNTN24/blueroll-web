'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { supabase } from '@/lib/supabase'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { CommandPalette } from '@/components/layout/command-palette'
import { Bell, Search, ChevronDown, Settings, LogOut } from 'lucide-react'

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

export function Topbar() {
  const router = useRouter()
  const { profile, business } = useAuthStore()
  const [commandOpen, setCommandOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-5">
        {/* Left */}
        <div className="flex items-center gap-2.5 shrink-0">
          <h1 className="text-[13px] font-semibold text-foreground">{business?.name ?? 'My Business'}</h1>
          {business?.fsa_rating && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {business.fsa_rating}/5
            </span>
          )}
        </div>

        {/* Center: search */}
        <button onClick={() => setCommandOpen(true)}
          className="mx-6 flex h-10 w-full max-w-md items-center gap-2.5 rounded-xl border border-input bg-muted/40 px-4 text-[13px] text-muted-foreground transition-colors hover:bg-muted">
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="pointer-events-none hidden rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">&#8984;K</kbd>
        </button>

        {/* Right */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Link href="/notifications" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </Link>

          {/* Custom dropdown — no Base UI */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary text-[10px] font-bold text-primary-foreground">{getInitials(profile?.full_name)}</AvatarFallback>
              </Avatar>
              <span className="hidden font-medium text-foreground sm:inline">{profile?.full_name ?? 'User'}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-lg z-50">
                <div className="border-b border-border px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-foreground truncate">{profile?.full_name ?? 'User'}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{profile?.email ?? ''}</p>
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
