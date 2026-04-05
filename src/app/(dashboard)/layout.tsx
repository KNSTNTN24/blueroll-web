'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { useAuthStore } from '@/stores/auth-store'
import { useAuth } from '@/hooks/use-auth'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  useAuth()
  const { user, profile, isLoading } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.replace('/login')
      return
    }
    if (!profile) {
      router.replace('/onboarding')
    }
  }, [user, profile, isLoading, router])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
          <span className="text-[13px] text-muted-foreground">Loading...</span>
        </div>
      </div>
    )
  }

  if (!user || !profile) return null

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col pl-[220px] transition-[padding] duration-200">
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
