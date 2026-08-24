import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'

// The showcase business ("St James's Cafe") — seeded and maintained for
// screenshots and demos, kept "today-fresh" by the demo-daily-refresh pg_cron
// job. RLS grants every authenticated user read-only access to its rows
// (migration 20260824120000_demo_mode_read_policies).
export const DEMO_BUSINESS_ID = 'a8ff4795-1dee-4a89-b693-0b1b6d2ddae3'

const DEMO_KEY = 'br_demo_mode'
const BAR_KEY = 'br_demo_bar_dismissed'

export function isDemoPersisted(): boolean {
  try { return localStorage.getItem(DEMO_KEY) === '1' } catch { return false }
}
export function persistDemo(on: boolean) {
  try { if (on) localStorage.setItem(DEMO_KEY, '1'); else localStorage.removeItem(DEMO_KEY) } catch {}
}
// Dismissal is per session (designer's spec): the cross hides the bar until
// the next sign-in; toggling demo from Settings brings it straight back.
export function isDemoBarDismissed(): boolean {
  try { return sessionStorage.getItem(BAR_KEY) === '1' } catch { return false }
}
export function dismissDemoBar() {
  try { sessionStorage.setItem(BAR_KEY, '1') } catch {}
}
export function undismissDemoBar() {
  try { sessionStorage.removeItem(BAR_KEY) } catch {}
}
// Once demo has been switched on this session, the bar stays visible in both
// states (even for established businesses) until the cross closes it —
// the toggle only switches the data, never hides the bar.
const PIN_KEY = 'br_demo_bar_pinned'
export function isDemoBarPinned(): boolean {
  try { return sessionStorage.getItem(PIN_KEY) === '1' } catch { return false }
}
export function pinDemoBar() {
  try { sessionStorage.setItem(PIN_KEY, '1') } catch {}
}
export function unpinDemoBar() {
  try { sessionStorage.removeItem(PIN_KEY) } catch {}
}

/**
 * Point the auth store at the demo business. The user's own profile and
 * realBusiness stay untouched (realBusiness keeps driving the paywall gate);
 * every page reads business/sites/currentSiteId from the store, so the whole
 * app renders St James's Cafe. Writes are rejected by RLS — the demo is
 * read-only by construction.
 *
 * Returns false when the demo rows are not readable (migration not applied,
 * or the seed business is gone) — callers fall back to real data.
 */
export async function applyDemoOverlay(): Promise<boolean> {
  const store = useAuthStore.getState()
  const { data: demoBiz } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', DEMO_BUSINESS_ID)
    .maybeSingle()
  if (!demoBiz) return false

  const { data: demoSites } = await supabase
    .from('sites')
    .select('*')
    .eq('business_id', DEMO_BUSINESS_ID)
    .neq('status', 'removed')
    .order('name')
  const siteList = demoSites ?? []

  store.setBusiness(demoBiz)
  store.setSites(siteList)
  // Group admins keep the "All sites" estate view; everyone else lands on
  // the first demo site. (currentSiteId = null means "All sites".)
  const isAdmin = store.profile?.is_group_admin ?? false
  store.setCurrentSiteId(isAdmin && siteList.length > 1 ? null : (siteList[0]?.id ?? null))
  store.setDemoMode(true)
  return true
}

/**
 * Switch demo mode in place — no page reload. The dashboard layout (sidebar,
 * topbar, demo bar) stays mounted; only the content area sits under a veil
 * while the store swaps businesses and the dashboard refetches.
 */
export async function toggleDemoMode(on: boolean, router: { push: (path: string) => void }) {
  const store = useAuthStore.getState()
  if (store.demoSwitching) return

  if (on) {
    const { data } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', DEMO_BUSINESS_ID)
      .maybeSingle()
    if (!data) {
      const { toast } = await import('sonner')
      toast.error('Demo data is not available yet — the demo access migration has not been applied to the database.')
      return
    }
  }

  store.setDemoSwitching(on ? 'enter' : 'exit')
  persistDemo(on)
  undismissDemoBar()
  if (on) pinDemoBar()
  // Leave whatever record page we're on — it belongs to the other business.
  router.push('/dashboard')
  const minHold = new Promise((r) => setTimeout(r, 550))

  try {
    if (on) {
      await applyDemoOverlay()
    } else {
      useAuthStore.getState().setDemoMode(false)
      // Dynamic import dodges the demo.ts <-> use-auth import cycle.
      const { reloadRealBusiness } = await import('@/hooks/use-auth')
      await reloadRealBusiness()
    }
  } finally {
    await minHold
    useAuthStore.getState().setDemoSwitching(null)
  }
}
