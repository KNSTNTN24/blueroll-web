'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const PREFS: { key: string; label: string; desc: string; default: boolean }[] = [
  { key: 'critical_incident', label: 'Critical incident', desc: 'A high-severity incident is reported at any site', default: true },
  { key: 'missed_checklist', label: 'Missed checklist', desc: 'A required checklist is not completed by its deadline', default: true },
  { key: 'fsa_change', label: 'FSA rating change', desc: 'A site’s Food Hygiene Rating changes on the register', default: true },
  { key: 'incident_resolved', label: 'Incident resolved', desc: 'An open incident is marked resolved', default: false },
  { key: 'weekly_digest', label: 'Weekly estate digest', desc: 'A Monday summary across all sites', default: true },
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
    <div className="rounded-[14px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <h2 className="text-[16px] font-bold text-foreground">Notifications</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">Choose what the group is alerted about. Applies across every site.</p>

      <div className="mt-4 divide-y divide-[#f2f3f5]">
        {PREFS.map((p) => (
          <div key={p.key} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-foreground">{p.label}</div>
              <div className="text-[12.5px] text-muted-foreground">{p.desc}</div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => toggle(p.key)}
              aria-pressed={prefs[p.key]}
              className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60', prefs[p.key] ? 'bg-brand' : 'bg-zinc-300')}
            >
              <span className={cn('absolute top-0.5 block h-5 w-5 rounded-full bg-white shadow-sm transition-[left]', prefs[p.key] ? 'left-[22px]' : 'left-0.5')} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
