'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { format, startOfDay, subDays } from 'date-fns'
import { Download, ChevronRight, ChevronDown, Snowflake, Users, AlertTriangle } from 'lucide-react'

type SiteStatus = 'on track' | 'attention' | 'at risk' | 'onboarding'

const STATUS = {
  'on track': { bg: '#eaf4ee', color: '#1f7a52', dot: '#1f9d63', label: 'On track' },
  attention: { bg: '#fbf1e1', color: '#b07d1e', dot: '#d98a1a', label: 'Attention' },
  'at risk': { bg: '#fbecec', color: '#c0403a', dot: '#d2453f', label: 'Critical' },
  onboarding: { bg: '#f1f2f4', color: '#5c626b', dot: '#9aa0a8', label: 'Onboarding' },
} as const

const TILE = ['#1f7a52', '#5b6472', '#8a6d52', '#4e6e81']
const codeOf = (n: string) => { const p = n.split(' ').filter(Boolean); return (p.length >= 2 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase() }

export function EstateDashboard() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const profile = useAuthStore((s) => s.profile)
  const setCurrentSiteId = useAuthStore((s) => s.setCurrentSiteId)
  const bid = business?.id
  const firstName = profile?.full_name?.split(' ')[0] ?? ''
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const ds = startOfDay(new Date()).toISOString()
  const [filter, setFilter] = useState<'all' | 'attention' | 'ontrack'>('all')
  const [sortByRisk, setSortByRisk] = useState(true)

  const { data: templates = [] } = useQuery({ queryKey: ['estate-templates', bid], enabled: !!bid, queryFn: async () => (await supabase.from('checklist_templates').select('site_id').eq('business_id', bid!).eq('active', true)).data ?? [] })
  const { data: done = [] } = useQuery({ queryKey: ['estate-done', bid, ds], enabled: !!bid, queryFn: async () => (await supabase.from('checklist_completions').select('site_id').eq('business_id', bid!).gte('completed_at', ds)).data ?? [] })
  const { data: incidents = [] } = useQuery({ queryKey: ['estate-incidents', bid], enabled: !!bid, queryFn: async () => (await supabase.from('incidents').select('site_id, status, type').eq('business_id', bid!)).data ?? [] })
  const { data: members = [] } = useQuery({ queryKey: ['estate-members', bid], enabled: !!bid, queryFn: async () => (await supabase.from('profiles').select('id, full_name, site_id').eq('business_id', bid!)).data ?? [] })
  const from14 = subDays(startOfDay(new Date()), 13).toISOString()
  const { data: hist = [] } = useQuery({ queryKey: ['estate-hist', bid, from14], enabled: !!bid, queryFn: async () => (await supabase.from('checklist_completions').select('site_id, completed_at').eq('business_id', bid!).gte('completed_at', from14)).data ?? [] })

  const managerName = (id: string | null) => (members as { id: string; full_name: string }[]).find((m) => m.id === id)?.full_name ?? null

  const perSite = useMemo(() => {
    const count = (rows: { site_id: string }[], sid: string) => rows.filter((r) => r.site_id === sid).length
    const todayStart = startOfDay(new Date()).getTime()
    return sites.map((site, i) => {
      const total = count(templates, site.id)
      const d = count(done, site.id)
      const pct = total > 0 ? Math.round((d / total) * 100) : 0
      const open = incidents.filter((x) => x.site_id === site.id && x.status === 'open').length
      const buckets = Array(14).fill(0)
      hist.forEach((h) => {
        if (h.site_id !== site.id) return
        const off = Math.floor((todayStart - startOfDay(new Date(h.completed_at)).getTime()) / 86400000)
        if (off >= 0 && off <= 13) buckets[13 - off] += 1
      })
      const spark = buckets.map((c) => (total > 0 ? Math.min(1, c / total) : 0))
      let status: SiteStatus
      if (site.status === 'onboarding') status = 'onboarding'
      else if (open >= 3 || pct < 25) status = 'at risk'
      else if (open === 0 && pct >= 45) status = 'on track'
      else status = 'attention'
      const mgrCount = (members as { site_id: string }[]).filter((m) => m.site_id === site.id).length
      return { site, total, done: d, pct, open, status, spark, color: TILE[i % TILE.length], manager: managerName(site.manager_id), mgrCount }
    })
  }, [sites, templates, done, incidents, hist, members])

  const est = useMemo(() => {
    const totalT = perSite.reduce((s, x) => s + x.total, 0)
    const totalD = perSite.reduce((s, x) => s + x.done, 0)
    const overdue = perSite.reduce((s, x) => s + Math.max(0, x.total - x.done), 0)
    const worst = [...perSite].sort((a, b) => (b.total - b.done) - (a.total - a.done))[0]
    const openInc = incidents.filter((x) => x.status === 'open')
    return {
      checksPct: totalT > 0 ? Math.round((totalD / totalT) * 100) : 0,
      onTrack: perSite.filter((x) => x.status === 'on track').length,
      openInc: openInc.length,
      critical: openInc.filter((x) => x.type === 'complaint').length,
      sitesWithInc: new Set(openInc.map((x) => x.site_id)).size,
      overdue,
      overdueSite: worst?.site.name ?? '—',
    }
  }, [perSite, incidents])

  const attentionCount = perSite.filter((x) => x.status !== 'on track').length
  const triage = perSite.filter((x) => x.status === 'at risk' || x.status === 'onboarding' || x.open >= 2)
    .sort((a, b) => (b.open - a.open) || (a.pct - b.pct)).slice(0, 3)

  const rankOrder = { 'at risk': 0, onboarding: 1, attention: 2, 'on track': 3 } as Record<SiteStatus, number>
  const rows = perSite
    .filter((x) => filter === 'all' || (filter === 'attention' ? x.status !== 'on track' : x.status === 'on track'))
    .sort((a, b) => sortByRisk ? (rankOrder[a.status] - rankOrder[b.status] || a.pct - b.pct) : a.site.name.localeCompare(b.site.name))

  const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)' }
  const EYEBROW: React.CSSProperties = { font: "600 11px 'Geist'", letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa0a8', whiteSpace: 'nowrap' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.02em' }}>{greet}, {firstName}</h1>
          <div style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>{format(new Date(), 'EEEE, d MMMM yyyy')} · {business?.name ?? 'Group'} · {sites.length} sites</div>
        </div>
        <button style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', background: '#fff', border: '1px solid #e2e4e8', color: '#41464d', fontSize: 13.5, fontWeight: 600, padding: '10px 15px', borderRadius: 10, cursor: 'pointer' }}>
          <Download className="h-4 w-4" strokeWidth={1.8} /> Weekly report
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ ...CARD, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, padding: '17px 20px', minWidth: 0 }}>
          <div style={EYEBROW}>Checks today</div>
          <div style={{ fontWeight: 700, fontSize: 27, fontVariantNumeric: 'tabular-nums', lineHeight: 1, marginTop: 9, color: '#1c1f24' }}>{est.checksPct}%</div>
          <div style={{ height: 4, borderRadius: 2, background: '#eef0f2', overflow: 'hidden', marginTop: 11, maxWidth: 130 }}><div style={{ height: '100%', background: '#1f9d63', borderRadius: 2, width: `${est.checksPct}%` }} /></div>
        </div>
        <Divider />
        <div style={{ flex: 1, padding: '17px 20px', minWidth: 0 }}>
          <div style={EYEBROW}>Sites on track</div>
          <div style={{ fontWeight: 700, fontSize: 27, fontVariantNumeric: 'tabular-nums', lineHeight: 1, marginTop: 9, color: '#1c1f24' }}>{est.onTrack}<span style={{ color: '#c2c6cc', fontSize: 18 }}>/{sites.length}</span></div>
          <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 9, whiteSpace: 'nowrap' }}>{attentionCount} need attention</div>
        </div>
        <Divider />
        <div style={{ flex: 1, padding: '17px 20px', minWidth: 0 }}>
          <div style={EYEBROW}>Open incidents</div>
          <div style={{ fontWeight: 700, fontSize: 27, fontVariantNumeric: 'tabular-nums', lineHeight: 1, marginTop: 9, color: '#1c1f24' }}>{est.openInc}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#8a9099', marginTop: 9, whiteSpace: 'nowrap' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d2453f', flex: 'none' }} />{est.critical} complaint{est.critical === 1 ? '' : 's'} · {est.sitesWithInc} sites</div>
        </div>
        <Divider />
        <div style={{ flex: 1, padding: '17px 20px', minWidth: 0 }}>
          <div style={EYEBROW}>Overdue tasks</div>
          <div style={{ fontWeight: 700, fontSize: 27, fontVariantNumeric: 'tabular-nums', lineHeight: 1, marginTop: 9, color: '#1c1f24' }}>{est.overdue}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#8a9099', marginTop: 9, whiteSpace: 'nowrap' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d98a1a', flex: 'none' }} />most at {est.overdueSite}</div>
        </div>
      </div>

      {/* needs attention triage */}
      {triage.length > 0 && (
        <div style={{ ...CARD, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Needs attention today</h2>
            <span style={{ font: "600 11.5px 'Geist'", background: '#fbf1e1', color: '#b07d1e', padding: '3px 8px', borderRadius: 20 }}>{triage.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, marginTop: 14 }}>
            {triage.map((x) => {
              const st = STATUS[x.status]
              return (
                <div key={x.site.id} style={{ border: '1px solid #eef0f2', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: st.dot }} />
                    <span style={{ font: "600 14.5px 'Geist'", color: '#1c1f24' }}>{x.site.name}</span>
                    <span style={{ marginLeft: 'auto', font: "600 11.5px 'Geist'", padding: '3px 9px', borderRadius: 20, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>{x.status === 'onboarding' ? 'Onboarding' : `${x.open} open`}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#5c626b', lineHeight: 1.5 }}>
                    {x.status === 'onboarding'
                      ? `New site — still finishing first-week checks. Completion at ${x.pct}%.`
                      : `Checks at ${x.pct}% today${x.open ? ` and ${x.open} open incident${x.open > 1 ? 's' : ''}` : ''}. Needs a look before service.`}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <button onClick={() => setCurrentSiteId(x.site.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #bfe0cd', background: '#f5faf7', color: '#1a6e49', font: "600 12.5px 'Geist'", padding: '7px 12px', borderRadius: 9, cursor: 'pointer' }}>Open site</button>
                    <span style={{ fontSize: 12, color: '#9aa0a8' }}>{x.manager ?? 'No manager yet'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* sites table */}
      <div style={{ ...CARD, overflow: 'hidden', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px 12px', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Sites</h2>
          <div style={{ display: 'flex', gap: 3, background: '#eceef1', padding: 4, borderRadius: 11, marginLeft: 6 }}>
            {([['all', 'All', sites.length], ['attention', 'Needs attention', attentionCount], ['ontrack', 'On track', est.onTrack]] as const).map(([k, label, n]) => {
              const on = filter === k
              return (
                <button key={k} onClick={() => setFilter(k)}
                  style={{ border: 'none', cursor: 'pointer', background: on ? '#fff' : 'none', color: on ? '#1c1f24' : '#5c626b', font: "600 12.5px 'Geist'", padding: '6px 13px', borderRadius: 8, boxShadow: on ? '0 1px 2px rgba(16,24,40,.08)' : 'none', whiteSpace: 'nowrap' }}>
                  {label} <span style={{ color: on ? '#9aa0a8' : '#b8bdc4', fontWeight: 500 }}>{n}</span>
                </button>
              )
            })}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: '#9aa0a8' }}>Sort</span>
            <button onClick={() => setSortByRisk((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #e2e4e8', background: '#fff', color: '#41464d', font: "600 12.5px 'Geist'", padding: '7px 12px', borderRadius: 9, cursor: 'pointer' }}>
              {sortByRisk ? 'Most at risk' : 'Name A–Z'} <ChevronDown className="h-3 w-3" strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr 150px 120px 110px 40px', gap: 14, alignItems: 'center', padding: '9px 20px', borderTop: '1px solid #eef0f2', borderBottom: '1px solid #eef0f2', background: '#fbfbfc' }}>
              {['Site', 'Checks today', 'Last 14 days', 'Incidents', 'Status', ''].map((h, i) => (
                <div key={i} style={{ font: "600 10.5px 'Geist'", letterSpacing: '.06em', textTransform: 'uppercase', color: '#9aa0a8' }}>{h}</div>
              ))}
            </div>
            {rows.map((x) => {
              const st = STATUS[x.status]
              const barColor = x.pct >= 60 ? '#1f9d63' : x.pct >= 25 ? '#d98a1a' : '#d2453f'
              return (
                <div key={x.site.id} className="ms-row" onClick={() => setCurrentSiteId(x.site.id)}
                  style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr 150px 120px 110px 40px', gap: 14, alignItems: 'center', padding: '13px 20px', borderBottom: '1px solid #f2f3f5', cursor: 'pointer', transition: 'background .14s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 12px 'Geist'", flex: 'none', background: x.color }}>{codeOf(x.site.name)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: "600 14.5px 'Geist'", color: '#1c1f24', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.site.name}</div>
                      <div style={{ fontSize: 12, color: '#8a9099', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.manager ?? `${x.mgrCount} member${x.mgrCount === 1 ? '' : 's'}`}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ flex: 1, height: 5, borderRadius: 3, background: '#eef0f2', overflow: 'hidden', maxWidth: 110 }}><div style={{ height: '100%', borderRadius: 3, background: barColor, width: `${x.pct}%` }} /></div>
                    <span style={{ font: "600 12.5px 'Geist'", color: '#41464d', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{x.done}/{x.total}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
                    {x.spark.map((r, idx) => (
                      <span key={idx} style={{ width: 8, height: 4 + Math.round(r * 12), borderRadius: 3, background: r >= 0.6 ? '#8fc3a4' : r > 0.15 ? '#e2b87e' : '#e6e8ea' }} />
                    ))}
                  </div>
                  <div>
                    {x.open > 0 ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: "600 12.5px 'Geist'", color: x.open >= 3 ? '#c0403a' : '#b07d1e', fontVariantNumeric: 'tabular-nums' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: x.open >= 3 ? '#d2453f' : '#d98a1a' }} />{x.open} open</span>
                    ) : <span style={{ font: "500 12.5px 'Geist'", color: '#b0b5bc' }}>—</span>}
                  </div>
                  <div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: "600 12px 'Geist'", padding: '5px 10px', borderRadius: 20, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot }} />{st.label}</span>
                  </div>
                  <div className="ms-go" style={{ display: 'flex', justifyContent: 'flex-end', color: '#9aa0a8' }}>
                    <ChevronRight className="h-[17px] w-[17px]" strokeWidth={1.8} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* patterns */}
      <div style={{ ...CARD, padding: '18px 20px' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Patterns across sites</h2>
        <div style={{ fontSize: 13, color: '#8a9099', marginTop: 3 }}>Recurring issues this month — fix once, roll out everywhere</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12, marginTop: 14 }}>
          <PatternCard icon={<Snowflake className="h-4 w-4" strokeWidth={1.8} />} color="#4e6e81" title="Fridge & freezer checks are the most-missed task" detail="Skipped most often on the mid-morning round. Consider moving it into the opening checklist." />
          <PatternCard icon={<Users className="h-4 w-4" strokeWidth={1.8} />} color="#b07d1e" title="Completion dips at the lowest-staffed sites" detail={`${est.overdueSite} is furthest behind today — thin cover overlaps with the closing checks.`} />
          <PatternCard icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.8} />} color="#1f7a52" title="Your benchmark site sets the bar" detail={`${[...perSite].sort((a, b) => b.pct - a.pct)[0]?.site.name ?? 'Top site'} leads on checks with the fewest incidents — worth copying their routine.`} />
        </div>
      </div>

      <style>{`.ms-row .ms-go{opacity:0;transition:opacity .14s}.ms-row:hover .ms-go{opacity:1}`}</style>
    </div>
  )
}

function Divider() {
  return <div style={{ width: 1, background: '#eef0f2', margin: '15px 0' }} />
}

function PatternCard({ icon, color, title, detail }: { icon: React.ReactNode; color: string; title: string; detail: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, border: '1px solid #eef0f2', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: '#f5f6f7', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', color }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "600 13.5px 'Geist'", color: '#1c1f24', lineHeight: 1.4 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 3, lineHeight: 1.45 }}>{detail}</div>
      </div>
    </div>
  )
}
