'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { AlertTriangle, TrendingUp, ChevronRight, Sparkles } from 'lucide-react'
import { format, startOfDay, subDays } from 'date-fns'

type SiteStatus = 'on track' | 'attention' | 'at risk' | 'onboarding'

function statusStyle(s: SiteStatus) {
  switch (s) {
    case 'on track': return { pill: 'bg-brand-tint text-brand-deep', dot: '#1f9d63', accent: '#cde3d4' }
    case 'attention': return { pill: 'bg-[#fbf1e1] text-[#b07d1e]', dot: '#d98a1a', accent: '#e2b87e' }
    case 'at risk': return { pill: 'bg-[#fbecec] text-[#c0403a]', dot: '#d2453f', accent: '#d2453f' }
    case 'onboarding': return { pill: 'bg-secondary text-muted-foreground', dot: '#9aa0a8', accent: '#c9ccd1' }
  }
}

function initials(name: string) {
  const p = name.split(' ').filter(Boolean)
  return (p.length >= 2 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase()
}
const AVATAR = ['#1f7a52', '#5b6472', '#8a6d52', '#3f6d8a', '#7a5b6f']

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

  const { data: templates = [] } = useQuery({ queryKey: ['estate-templates', bid], enabled: !!bid, queryFn: async () => (await supabase.from('checklist_templates').select('site_id').eq('business_id', bid!).eq('active', true)).data ?? [] })
  const { data: done = [] } = useQuery({ queryKey: ['estate-done', bid, ds], enabled: !!bid, queryFn: async () => (await supabase.from('checklist_completions').select('site_id').eq('business_id', bid!).gte('completed_at', ds)).data ?? [] })
  const { data: incidents = [] } = useQuery({ queryKey: ['estate-incidents', bid], enabled: !!bid, queryFn: async () => (await supabase.from('incidents').select('site_id, status, type').eq('business_id', bid!)).data ?? [] })
  const { data: onShift = [] } = useQuery({ queryKey: ['estate-shift', bid, ds], enabled: !!bid, queryFn: async () => (await supabase.from('staff_checkins').select('site_id').eq('business_id', bid!).is('checked_out_at', null).gte('checked_in_at', ds)).data ?? [] })
  const from14 = subDays(startOfDay(new Date()), 13).toISOString()
  const { data: hist = [] } = useQuery({ queryKey: ['estate-hist', bid, from14], enabled: !!bid, queryFn: async () => (await supabase.from('checklist_completions').select('site_id, completed_at').eq('business_id', bid!).gte('completed_at', from14)).data ?? [] })

  const perSite = useMemo(() => {
    const count = (rows: any[], sid: string) => rows.filter((r) => r.site_id === sid).length
    const todayStart = startOfDay(new Date()).getTime()
    return sites.map((site, i) => {
      const total = count(templates, site.id)
      const d = count(done, site.id)
      const pct = total > 0 ? Math.round((d / total) * 100) : 0
      const open = incidents.filter((x) => x.site_id === site.id && x.status === 'open').length
      const shift = count(onShift, site.id)
      // Last-14-days completion ratio per day (index 0 = 13 days ago, 13 = today).
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
      return { site, total, done: d, pct, open, shift, status, spark, color: AVATAR[i % AVATAR.length] }
    })
  }, [sites, templates, done, incidents, onShift, hist])

  const est = useMemo(() => {
    const totalT = perSite.reduce((s, x) => s + x.total, 0)
    const totalD = perSite.reduce((s, x) => s + x.done, 0)
    const overdue = perSite.reduce((s, x) => s + Math.max(0, x.total - x.done), 0)
    const worst = [...perSite].sort((a, b) => (b.total - b.done) - (a.total - a.done))[0]
    return {
      checksPct: totalT > 0 ? Math.round((totalD / totalT) * 100) : 0,
      onTrack: perSite.filter((x) => x.status === 'on track').length,
      openInc: incidents.filter((x) => x.status === 'open').length,
      sitesWithInc: new Set(incidents.filter((x) => x.status === 'open').map((x) => x.site_id)).size,
      overdue,
      overdueSite: worst?.site.name ?? '—',
    }
  }, [perSite, incidents])

  const attention = perSite.filter((x) => x.status === 'at risk' || x.status === 'onboarding' || x.open >= 2)
    .sort((a, b) => (b.open - a.open) || (a.pct - b.pct)).slice(0, 3)

  const rows = perSite
    .filter((x) => filter === 'all' || (filter === 'attention' ? x.status !== 'on track' : x.status === 'on track'))
    .sort((a, b) => {
      const order = { 'at risk': 0, onboarding: 1, attention: 2, 'on track': 3 } as Record<SiteStatus, number>
      return order[a.status] - order[b.status] || (a.pct - b.pct)
    })

  const attentionCount = perSite.filter((x) => x.status !== 'on track').length

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Greeting */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-foreground">{greet}, {firstName}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {format(new Date(), 'EEEE, d MMMM yyyy')} · {business?.name ?? 'Group'} · {sites.length} sites
          </p>
        </div>
        <button className="rounded-[10px] border border-input bg-card px-3.5 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-accent">
          Weekly report
        </button>
      </div>

      {/* Estate metric strip */}
      <div className="grid grid-cols-2 divide-y divide-[#eef0f2] overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,.04)] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        <Metric label="Checks today" value={`${est.checksPct}%`} sub="across all sites" />
        <Metric label="Sites on track" value={`${est.onTrack}/${sites.length}`} sub={`${attentionCount} need attention`} subClass={attentionCount ? 'text-amber' : undefined} />
        <Metric label="Open incidents" value={String(est.openInc)} sub={`${est.sitesWithInc} sites`} icon />
        <Metric label="Overdue tasks" value={String(est.overdue)} sub={`most at ${est.overdueSite}`} />
      </div>

      {/* Needs attention today */}
      {attention.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-[16px] font-bold text-foreground">Needs attention today</h2>
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
            {attention.map((x) => {
              const st = statusStyle(x.status)
              return (
                <button key={x.site.id} onClick={() => setCurrentSiteId(x.site.id)}
                  className="flex flex-col rounded-[14px] border border-border bg-card p-4 text-left shadow-[0_1px_2px_rgba(16,24,40,.04)] transition-shadow hover:shadow-[0_4px_14px_-8px_rgba(16,24,40,.18)]">
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-bold text-foreground">{x.site.name}</span>
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold', st.pill)}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} />
                      {x.status === 'onboarding' ? 'Onboarding' : x.status === 'at risk' ? `${x.open} open` : `${x.open} open`}
                    </span>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-[1.45] text-[#5c626b]">
                    {x.status === 'onboarding'
                      ? `New site — completion unstable at ${x.pct}%. Team still finishing checklist training.`
                      : `Checks at ${x.pct}% today${x.open ? ` and ${x.open} open incident${x.open > 1 ? 's' : ''}` : ''}. Needs a look before service.`}
                  </p>
                  <span className="mt-2.5 inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-brand-deep">
                    Open site <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Sites table */}
      <section className="rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <h2 className="text-[16px] font-bold text-foreground">Sites</h2>
          <div className="flex gap-1 rounded-[10px] bg-secondary p-0.5">
            {([['all', `All ${sites.length}`], ['attention', `Needs attention ${attentionCount}`], ['ontrack', `On track ${est.onTrack}`]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} className={cn('rounded-[7px] px-2.5 py-1 text-[12px] font-semibold transition-colors', filter === k ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,.06)]' : 'text-muted-foreground')}>{label}</button>
            ))}
          </div>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                <th className="px-4 py-2.5">Site</th>
                <th className="px-3 py-2.5">Checks today</th>
                <th className="px-3 py-2.5 w-[160px]">Last 14 days</th>
                <th className="px-3 py-2.5">Incidents</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const st = statusStyle(x.status)
                return (
                  <tr key={x.site.id} onClick={() => setCurrentSiteId(x.site.id)}
                    className="cursor-pointer border-b border-[#f2f3f5] transition-colors last:border-0 hover:bg-[#fafbfb]">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: x.color }}>{initials(x.site.name)}</span>
                        <span className="font-semibold text-foreground">{x.site.name}</span>
                        {x.site.status === 'onboarding' && <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">New</span>}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono tabular-nums text-[#41464d]">{x.done}/{x.total}</td>
                    <td className="px-3 py-3">
                      <span className="flex items-end gap-[3px]" title="Checks completed each of the last 14 days">
                        {x.spark.map((r, idx) => (
                          <span key={idx} className="w-[5px] rounded-[2px]" style={{ height: 18, background: r >= 0.6 ? '#8fc3a4' : r > 0.15 ? '#e2b87e' : '#e2e4e8' }} />
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-[#41464d]">{x.open || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-[11px] py-[5px] text-[12px] font-semibold capitalize', st.pill)}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} />
                        {x.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Patterns across sites */}
      <section className="rounded-[14px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand" strokeWidth={1.8} />
          <h2 className="text-[16px] font-bold text-foreground">Patterns across sites</h2>
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">Recurring issues this month — fix once, roll out everywhere.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Pattern icon={<AlertTriangle className="h-4 w-4 text-amber" strokeWidth={1.9} />} title="Fridge & freezer checks are the most-missed task"
            body="Skipped most often on the mid-morning round. Consider moving it into the opening checklist." />
          <Pattern icon={<TrendingUp className="h-4 w-4 text-amber" strokeWidth={1.9} />} title="Completion dips at the lowest-staffed sites"
            body={`${est.overdueSite} is furthest behind today — thin cover overlaps with the closing checks.`} />
          <Pattern icon={<Sparkles className="h-4 w-4 text-brand-deep" strokeWidth={1.9} />} title="Your benchmark site sets the bar"
            body={`${[...perSite].sort((a, b) => b.pct - a.pct)[0]?.site.name ?? 'Top site'} leads on checks with the fewest incidents — worth copying their routine estate-wide.`} />
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value, sub, subClass, icon }: { label: string; value: string; sub: string; subClass?: string; icon?: boolean }) {
  return (
    <div className="flex items-center gap-3.5 px-5 py-4">
      {icon && (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-amber-tint">
          <AlertTriangle className="h-[18px] w-[18px] text-amber" strokeWidth={1.7} />
        </div>
      )}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-[22px] font-bold tabular-nums leading-none text-foreground">{value}</p>
        <p className={cn('mt-1 text-[12px]', subClass ?? 'text-muted-foreground')}>{sub}</p>
      </div>
    </div>
  )
}

function Pattern({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-[#fafbfb] p-3.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{icon}</span>
        <div>
          <p className="text-[13px] font-semibold leading-snug text-foreground">{title}</p>
          <p className="mt-1 text-[12px] leading-[1.45] text-[#5c626b]">{body}</p>
        </div>
      </div>
    </div>
  )
}
