'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { CommandPalette } from '@/components/layout/command-palette'
import { Bell, Search, ChevronDown, User, Settings, LogOut } from 'lucide-react'

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function getFsaBadgeVariant(rating: string | null | undefined) {
  if (!rating) return 'neutral' as const
  const n = parseInt(rating, 10)
  if (n >= 4) return 'success' as const
  if (n === 3) return 'warning' as const
  return 'error' as const
}

export function Topbar() {
  const router = useRouter()
  const { profile, business } = useAuthStore()
  const { signOut } = useAuth()
  const [commandOpen, setCommandOpen] = useState(false)

  const handleSignOut = useCallback(async () => {
    await signOut()
    window.location.href = '/onboarding'
  }, [signOut])

  return (
    <>
      <header className="flex h-[53px] shrink-0 items-center justify-between border-b border-border bg-white/80 px-4 backdrop-blur">
        {/* Left: Business name + FSA badge */}
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-medium text-foreground">
            {business?.name ?? 'My Business'}
          </span>
          {business?.fsa_rating && (
            <Badge variant={getFsaBadgeVariant(business.fsa_rating)}>
              FSA {business.fsa_rating}/5
            </Badge>
          )}
        </div>

        {/* Center: Search bar */}
        <button
          onClick={() => setCommandOpen(true)}
          className="flex h-8 w-full max-w-[360px] items-center gap-2 rounded-md border border-input bg-background px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="pointer-events-none hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
            &#8984;K
          </kbd>
        </button>

        {/* Right: Notifications + User menu */}
        <div className="flex items-center gap-1">
          {/* Notifications */}
          <Link
            href="/notifications"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Bell className="h-4 w-4" strokeWidth={1.5} />
          </Link>

          {/* User dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] transition-colors hover:bg-accent">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-[10px]">
                  {getInitials(profile?.full_name)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden font-medium text-foreground sm:inline-block">
                {profile?.full_name ?? 'User'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8}>
              <DropdownMenuLabel>
                {profile?.full_name ?? 'User'}
                <div className="text-[11px] font-normal text-muted-foreground">
                  {profile?.email}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/settings/profile')}>
                <User className="h-4 w-4" />
                Profile &amp; Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/settings')}>
                <Settings className="h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  )
}
