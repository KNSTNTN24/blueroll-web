'use client'

import { useEffect, useState } from 'react'
import { X, Sparkles, Eye } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { isDemoBarDismissed, dismissDemoBar, setDemoModeAndReload } from '@/lib/demo'

/**
 * Full-width strip above the topbar, on every dashboard page.
 *
 * Two states:
 *  - demo OFF: a closable invitation to try demo mode. Once closed it only
 *    comes back via the Settings toggle.
 *  - demo ON: a persistent (not closable) reminder that the data on screen
 *    is the shared sample cafe, with the way out.
 */
export function DemoBar() {
  const demoMode = useAuthStore((s) => s.demoMode)
  const business = useAuthStore((s) => s.business)
  const [dismissed, setDismissed] = useState(true) // start hidden to avoid a flash before localStorage is read

  useEffect(() => { setDismissed(isDemoBarDismissed()) }, [])

  if (demoMode) {
    return (
      <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-900 sm:px-6">
        <Eye className="h-4 w-4 shrink-0" strokeWidth={2} />
        <p className="min-w-0 flex-1 truncate">
          <span className="font-semibold">Demo mode.</span>{' '}
          You&apos;re browsing {business?.name ?? 'a sample kitchen'} — read-only sample data. Your own data is untouched.
        </p>
        <button
          onClick={() => setDemoModeAndReload(false)}
          className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1 font-semibold text-amber-900 hover:bg-amber-100"
        >
          Exit demo
        </button>
      </div>
    )
  }

  if (dismissed) return null

  return (
    <div className="flex items-center gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] text-emerald-900 sm:px-6">
      <Sparkles className="h-4 w-4 shrink-0" strokeWidth={2} />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-semibold">New here?</span>{' '}
        See Blueroll running a busy kitchen — checks, temperatures, allergens, the lot.
      </p>
      <button
        onClick={() => setDemoModeAndReload(true)}
        className="shrink-0 rounded-lg bg-[#1f9d63] px-3 py-1 font-semibold text-white hover:bg-[#188653]"
      >
        Try demo mode
      </button>
      <button
        aria-label="Hide this bar"
        onClick={() => { dismissDemoBar(); setDismissed(true) }}
        className="shrink-0 rounded p-1 text-emerald-700 hover:bg-emerald-100"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  )
}
