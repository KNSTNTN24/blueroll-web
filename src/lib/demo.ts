import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'

// The showcase business ("St James's Cafe") — seeded and maintained for
// screenshots and demos. RLS grants every authenticated user read-only
// access to its rows (see migration 20260824120000_demo_mode_read_policies).
export const DEMO_BUSINESS_ID = 'a8ff4795-1dee-4a89-b693-0b1b6d2ddae3'

const DEMO_KEY = 'br_demo_mode'
const BAR_KEY = 'br_demo_bar_dismissed'

export function isDemoPersisted(): boolean {
  try { return localStorage.getItem(DEMO_KEY) === '1' } catch { return false }
}
export function persistDemo(on: boolean) {
  try { if (on) localStorage.setItem(DEMO_KEY, '1'); else localStorage.removeItem(DEMO_KEY) } catch {}
}
export function isDemoBarDismissed(): boolean {
  try { return localStorage.getItem(BAR_KEY) === '1' } catch { return false }
}
export function dismissDemoBar() {
  try { localStorage.setItem(BAR_KEY, '1') } catch {}
}

/**
 * Point the auth store at the demo business. The user's own profile and
 * business stay untouched (realBusiness keeps driving the paywall gate);
 * every page reads business/sites/currentSiteId from the store, so the
 * whole app renders St James's Cafe. Writes are rejected by RLS — the demo
 * is read-only by construction.
 *
 * Returns false when the demo rows are not readable (migration not applied
 * yet, or the seed business is gone) — callers should fall back to real data.
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

/** Toggle demo mode and reload so every page remounts against the right data. */
export function setDemoModeAndReload(on: boolean) {
  persistDemo(on)
  window.location.assign('/dashboard')
}
