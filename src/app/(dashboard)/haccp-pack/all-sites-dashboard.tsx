'use client'

import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { HACCP_SECTIONS } from '@/lib/constants'

interface Signoff { site_id: string; signed_by_name: string | null; signed_at: string }
interface Progress { filled: number; total: number; pct: number }

const SECTION_CODE: Record<string, string> = {
  cross: 'CROSS', cleaning: 'CLEAN', chilling: 'CHILL', cooking: 'COOK', management: 'MGMT',
}

const pctColor = (p: number) => (p >= 80 ? '#1f7a52' : p >= 40 ? '#b07d1e' : '#c0403a')

/**
 * HACCP Pack — "All sites" scope. The pack is one shared document for the group
 * (haccp_pack_data is keyed by business_id), so completion is a group figure;
 * what varies per site is whether that site's manager has signed it off.
 */
export function AllSitesDashboard({ sectionProgress, totalProgress, siteProgress, reviewLabel, reviewOverdue, onExportPDF }: {
  sectionProgress: Record<string, Progress>
  totalProgress: Progress
  siteProgress?: Record<string, Progress>
  reviewLabel: string
  reviewOverdue: boolean
  onExportPDF: () => void
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

  const mini = HACCP_SECTIONS.map((s) => ({
    code: SECTION_CODE[s.id] ?? s.id.slice(0, 5).toUpperCase(),
    name: s.name,
    pct: (sectionProgress[s.id] ?? { pct: 0 }).pct,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      {/* page header row */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.02em' }}>HACCP Pack</h1>
          <div style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
            {business?.name ?? 'Your group'} · a pack per site, {sites.length} sites
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: "600 12.5px 'Geist'", padding: '7px 12px', borderRadius: 20, background: '#eaf4ee', color: '#1f7a52', whiteSpace: 'nowrap' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f9d63' }} />
            {signedCount} of {sites.length} sites signed off
          </span>
          <button onClick={onExportPDF}
            style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', background: '#14161b', border: 'none', color: '#fff', font: "600 13.5px 'Geist'", padding: '10px 15px', borderRadius: 10, cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#25282f')} onMouseLeave={(e) => (e.currentTarget.style.background = '#14161b')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><polyline points="7 10 12 15 17 10" /><path d="M4 19h16" /></svg>
            Export PDF
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: '#fff', border: '1px solid #e7e9ec', borderRadius: 16, padding: '17px 18px', boxShadow: '0 1px 2px rgba(16,24,40,.03),0 10px 28px -24px rgba(16,24,40,.14)' }}>
            <div style={{ font: "600 11px 'Geist'", letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa0a8', whiteSpace: 'nowrap' }}>{k.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 26, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: k.color }}>{k.value}</span>
              {k.suffix && <span style={{ font: "600 13px 'Geist'", color: '#c2c6cc' }}>{k.suffix}</span>}
            </div>
            <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* completion by category */}
      <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, padding: '18px 20px 20px', boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Group completion by section</h2>
          <span style={{ font: "500 13px 'Geist'", color: '#8a9099', whiteSpace: 'nowrap' }}>group average across {sites.length} sites</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 22, marginTop: 18 }}>
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

      {/* per-site cards */}
      <div>
        <h2 style={{ margin: '0 0 13px', fontSize: 16, fontWeight: 700 }}>Sites</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 16 }}>
          {sites.map((s) => {
            const so = byId.get(s.id)
            return (
              <div key={s.id} onClick={() => setCurrentSiteId(s.id)} role="button"
                style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, padding: '17px 18px 16px', cursor: 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -30px rgba(16,24,40,.16)', transition: 'box-shadow .14s,border-color .14s' }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 1px 2px rgba(16,24,40,.03),0 18px 40px -26px rgba(16,24,40,.2)'; e.currentTarget.style.borderColor = '#dfe1e5' }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 2px rgba(16,24,40,.03),0 14px 36px -30px rgba(16,24,40,.16)'; e.currentTarget.style.borderColor = '#e9eaed' }}>
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
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    {(() => { const sp = siteProgress?.[s.id] ?? { filled: 0, total: totalProgress.total, pct: 0 }; return (<>
                      <div style={{ font: "700 22px/1 'Geist'", fontVariantNumeric: 'tabular-nums', color: pctColor(sp.pct) }}>{sp.pct}%</div>
                      <div style={{ font: "500 11px 'Geist'", color: '#a3a8b0', marginTop: 3, whiteSpace: 'nowrap' }}>{sp.filled} / {sp.total}</div>
                    </>) })()}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 5, marginTop: 15 }}>
                  {mini.map((m) => (
                    <div key={m.code} title={m.name} style={{ flex: 1 }}>
                      <div style={{ height: 5, borderRadius: 4, background: '#eef0f2', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 4, background: '#1f9d63', width: `${m.pct}%` }} />
                      </div>
                      <div style={{ font: "600 9.5px 'Geist'", letterSpacing: '.04em', color: '#b3b8bf', textAlign: 'center', marginTop: 5 }}>{m.code}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: so ? 'flex-end' : 'space-between', marginTop: 15, paddingTop: 13, borderTop: '1px solid #f2f3f5' }}>
                  {!so && (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <button onClick={(e) => { e.stopPropagation(); remind(s.name) }}
                        style={{ border: '1px solid #e2e4e8', background: '#fff', color: '#5c626b', font: "600 12px 'Geist'", padding: '6px 11px', borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#cdd1d6'; e.currentTarget.style.color = '#1c1f24' }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.color = '#5c626b' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 5 2 6.5 2 6.5H4.5S6.5 14 6.5 9" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>
                        Remind manager
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); confirmSite(s.id) }}
                        style={{ border: 'none', background: '#1f9d63', color: '#fff', font: "600 12px 'Geist'", padding: '6px 11px', borderRadius: 8, cursor: 'pointer' }}>
                        Confirm
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
