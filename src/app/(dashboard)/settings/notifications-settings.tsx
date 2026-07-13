'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'

// One row per notification kind. `locked` rows are always-on (both channels, non-editable).
interface Row { id: string; name: string; desc: string; locked?: boolean; email?: boolean; push?: boolean }
interface Group { title: string; rows: Row[] }

const GROUPS: Group[] = [
  {
    title: 'Food safety', rows: [
      { id: 'critical', name: 'Critical alerts', desc: 'High-risk incidents, at any site', locked: true, email: true, push: true },
      { id: 'temp_warnings', name: 'Temperature warnings', desc: 'Fridge, freezer or delivery out of range', email: true, push: true },
      { id: 'missed_checks', name: 'Missed checks', desc: 'A checklist wasn’t completed by its deadline', email: true, push: false },
    ],
  },
  {
    title: 'Team', rows: [
      { id: 'invites_joins', name: 'Invites & joins', desc: 'When someone accepts an invite', email: true, push: false },
      { id: 'signoff', name: 'Sign-off requests', desc: 'A completed checklist needs your sign-off', email: false, push: true },
    ],
  },
  {
    title: 'Billing', rows: [
      { id: 'invoices', name: 'Invoices', desc: 'Your monthly invoice is ready', email: true, push: false },
      { id: 'payment_issues', name: 'Payment issues', desc: 'A payment failed or a card is expiring', locked: true, email: true, push: true },
    ],
  },
  {
    title: 'From BlueRoll', rows: [
      { id: 'product_updates', name: 'Product updates', desc: 'New features and improvements', email: false, push: false },
      { id: 'tips', name: 'Tips & guides', desc: 'Getting more out of BlueRoll', email: false, push: false },
    ],
  },
]

function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={on}
      style={{ width: 36, height: 21, flex: 'none', border: 'none', borderRadius: 12, background: on ? '#1f9d63' : '#d4d7db', cursor: disabled ? 'default' : 'pointer', position: 'relative', padding: 0, opacity: disabled ? 0.55 : 1 }}>
      <span style={{ position: 'absolute', top: 2.5, left: on ? 17 : 2.5, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(16,24,40,.25)', transition: 'left .15s' }} />
    </button>
  )
}

export function NotificationsSettings() {
  const business = useAuthStore((s) => s.business)
  const setBusiness = useAuthStore((s) => s.setBusiness)
  const saved = ((business as unknown as { notification_prefs?: Record<string, boolean> })?.notification_prefs) ?? {}

  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    GROUPS.forEach((g) => g.rows.forEach((r) => {
      init[`${r.id}.email`] = saved[`${r.id}.email`] ?? !!r.email
      init[`${r.id}.push`] = saved[`${r.id}.push`] ?? !!r.push
    }))
    init['digest'] = saved['digest'] ?? true
    return init
  })
  const [busy, setBusy] = useState(false)

  async function persist(next: Record<string, boolean>) {
    setPrefs(next)
    if (!business?.id) return
    setBusy(true)
    const { error } = await supabase.from('businesses').update({ notification_prefs: next }).eq('id', business.id)
    setBusy(false)
    if (error) { toast.error(error.message); setPrefs(prefs); return }
    setBusiness({ ...business, notification_prefs: next } as typeof business)
  }
  const flip = (key: string) => () => { if (busy) return; persist({ ...prefs, [key]: !prefs[key] }) }

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: '-.02em' }}>Notifications</h1>
      <p style={{ margin: '6px 0 0', fontSize: 14, color: '#6b7280' }}>Choose what you hear about and where. Critical food-safety alerts can’t be switched off.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 22 }}>
        {GROUPS.map((g) => (
          <div key={g.title} style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 20px 12px' }}>
              <span style={{ font: "700 15px 'Geist'", letterSpacing: '-.01em' }}>{g.title}</span>
              <span style={{ marginLeft: 'auto', font: "600 11px 'Geist'", letterSpacing: '.06em', textTransform: 'uppercase', color: '#9aa0a8', width: 52, textAlign: 'center' }}>Email</span>
              <span style={{ font: "600 11px 'Geist'", letterSpacing: '.06em', textTransform: 'uppercase', color: '#9aa0a8', width: 52, textAlign: 'center' }}>Push</span>
            </div>
            {g.rows.map((r) => {
              const email = r.locked ? true : prefs[`${r.id}.email`]
              const push = r.locked ? true : prefs[`${r.id}.push`]
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 20px', borderTop: '1px solid #f4f5f6' }}>
                  <span style={{ flex: 1, minWidth: 0, opacity: r.locked ? 0.55 : 1 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: "600 13.5px 'Geist'", color: '#16181d' }}>
                      {r.name}
                      {r.locked && <span style={{ font: "600 10.5px 'Geist'", color: '#b07d1e', background: '#fbf3e6', border: '1px solid #f2e2c4', padding: '2px 7px', borderRadius: 10 }}>ALWAYS ON</span>}
                    </span>
                    <span style={{ display: 'block', font: "400 12px 'Geist'", color: '#9aa0a8', marginTop: 1 }}>{r.desc}</span>
                  </span>
                  <span style={{ width: 52, display: 'flex', justifyContent: 'center' }}><Toggle on={email} disabled={r.locked} onClick={flip(`${r.id}.email`)} /></span>
                  <span style={{ width: 52, display: 'flex', justifyContent: 'center' }}><Toggle on={push} disabled={r.locked} onClick={flip(`${r.id}.push`)} /></span>
                </div>
              )
            })}
          </div>
        ))}

        <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)', padding: '17px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 200 }}>
            <span style={{ display: 'block', font: "600 13.5px 'Geist'" }}>Weekly summary email</span>
            <span style={{ display: 'block', font: "400 12px 'Geist'", color: '#9aa0a8', marginTop: 1 }}>Compliance score, missed checks and team activity, every Monday at 8:00</span>
          </span>
          <Toggle on={prefs['digest']} onClick={flip('digest')} />
        </div>
      </div>
    </div>
  )
}
