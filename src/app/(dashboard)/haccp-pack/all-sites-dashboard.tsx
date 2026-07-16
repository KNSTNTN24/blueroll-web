'use client'

import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { BellRing, Check } from 'lucide-react'
import { HACCP_SECTIONS } from '@/lib/constants'

interface Signoff { site_id: string; signed_by_name: string | null; signed_at: string }
interface Progress { filled: number; total: number; pct: number }

/**
 * Group-level HACCP view, shown when the scope is "All sites".
 *
 * The pack itself is ONE shared document for the group (haccp_pack_data is keyed
 * by business_id), so completion is a group number — what differs per site is
 * whether that site's manager has signed the pack off.
 */
export function AllSitesDashboard({ sectionProgress, totalProgress, reviewLabel, reviewOverdue }: {
  sectionProgress: Record<string, Progress>
  totalProgress: Progress
  reviewLabel: string
  reviewOverdue: boolean
}) {
  const business = useAuthStore((s) => s.business)
  const profile = useAuthStore((s) => s.profile)
  const sites = useAuthStore((s) => s.sites)
  const setCurrentSiteId = useAuthStore((s) => s.setCurrentSiteId)
  const qc = useQueryClient()
  const bid = business?.id

  const { data: signoffs = [] } = useQuery({
    queryKey: ['haccp-signoffs', bid],
    enabled: !!bid,
    queryFn: async () => {
      const { data } = await supabase.from('haccp_signoffs').select('site_id, signed_by_name, signed_at').eq('business_id', bid!)
      return (data ?? []) as Signoff[]
    },
  })

  const byId = useMemo(() => { const m = new Map<string, Signoff>(); signoffs.forEach((s) => m.set(s.site_id, s)); return m }, [signoffs])
  const signedCount = sites.filter((s) => byId.has(s.id)).length
  const pendingCount = sites.length - signedCount

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const pctColor = (p: number) => (p >= 80 ? '#1f7a52' : p >= 40 ? '#b07d1e' : '#c0403a')

  function remind(name: string) { toast.success(`Reminder sent to ${name}`) }
  async function confirmSite(siteId: string) {
    if (!bid) return
    const { error } = await supabase.from('haccp_signoffs').insert({
      business_id: bid, site_id: siteId, signed_by: profile?.id ?? null, signed_by_name: profile?.full_name ?? null,
    })
    if (error) { toast.error(error.message); return }
    toast.success('Pack signed off for this site')
    qc.invalidateQueries({ queryKey: ['haccp-signoffs', bid] })
  }

  const kpis = [
    { label: 'Pack completion', value: `${totalProgress.pct}`, suffix: '%', sub: `${totalProgress.filled} of ${totalProgress.total} fields`, color: pctColor(totalProgress.pct) },
    { label: 'Sites signed off', value: `${signedCount}`, suffix: `/ ${sites.length}`, sub: 'managers confirmed the pack', color: signedCount === sites.length ? '#1f7a52' : '#16181d' },
    { label: 'Awaiting sign-off', value: `${pendingCount}`, suffix: '', sub: pendingCount ? 'needs a manager to confirm' : 'all sites confirmed', color: pendingCount ? '#b07d1e' : '#1f7a52' },
    { label: 'Pack review', value: reviewOverdue ? 'Due' : 'Current', suffix: '', sub: reviewLabel, color: reviewOverdue ? '#c0403a' : '#1f7a52' },
  ]

  const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e7e9ec', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 10px 28px -24px rgba(16,24,40,.14)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ ...CARD, padding: '17px 18px' }}>
            <div style={{ font: "600 11px 'Geist'", letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa0a8', whiteSpace: 'nowrap' }}>{k.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 26, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: k.color }}>{k.value}</span>
              {k.suffix && <span style={{ font: "600 13px 'Geist'", color: '#c2c6cc' }}>{k.suffix}</span>}
            </div>
            <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Completion by section (the shared group pack) */}
      <div style={{ ...CARD, borderColor: '#e9eaed', padding: '18px 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Group completion by section</h2>
          <span style={{ font: "500 13px 'Geist'", color: '#8a9099' }}>one shared pack across all {sites.length} sites</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 22, marginTop: 18 }}>
          {HACCP_SECTIONS.map((s) => {
            const p = sectionProgress[s.id] ?? { pct: 0, filled: 0, total: 0 }
            return (
              <div key={s.id}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ font: "600 13.5px 'Geist'", color: '#23262c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                  <span style={{ font: "700 13.5px 'Geist'", color: '#1f7a52', fontVariantNumeric: 'tabular-nums' }}>{p.pct}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 6, background: '#eef0f2', marginTop: 9, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 6, background: '#1f9d63', width: `${p.pct}%`, transition: 'width .4s' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-site cards — sign-off is what differs per site */}
      <div>
        <h2 style={{ margin: '0 0 13px', fontSize: 16, fontWeight: 700 }}>Sites</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 16 }}>
          {sites.map((s) => {
            const so = byId.get(s.id)
            return (
              <div key={s.id} onClick={() => setCurrentSiteId(s.id)} role="button"
                style={{ ...CARD, borderColor: '#e9eaed', padding: '17px 18px 16px', cursor: 'pointer', transition: 'box-shadow .14s, border-color .14s' }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 1px 2px rgba(16,24,40,.03),0 18px 40px -26px rgba(16,24,40,.2)'; e.currentTarget.style.borderColor = '#dfe1e5' }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = CARD.boxShadow as string; e.currentTarget.style.borderColor = '#e9eaed' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ font: "700 15.5px 'Geist'", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: so ? '#1f9d63' : '#d98a1a' }} />
                      <span style={{ font: "500 12px 'Geist'", color: '#8a9099', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {so ? `Signed off ${fmt(so.signed_at)}${so.signed_by_name ? ` · ${so.signed_by_name}` : ''}` : 'Awaiting sign-off'}
                      </span>
                    </div>
                  </div>
                  <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, font: "600 11.5px 'Geist'", padding: '4px 9px', borderRadius: 20, background: so ? '#eaf4ee' : '#fbf1e1', color: so ? '#1f7a52' : '#b07d1e' }}>
                    {so && <Check className="h-3 w-3" strokeWidth={2.6} />}{so ? 'Signed' : 'Pending'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 15, paddingTop: 13, borderTop: '1px solid #f2f3f5' }}>
                  {so ? <span /> : (
                    <span style={{ display: 'flex', gap: 8 }}>
                      <button onClick={(e) => { e.stopPropagation(); remind(s.name) }}
                        style={{ border: '1px solid #e2e4e8', background: '#fff', color: '#5c626b', font: "600 12px 'Geist'", padding: '6px 11px', borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <BellRing className="h-3 w-3" strokeWidth={1.8} /> Remind manager
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); confirmSite(s.id) }}
                        style={{ border: 'none', background: '#1f9d63', color: '#fff', font: "600 12px 'Geist'", padding: '6px 11px', borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Check className="h-3 w-3" strokeWidth={2.6} /> Confirm
                      </button>
                    </span>
                  )}
                  <span style={{ font: "600 12.5px 'Geist'", color: '#1f9d63', whiteSpace: 'nowrap' }}>Open pack →</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
