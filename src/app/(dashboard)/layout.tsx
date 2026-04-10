'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, profile, business, isLoading } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.replace('/onboarding')
    }
  }, [isLoading, user, router])

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
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
