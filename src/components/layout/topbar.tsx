'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Search, LogOut, User, ChevronDown } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { supabase } from '@/lib/supabase'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { CommandPalette } from '@/components/layout/command-palette'
import { cn } from '@/lib/utils'

export function Topbar() {
  const { profile, business } = useAuthStore()
  const router = useRouter()
  const [commandOpen, setCommandOpen] = useState(false)

  const initials = profile?.full_name
    ? profile.full_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : profile?.email?.[0]?.toUpperCase() ?? '?'

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      <header className="sticky top-0 z-20 flex h-[53px] items-center justify-between border-b border-border bg-white/80 px-6 backdrop-blur-sm">
        {/* Left — Business name */}
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-foreground">
            {business?.name ?? 'Blueroll'}
          </span>
          {business?.fsa_rating && (
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-[11px] font-medium text-emerald-700"
            >
              FSA {business.fsa_rating}
            </Badge>
          )}
        </div>

        {/* Centre — Search */}
        <button
          onClick={() => setCommandOpen(true)}
          className="flex h-8 w-[280px] items-center gap-2 rounded-md border border-border bg-muted/50 px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search...</span>
          <kbd className="ml-auto hidden rounded border border-border bg-white px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
            ⌘K
          </kbd>
        </button>

        {/* Right — Notifications + User */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => router.push('/notifications')}
            className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Bell className="h-4 w-4" strokeWidth={1.5} />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger>
              <button className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="bg-emerald-100 text-[10px] font-medium text-emerald-700">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-[13px] font-medium text-foreground sm:inline">
                  {profile?.full_name ?? profile?.email}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5">
                <p className="text-[13px] font-medium">{profile?.full_name}</p>
                <p className="text-[12px] text-muted-foreground">{profile?.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/settings')}>
                <User className="mr-2 h-3.5 w-3.5" />
                Profile & Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                <LogOut className="mr-2 h-3.5 w-3.5" />
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
