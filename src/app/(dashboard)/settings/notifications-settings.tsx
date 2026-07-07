'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'

const PREFS: { key: string; title: string; desc: string; channels: string; default: boolean }[] = [
  { key: 'critical_incident', title: 'Critical incident reported', desc: 'Any site · immediately', channels: 'Email + Push', default: true },
  { key: 'missed_checklist', title: 'Checklist missed at close', desc: 'Any site · end of day', channels: 'Email + Push', default: true },
  { key: 'fsa_change', title: 'FSA rating change', desc: 'Any site', channels: 'Email', default: true },
  { key: 'incident_resolved', title: 'Incident resolved', desc: 'Sites you manage', channels: 'Push', default: false },
  { key: 'weekly_digest', title: 'Weekly estate digest', desc: 'Compliance summary across all sites · Monday 08:00', channels: 'Email', default: true },
]

export function NotificationsSettings() {
  const business = useAuthStore((s) => s.business)
  const setBusiness = useAuthStore((s) => s.setBusiness)
  const saved = ((business as unknown as { notification_prefs?: Record<string, boolean> })?.notification_prefs) ?? {}

  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    PREFS.forEach((p) => { init[p.key] = saved[p.key] ?? p.default })
    return init
  })
  const [busy, setBusy] = useState(false)

  async function toggle(key: string) {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    if (!business?.id) return
    setBusy(true)
    const { error } = await supabase.from('businesses').update({ notification_prefs: next }).eq('id', business.id)
    setBusy(false)
    if (error) { toast.error(error.message); setPrefs(prefs); return }
    setBusiness({ ...business, notification_prefs: next } as typeof business)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-.01em', color: '#16181d' }}>Notifications</h1>
        <div style={{ color: '#6b7280', fontSize: 13.5, marginTop: 4 }}>What reaches you, and how — per event type</div>
      </div>
      <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)', overflow: 'hidden' }}>
        {PREFS.map((p, i) => {
          const on = prefs[p.key]
          return (
            <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 20px', borderBottom: i === PREFS.length - 1 ? 'none' : '1px solid #f2f3f5' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</div>
                <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 2 }}>{p.desc}</div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#9aa0a8', whiteSpace: 'nowrap', flex: 'none' }}>{p.channels}</span>
              <button onClick={() => toggle(p.key)} disabled={busy} aria-pressed={on}
                style={{ width: 40, height: 23, borderRadius: 20, border: 'none', background: on ? '#1f9d63' : '#d7dade', cursor: busy ? 'default' : 'pointer', position: 'relative', flex: 'none', padding: 0 }}>
                <span style={{ position: 'absolute', top: 2.5, left: on ? 'auto' : 3, right: on ? 3 : 'auto', width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(16,24,40,.2)' }} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
