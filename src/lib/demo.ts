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

/**
 * Toggle demo mode and reload so every page remounts against the right data.
 * Turning ON verifies the demo rows are actually readable first — a silent
 * no-op reload reads as a broken button.
 */
export async function setDemoModeAndReload(on: boolean) {
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
  persistDemo(on)
  undismissDemoBar()
  // Smooth hand-off: cover the old page with the same overlay the root
  // layout's boot script paints on the next load, so the reload happens
  // under one continuous surface instead of a flash.
  try { sessionStorage.setItem('br_demo_transition', on ? 'enter' : 'exit') } catch {}
  coverWithTransitionOverlay(on)
  await new Promise((r) => setTimeout(r, 260))
  window.location.assign('/dashboard')
}

function coverWithTransitionOverlay(on: boolean) {
  if (document.getElementById('br-demo-boot')) return
  const d = document.createElement('div')
  d.id = 'br-demo-boot'
  d.setAttribute('style', `position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:${on ? '#fdf9ee' : '#fafbf8'};opacity:0;transition:opacity .24s ease`)
  d.innerHTML = `<style>@keyframes brDemoDot{0%,100%{box-shadow:0 0 0 0 rgba(199,152,26,.32)}60%{box-shadow:0 0 0 5px rgba(199,152,26,0)}}</style>` +
    `<div style="display:flex;flex-direction:column;align-items:center;gap:14px;font-family:var(--font-geist),system-ui,sans-serif">` +
    (on ? `<span style="display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid #e7d5a6;border-radius:8px;padding:6px 12px 6px 9px;box-shadow:0 1px 1.5px rgba(133,103,15,.07)"><span style="width:7px;height:7px;border-radius:50%;background:#c7981a;animation:brDemoDot 1.6s ease-out infinite"></span><span style="font-size:12.5px;font-weight:650;color:#85670f">Demo</span></span>` : '') +
    `<span style="font-size:14px;font-weight:600;color:${on ? '#6f5f36' : '#5c626b'}">${on ? 'Entering demo mode…' : 'Back to your kitchen…'}</span></div>`
  document.documentElement.appendChild(d)
  requestAnimationFrame(() => { d.style.opacity = '1' })
}
