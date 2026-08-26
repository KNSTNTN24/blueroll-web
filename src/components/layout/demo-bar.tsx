'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { isDemoBarDismissed, dismissDemoBar, isDemoBarPinned, pinDemoBar, unpinDemoBar, toggleDemoMode } from '@/lib/demo'

/**
 * Slim cream demo-mode bar above the topbar, per the designer's makeup
 * ("Demo Mode Banner.dc.html"): a white status-dot pill, the copy line
 * (ellipsis-guarded — the bar never wraps), a mono ON/OFF label, the gold
 * toggle, a hairline, and a dismiss cross. Closing hides the bar for the
 * session only; demo mode itself keeps whatever the toggle says and the
 * Settings toggle always works.
 *
 * Container queries drive the responsive states: <880px drops the explainer,
 * >=1100px adds an extra practical sentence, <480px drops the mono label,
 * <360px shortens the title.
 */
export function DemoBar() {
  const router = useRouter()
  const demoMode = useAuthStore((s) => s.demoMode)
  const business = useAuthStore((s) => s.business)
  const realBusiness = useAuthStore((s) => s.realBusiness)
  const sites = useAuthStore((s) => s.sites)
  const [dismissed, setDismissed] = useState(true) // start hidden to avoid a flash before sessionStorage is read
  const [eligible, setEligible] = useState(false)
  const [pinned, setPinned] = useState(false)

  useEffect(() => { setDismissed(isDemoBarDismissed()) }, [])
  // Seeing demo ON pins the bar for the whole session — however it was turned
  // on. From then on the toggle only switches the data; only the cross closes.
  useEffect(() => {
    if (demoMode) { pinDemoBar(); setPinned(true) }
    else setPinned(isDemoBarPinned())
  }, [demoMode])

  // The OFF-state invitation is only for young businesses with no checks of
  // their own yet — never for established accounts. Exception: a business
  // named "totomoto" (the standing demo/test account) always sees it.
  // The Settings toggle works for everyone regardless.
  const own = realBusiness ?? business
  const ownId = own?.id
  const ownName = own?.name
  const ownCreated = own?.created_at
  useEffect(() => {
    let alive = true
    if (!ownId) { setEligible(false); return }
    if ((ownName ?? '').toLowerCase().includes('totomoto')) { setEligible(true); return }
    const createdAt = ownCreated ? new Date(ownCreated).getTime() : 0
    if (!createdAt || Date.now() - createdAt > 14 * 24 * 3600 * 1000) { setEligible(false); return }
    void supabase
      .from('checklist_completions')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', ownId)
      .then(({ count }) => { if (alive) setEligible((count ?? 0) === 0) })
    return () => { alive = false }
  }, [ownId, ownName, ownCreated])

  // While demo is ON the bar is the only visible exit — it must not be
  // dismissible (a real user closed it and got stranded in the demo).
  if (dismissed && !demoMode) return null
  if (!demoMode && !eligible && !pinned) return null

  const on = demoMode
  const siteCount = sites.length
  const estate = siteCount > 1 ? `a sample estate of ${siteCount} sites` : 'a fully worked sample kitchen'

  return (
    <div className="dm-bar" style={{ background: on ? '#f9f1da' : '#fdf9ee', borderBottom: `1px solid ${on ? '#eddfb6' : '#f2e7cb'}` }}>
      <style>{`
        @keyframes dmDot { 0%, 100% { box-shadow: 0 0 0 0 rgba(199,152,26,.32); } 60% { box-shadow: 0 0 0 4px rgba(199,152,26,0); } }
        .dm-bar { container-type: inline-size; }
        .dm-copy { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dm-extra { display: none; }
        .dm-title-short { display: none; }
        @container (max-width: 880px) { .dm-detail { display: none !important; } }
        @container (min-width: 1100px) { .dm-extra { display: inline !important; } }
        @container (max-width: 480px) { .dm-state { display: none !important; } .dm-row { padding-left: 14px !important; padding-right: 14px !important; } }
        @container (max-width: 360px) { .dm-title-long { display: none !important; } .dm-title-short { display: inline !important; } }
      `}</style>
      <div className="dm-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 20px' }}>
        {/* Status-dot pill */}
        <span style={on
          ? { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #e7d5a6', borderRadius: 7, padding: '4px 9px 4px 7px', flexShrink: 0, boxShadow: '0 1px 1.5px rgba(133,103,15,.07)' }
          : { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fdfaf2', border: '1px solid #ece0c2', borderRadius: 7, padding: '4px 9px 4px 7px', flexShrink: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? '#c7981a' : '#d8c48f', animation: on ? 'dmDot 3.4s ease-out infinite' : undefined }} />
          <span style={{ fontSize: 11, fontWeight: 650, color: on ? '#85670f' : '#9a8a5f', letterSpacing: '-0.005em' }}>Demo</span>
        </span>

        {/* Copy line — one line always */}
        <span className="dm-copy" style={{ flex: 1, minWidth: 0 }}>
          <span className="dm-title-long" style={{ fontSize: 13, fontWeight: 650, color: '#16181d', letterSpacing: '-0.01em' }}>{on ? 'Demo mode is on' : 'Demo mode'}</span>
          <span className="dm-title-short" style={{ fontSize: 13, fontWeight: 650, color: '#16181d', letterSpacing: '-0.01em' }}>{on ? 'Demo on' : 'Demo mode'}</span>
          {on ? (
            <>
              <span className="dm-detail" style={{ fontSize: 13, color: '#6f5f36' }}> — you&apos;re looking at {business?.name ?? 'the sample business'}, {estate}.</span>
              <span className="dm-extra" style={{ fontSize: 13, color: '#6f5f36' }}> Try closing an incident or signing off a checklist; switch the toggle off to return to your own data.</span>
            </>
          ) : (
            <>
              <span className="dm-detail" style={{ fontSize: 13, color: '#6f5f36' }}> — explore Blueroll with a busy kitchen&apos;s data.</span>
              <span className="dm-extra" style={{ fontSize: 13, color: '#6f5f36' }}> Checks, temperatures, allergens and incidents are pre-filled; nothing you do here touches your own records.</span>
            </>
          )}
        </span>

        {/* Mono state + toggle + hairline + dismiss */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
          <span className="dm-state" style={{ fontSize: 10.5, fontWeight: on ? 700 : 600, color: on ? '#85670f' : '#a89a72', fontFamily: "'Geist Mono', monospace", letterSpacing: '.08em' }}>{on ? 'ON' : 'OFF'}</span>
          <button
            role="switch"
            aria-checked={on}
            aria-label={on ? 'Turn demo mode off' : 'Turn demo mode on'}
            onClick={() => { void toggleDemoMode(!on, router) }}
            style={{
              width: 34, height: 20, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 0, position: 'relative', flexShrink: 0, display: 'block',
              background: on ? 'linear-gradient(180deg, #cfa02a, #b98a12)' : '#e8dcbe',
              boxShadow: on ? 'inset 0 1px 0 rgba(255,255,255,.2)' : 'inset 0 0 0 1px rgba(133,103,15,.14)',
            }}
          >
            <span style={{ position: 'absolute', top: 2.5, left: on ? undefined : 2.5, right: on ? 2.5 : undefined, width: 15, height: 15, borderRadius: '50%', background: '#fff', boxShadow: `0 1px 2.5px rgba(90,70,20,${on ? '.32' : '.28'})` }} />
          </button>
          {!on && (
            <>
              <span style={{ width: 1, height: 16, background: '#ece0c2', margin: '0 2px' }} />
              <button
                aria-label="Hide this bar until next sign-in"
                onClick={() => { dismissDemoBar(); unpinDemoBar(); setDismissed(true) }}
                style={{ width: 26, height: 26, marginRight: -6, borderRadius: 7, border: 'none', background: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#a89a72" strokeWidth="1.6" strokeLinecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  )
}
