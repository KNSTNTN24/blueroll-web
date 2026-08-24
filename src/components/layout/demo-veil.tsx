'use client'

import { useAuthStore } from '@/stores/auth-store'

/**
 * Veil over the CONTENT AREA only while a demo switch is in flight — the
 * sidebar, topbar and the demo bar (with its toggle) stay visible and in
 * place. Always mounted; opacity does the fading so both directions are
 * smooth.
 */
export function DemoVeil() {
  const switching = useAuthStore((s) => s.demoSwitching)
  const active = switching !== null
  const entering = switching === 'enter'

  return (
    <div
      aria-hidden={!active}
      style={{
        position: 'absolute', inset: 0, zIndex: 30,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: entering ? '#fdf9ee' : '#fafbf8',
        opacity: active ? 1 : 0,
        pointerEvents: active ? 'auto' : 'none',
        transition: 'opacity .26s ease',
      }}
    >
      <style>{`@keyframes brDemoDot { 0%, 100% { box-shadow: 0 0 0 0 rgba(199,152,26,.32); } 60% { box-shadow: 0 0 0 5px rgba(199,152,26,0); } }`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        {entering && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #e7d5a6', borderRadius: 8, padding: '6px 12px 6px 9px', boxShadow: '0 1px 1.5px rgba(133,103,15,.07)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#c7981a', animation: 'brDemoDot 1.6s ease-out infinite' }} />
            <span style={{ fontSize: 12.5, fontWeight: 650, color: '#85670f' }}>Demo</span>
          </span>
        )}
        <span style={{ fontSize: 14, fontWeight: 600, color: entering ? '#6f5f36' : '#5c626b' }}>
          {entering ? 'Entering demo mode…' : 'Back to your kitchen…'}
        </span>
      </div>
    </div>
  )
}
