'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, profile, business, isLoading, isSubscribed } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false) }, [pathname])

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.replace('/onboarding')
      return
    }
    // Wait for the background business fetch to settle before gating —
    // `business` starts as null in the store and only becomes a row (or
    // stays null if onboarding is incomplete) after loadProfileAndBusiness.
    if (business === null) return
    if (!isSubscribed) {
      router.replace('/paywall')
    }
  }, [isLoading, user, business, isSubscribed, router])

  // Show spinner only while the initial auth check is in flight.
  // Profile / business load asynchronously in the background — Topbar and
  // Dashboard components handle their own loading states without blocking
  // the whole layout.
  if (isLoading) return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
  if (!user) return null

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — static on desktop, slide-in drawer on mobile */}
      <div className={cn(
        'fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out lg:static lg:z-auto lg:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      </div>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1180px] px-4 py-4 sm:px-6 sm:py-[22px]">{children}</div>
        </main>
      </div>
    </div>
  )
}
