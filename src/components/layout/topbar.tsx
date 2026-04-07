'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useAuth } from '@/hooks/use-auth'
import { supabase } from '@/lib/supabase'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
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

  const handleSignOut = useCallback(() => {
    supabase.auth.signOut().finally(() => { window.location.href = '/onboarding' })
  }, [])

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-5">
        <div className="flex items-center gap-2.5 shrink-0">
          <h1 className="text-[13px] font-semibold text-foreground">{business?.name ?? 'My Business'}</h1>
          {business?.fsa_rating && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {business.fsa_rating}/5
            </span>
          )}
        </div>

        <button onClick={() => setCommandOpen(true)}
          className="mx-6 flex h-10 w-full max-w-md items-center gap-2.5 rounded-xl border border-input bg-muted/40 px-4 text-[13px] text-muted-foreground transition-colors hover:bg-muted">
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="pointer-events-none hidden rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">&#8984;K</kbd>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <Link href="/notifications" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary text-[10px] font-bold text-primary-foreground">{getInitials(profile?.full_name)}</AvatarFallback>
              </Avatar>
              <span className="hidden font-medium text-foreground sm:inline">{profile?.full_name ?? 'User'}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-56">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-semibold">{profile?.full_name ?? 'User'}</p>
                <p className="text-xs text-muted-foreground">{profile?.email ?? ''}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/settings')}>
                <Settings className="h-4 w-4" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  )
}
