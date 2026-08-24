'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Counterpart of the pre-hydration overlay painted by the root layout's boot
 * script during a demo-mode switch: holds it until the auth store has settled
 * on the target business, then fades it away. Renders nothing itself.
 */
export function DemoTransition() {
  const isLoading = useAuthStore((s) => s.isLoading)
  const business = useAuthStore((s) => s.business)

  useEffect(() => {
    const el = document.getElementById('br-demo-boot')
    if (!el) {
      try { sessionStorage.removeItem('br_demo_transition') } catch {}
      return
    }
    const lift = () => {
      try { sessionStorage.removeItem('br_demo_transition') } catch {}
      el.style.opacity = '0'
      setTimeout(() => el.remove(), 360)
    }
    if (!isLoading && business !== null) {
      // Settled — hold a beat so the overlay never blinks, then fade.
      const t = setTimeout(lift, 160)
      return () => clearTimeout(t)
    }
    // Safety valve: never trap the user behind the overlay.
    const t = setTimeout(lift, 8000)
    return () => clearTimeout(t)
  }, [isLoading, business])

  return null
}
