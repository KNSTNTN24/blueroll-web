'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { format, startOfDay, endOfDay, subDays, parseISO, differenceInCalendarDays, differenceInCalendarMonths } from 'date-fns'
import { Download, ChevronDown, Check } from 'lucide-react'
import { toast } from 'sonner'

type Preset = 'today' | '7d' | '30d' | 'custom'

interface TplRow { id: string; name: string; frequency: string; site_id: string | null; active: boolean }
interface Completion {
  id: string; site_id: string | null; completed_at: string; template_id: string
  template?: { name: string } | null
  completed_by_profile?: { full_name: string | null } | null
  responses?: { value: unknown; notes: string | null; flagged: boolean; item?: { name: string } | null }[]
}

function periodsInRange(freq: string, from: Date, to: Date) {
  const days = differenceInCalendarDays(to, from) + 1
  if (freq === 'weekly') return Math.ceil(days / 7)
  if (freq === 'four_weekly') return Math.ceil(days / 28)
  if (freq === 'monthly') return Math.max(1, differenceInCalendarMonths(to, from) + 1)
  return days // daily / default
}

export default function ReportsPage() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  const profile = useAuthStore((s) => s.profile)
  const bid = business?.id
  const now = new Date()

  const [preset, setPreset] = useState<Preset>('7d')
  const [customFrom, setCustomFrom] = useState(format(subDays(now, 6), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(now, 'yyyy-MM-dd'))
  const [selected, setSelected] = useState<Set<string> | null>(null) // template names; null = all
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const range = useMemo(() => {
    const end = endOfDay(now)
    if (preset === 'today') return { from: startOfDay(now), to: end }
    if (preset === '7d') return { from: startOfDay(subDays(now, 6)), to: end }
    if (preset === '30d') return { from: startOfDay(subDays(now, 29)), to: end }
    return { from: startOfDay(parseISO(customFrom)), to: endOfDay(parseISO(customTo)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo])
  const dateFrom = format(range.from, 'yyyy-MM-dd')
  const dateTo = format(range.to, 'yyyy-MM-dd')
  const rangeLabel = differenceInCalendarDays(range.to, range.from) === 0
    ? format(range.from, 'd MMM yyyy')
    : `${format(range.from, 'd')} – ${format(range.to, 'd MMM yyyy')}`

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const { data: templates = [] } = useQuery({
    queryKey: ['report-templates', bid, currentSiteId],
    enabled: !!bid,
    queryFn: async () => {
      let q = supabase.from('checklist_templates').select('id, name, frequency, site_id, active').eq('business_id', bid!)
      if (currentSiteId) q = q.eq('site_id', currentSiteId)
      return (await q.order('name')).data as TplRow[] ?? []
    },
  })

  const { data: completions = [], isLoading } = useQuery({
    queryKey: ['report-completions', bid, currentSiteId, dateFrom, dateTo],
    enabled: !!bid,
    queryFn: async () => {
      let q = supabase.from('checklist_completions').select(`
        id, site_id, completed_at, template_id,
        template:checklist_templates (name),
        completed_by_profile:profiles!checklist_completions_completed_by_fkey (full_name),
        responses:checklist_responses (value, notes, flagged, item:checklist_template_items (name))
      `).eq('business_id', bid!).gte('completed_at', range.from.toISOString()).lte('completed_at', range.to.toISOString()).order('completed_at', { ascending: false })
      if (currentSiteId) q = q.eq('site_id', currentSiteId)
      return (await q).data as unknown as Completion[] ?? []
    },
  })

  // Unique templates (dedup by name), with frequency + site coverage
  const uniqTemplates = useMemo(() => {
    const map = new Map<string, { name: string; frequency: string; siteIds: Set<string | null>; active: boolean }>()
    templates.forEach((t) => {
      const e = map.get(t.name) ?? { name: t.name, frequency: t.frequency, siteIds: new Set<string | null>(), active: false }
      e.siteIds.add(t.site_id)
      if (t.active) e.active = true // active if any copy is active
      map.set(t.name, e)
    })
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [templates])

  const countByName = useMemo(() => {
    const m = new Map<string, number>()
    completions.forEach((c) => { const n = c.template?.name; if (n) m.set(n, (m.get(n) ?? 0) + 1) })
    return m
  }, [completions])

  const allNames = uniqTemplates.map((t) => t.name)
  const isAll = selected === null
  const activeNames = isAll ? new Set(allNames) : selected
  const filtered = completions.filter((c) => c.template?.name && activeNames.has(c.template.name))

  function toggle(name: string) {
    setSelected((prev) => {
      const base = prev ?? new Set(allNames)
      const next = new Set(base)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next.size === allNames.length ? null : next
    })
  }

  const siteName = (id: string | null) => (id ? (sites.find((s) => s.id === id)?.name ?? 'Site') : '—')

  // Honest stats: completion rate = completed / due (due = scheduled instances in range)
  const stats = useMemo(() => {
    const completed = filtered.length
    const scopeSites = currentSiteId ? 1 : Math.max(1, sites.length)
    // "Due" only counts ACTIVE templates — inactive/archived ones aren't scheduled,
    // so they must not inflate the missed count or drag the completion rate down.
    const selTemplates = uniqTemplates.filter((t) => activeNames.has(t.name) && t.active)
    let due = 0
    selTemplates.forEach((t) => {
      const p = periodsInRange(t.frequency, range.from, range.to)
      const coverage = currentSiteId ? 1 : (t.siteIds.has(null) ? scopeSites : Math.max(1, t.siteIds.size))
      due += p * coverage
    })
    const missed = Math.max(0, due - completed)
    const rate = due > 0 ? Math.min(100, Math.round((completed / due) * 100)) : 100

    let flaggedItems = 0, flaggedChecklists = 0
    filtered.forEach((c) => { const f = (c.responses ?? []).filter((r) => r.flagged).length; flaggedItems += f; if (f) flaggedChecklists++ })

    // Worst site by missed, fallback to flagged
    const scope = currentSiteId ? sites.filter((s) => s.id === currentSiteId) : sites
    let worst: { name: string; missed: number; flagged: number } | null = null
    scope.forEach((site) => {
      const doneS = filtered.filter((c) => c.site_id === site.id).length
      let dueS = 0
      selTemplates.forEach((t) => { if (t.siteIds.has(null) || t.siteIds.has(site.id)) dueS += periodsInRange(t.frequency, range.from, range.to) })
      const missedS = Math.max(0, dueS - doneS)
      const flaggedS = filtered.filter((c) => c.site_id === site.id).reduce((n, c) => n + (c.responses ?? []).filter((r) => r.flagged).length, 0)
      if (!worst || missedS > worst.missed || (missedS === worst.missed && flaggedS > worst.flagged)) worst = { name: site.name, missed: missedS, flagged: flaggedS }
    })

    return { completed, due, missed, rate, flaggedItems, flaggedChecklists, worst: worst as { name: string; missed: number; flagged: number } | null }
  }, [filtered, uniqTemplates, activeNames, range, currentSiteId, sites])

  const rows = filtered.map((c) => {
    const resp = c.responses ?? []
    const total = resp.length
    const flagged = resp.filter((r) => r.flagged).length
    return {
      id: c.id, at: c.completed_at, name: c.template?.name ?? 'Checklist', site: siteName(c.site_id),
      by: c.completed_by_profile?.full_name ?? '—', total, flagged, ok: total - flagged,
    }
  })

  const tplBadge = isAll ? `All ${allNames.length}` : String(activeNames.size)

  function exportCSV() {
    if (rows.length === 0) { toast.error('Nothing in this range to export'); return }
    const head = ['Date', 'Checklist', 'Site', 'Completed by', 'Items', 'Status']
    const body = rows.map((r) => [
      format(parseISO(r.at), 'dd MMM yyyy HH:mm'), r.name, r.site, r.by, `${r.ok}/${r.total}`,
      r.flagged ? `${r.flagged} flagged` : r.total === 0 ? 'No items' : 'Clean',
    ])
    const csv = [head, ...body].map((line) => line.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `blueroll-report-${dateFrom}_${dateTo}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  function exportPDF() {
    if (rows.length === 0) { toast.error('Nothing in this range to export'); return }
    const scopeLabel = currentSiteId ? siteName(currentSiteId) : `All sites (${sites.length})`
    const esc = (s: string) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]!))
    const reading = (v: unknown) => { if (v === 'yes' || v === true) return 'Yes'; if (v === 'no' || v === false) return 'No'; if (v == null || v === '') return '—'; return String(v) }

    // Flagged items — corrective action cards
    const flaggedList: { title: string; meta: string; detail: string }[] = []
    filtered.forEach((c) => (c.responses ?? []).forEach((r) => {
      if (!r.flagged) return
      const rd = reading(r.value)
      flaggedList.push({
        title: `${r.item?.name ?? 'Check item'}${rd !== '—' ? ` (${rd})` : ''}`,
        meta: `${format(parseISO(c.completed_at), 'd MMM, HH:mm')} · ${siteName(c.site_id)}`,
        detail: `${c.template?.name ?? 'Checklist'} · flagged by ${c.completed_by_profile?.full_name ?? 'staff'}. Corrective action: ${r.notes || 'recorded at time of check.'}`,
      })
    }))

    // Per-completion detail sections (those with recorded answers)
    const detailed = filtered.filter((c) => (c.responses ?? []).length > 0)
    const detailSections = detailed.map((c) => {
      const resp = c.responses ?? []
      const flagged = resp.filter((r) => r.flagged).length
      const itemRows = resp.map((r) => `<tr><td>${esc(r.item?.name ?? 'Item')}</td><td class="num">${esc(reading(r.value))}</td><td class="res ${r.flagged ? 'amber' : 'green'}">${r.flagged ? 'Flagged' : 'Pass'}</td></tr>`).join('')
      return `<div class="sec"><div class="eyebrow">${esc(c.template?.name ?? 'Checklist')} · ${esc(siteName(c.site_id))} · ${format(parseISO(c.completed_at), 'd MMM yyyy, HH:mm')}</div>
        <table class="items"><thead><tr><th>Check item</th><th class="num">Reading</th><th class="res">Result</th></tr></thead><tbody>${itemRows}</tbody></table>
        <div class="signed"><span>Signed: ${esc(c.completed_by_profile?.full_name ?? '—')} · ${esc(siteName(c.site_id))}</span><span>Completed ${format(parseISO(c.completed_at), 'HH:mm')} · ${resp.length - flagged}/${resp.length} items</span></div></div>`
    }).join('')

    const compact = filtered.filter((c) => (c.responses ?? []).length === 0)

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Compliance report — ${esc(business?.name ?? 'BlueRoll')}</title>
<style>
  @page{margin:16mm 15mm}*{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16181d;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #16181d;padding-bottom:18px;margin-bottom:24px}
  .b{width:24px;height:24px;border-radius:6px;background:#1f9d63;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;vertical-align:middle}
  h1{font-size:22px;margin:13px 0 3px;letter-spacing:-.01em}.sub{color:#5c626b;font-size:13px}
  .meta{text-align:right;color:#5c626b;font-size:12px;line-height:1.7}.meta span{color:#9aa0a8}
  .sum{display:flex;border:1px solid #e9eaed;border-radius:12px;overflow:hidden;margin-bottom:26px}
  .sum>div{flex:1;padding:14px 18px;border-right:1px solid #eef0f2}.sum>div:last-child{border:none}
  .lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#9aa0a8;font-weight:600}
  .val{font-size:21px;font-weight:700;margin-top:6px}
  h2{font-size:14px;margin:0 0 12px}.block{margin-bottom:26px}
  .eyebrow{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#9aa0a8;margin-bottom:8px}
  .flag{border:1px solid #f1e2c4;background:#fbf1e1;border-radius:11px;padding:13px 16px;margin-bottom:8px}
  .flag .t{font-weight:600;font-size:13.5px;color:#16181d;display:flex;justify-content:space-between;gap:14px}
  .flag .t span:last-child{color:#8a6a1f;font-weight:500;font-size:12px;white-space:nowrap}
  .flag .m{font-size:12.5px;color:#6b5313;line-height:1.55;margin-top:4px}
  .sec{margin-bottom:18px;page-break-inside:avoid}
  table.items{width:100%;border-collapse:collapse;border:1px solid #e9eaed;border-radius:11px;overflow:hidden}
  table.items th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#9aa0a8;font-weight:600;padding:9px 16px;background:#fbfbfc;border-bottom:1px solid #eef0f2}
  table.items td{padding:10px 16px;border-bottom:1px solid #f2f3f5;font-size:13px;font-weight:500}
  table.items tr:last-child td{border-bottom:none}
  .num{text-align:right;font-variant-numeric:tabular-nums}.res{text-align:right;font-weight:600;font-size:12.5px}
  .green{color:#1f7a52}.amber{color:#b07d1e}
  .signed{display:flex;justify-content:space-between;font-size:12px;color:#8a9099;padding:6px 2px 0}
  table.list{width:100%;border-collapse:collapse;margin-top:4px}
  table.list th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#9aa0a8;padding:7px 8px;border-bottom:1px solid #e7e9ec}
  table.list td{padding:7px 8px;border-bottom:1px solid #f2f3f5;font-size:11.5px}
  .pill{font-size:11px;font-weight:600}
  .foot{margin-top:26px;padding-top:14px;border-top:1px solid #eef0f2;color:#9aa0a8;font-size:11.5px;display:flex;justify-content:space-between}
</style></head><body>
  <div class="hd">
    <div><div><span class="b">b</span> <b style="letter-spacing:.02em">BLUEROLL</b></div>
      <h1>Food safety compliance report</h1><div class="sub">${esc(business?.name ?? 'BlueRoll')} · ${esc(scopeLabel)}</div></div>
    <div class="meta"><div><span>Period</span> ${esc(rangeLabel)}</div><div><span>Generated</span> ${format(new Date(), 'd MMM yyyy, HH:mm')}</div><div><span>Prepared by</span> ${esc(profile?.full_name ?? '—')}</div></div>
  </div>
  <div class="sum">
    <div><div class="lbl">Completions</div><div class="val">${stats.completed}</div></div>
    <div><div class="lbl">Completion rate</div><div class="val" style="color:#1f7a52">${stats.rate}%</div></div>
    <div><div class="lbl">Missed checks</div><div class="val">${stats.missed}</div></div>
    <div><div class="lbl">Flagged items</div><div class="val">${stats.flaggedItems}</div></div>
  </div>
  ${flaggedList.length ? `<div class="block"><h2>Flagged items — corrective action</h2>${flaggedList.map((f) => `<div class="flag"><div class="t"><span>${esc(f.title)}</span><span>${esc(f.meta)}</span></div><div class="m">${esc(f.detail)}</div></div>`).join('')}</div>` : ''}
  ${detailSections ? `<div class="block"><h2>Signed records</h2>${detailSections}</div>` : ''}
  ${compact.length ? `<div class="block"><h2>${detailSections ? 'Other completions in period' : 'Completions in period'}</h2>
    <table class="list"><thead><tr><th>Date</th><th>Checklist</th><th>Site</th><th>Completed by</th><th>Status</th></tr></thead><tbody>
    ${compact.map((c) => `<tr><td>${format(parseISO(c.completed_at), 'dd MMM, HH:mm')}</td><td>${esc(c.template?.name ?? 'Checklist')}</td><td>${esc(siteName(c.site_id))}</td><td>${esc(c.completed_by_profile?.full_name ?? '—')}</td><td class="pill green">Completed</td></tr>`).join('')}
    </tbody></table></div>` : ''}
  <div class="foot"><span>Generated by BlueRoll · records are timestamped and tamper-evident</span><span>blueroll.app</span></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 300) }
  }

  const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e7e9ec', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 10px 28px -24px rgba(16,24,40,.14)' }
  const EYEBROW: React.CSSProperties = { font: "600 11px 'Geist'", letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa0a8', whiteSpace: 'nowrap' }
  const GRID = '112px minmax(0,1.5fr) 100px 128px 52px 104px'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.02em' }}>Reports</h1>
          <div style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>Due-diligence records — ready for an inspector or head office</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={exportCSV} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #e2e4e8', color: '#41464d', font: "600 13.5px 'Geist'", padding: '10px 15px', borderRadius: 10, cursor: 'pointer' }}>CSV</button>
          <button onClick={exportPDF} style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', background: '#1f9d63', border: 'none', color: '#fff', font: "600 14px 'Geist'", padding: '11px 17px', borderRadius: 11, cursor: 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}>
            <Download className="h-4 w-4" strokeWidth={1.9} /> Export PDF
          </button>
        </div>
      </div>

      {/* filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: '#eceef1', padding: 4, borderRadius: 11 }}>
          {([['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['custom', 'Custom']] as [Preset, string][]).map(([k, label]) => {
            const on = preset === k
            return <button key={k} onClick={() => setPreset(k)} style={{ border: 'none', cursor: 'pointer', font: "600 13px 'Geist'", padding: '7px 13px', borderRadius: 8, background: on ? '#fff' : 'transparent', color: on ? '#1c1f24' : '#8a9099', boxShadow: on ? '0 1px 2px rgba(16,24,40,.06)' : 'none' }}>{label}</button>
          })}
        </div>
        {preset === 'custom' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ border: '1px solid #e2e4e8', borderRadius: 8, padding: '6px 9px', font: "500 13px 'Geist'" }} />
            <span style={{ color: '#9aa0a8' }}>–</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ border: '1px solid #e2e4e8', borderRadius: 8, padding: '6px 9px', font: "500 13px 'Geist'" }} />
          </div>
        ) : (
          <span style={{ font: "500 13px 'Geist'", color: '#8a9099' }}>{rangeLabel}</span>
        )}

        <div ref={menuRef} style={{ position: 'relative', marginLeft: 'auto' }}>
          <button onClick={() => setMenuOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e4e8', background: '#fff', borderRadius: 10, padding: '9px 13px', cursor: 'pointer' }}>
            <span style={{ font: "600 13.5px 'Geist'", color: '#16181d' }}>Templates</span>
            <span style={{ font: "600 11.5px 'Geist'", color: '#1a6e49', background: '#e7f0ea', padding: '2px 8px', borderRadius: 20 }}>{tplBadge}</span>
            <ChevronDown className="h-3.5 w-3.5" style={{ color: '#9aa0a8' }} strokeWidth={1.8} />
          </button>
          {menuOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 296, background: '#fff', border: '1px solid #e7e9ec', borderRadius: 14, boxShadow: '0 18px 44px -18px rgba(16,24,40,.28)', padding: 8, zIndex: 30 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 11px 8px' }}>
                <span style={{ font: "600 10.5px 'Geist'", letterSpacing: '.07em', textTransform: 'uppercase', color: '#9aa0a8' }}>{allNames.length} templates</span>
                <span onClick={() => setSelected(null)} style={{ font: "600 12px 'Geist'", color: '#149361', cursor: 'pointer' }}>Select all</span>
              </div>
              {uniqTemplates.map((t) => {
                const on = activeNames.has(t.name)
                const cnt = countByName.get(t.name) ?? 0
                return (
                  <div key={t.name} onClick={() => toggle(t.name)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 9, cursor: 'pointer', background: on ? '#f5faf7' : 'transparent' }}>
                    <span style={{ width: 17, height: 17, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? '#1f9d63' : 'transparent', border: on ? 'none' : '1.6px solid #cdd1d6', flex: 'none' }}>
                      {on && <Check className="h-[11px] w-[11px] text-white" strokeWidth={3.4} />}
                    </span>
                    <span style={{ font: "500 13.5px 'Geist'", flex: 1, color: on ? '#16181d' : '#8a9099' }}>{t.name}</span>
                    <span style={{ font: "500 11.5px 'Geist'", color: '#9aa0a8' }}>{cnt}</span>
                  </div>
                )
              })}
              {uniqTemplates.length === 0 && <div style={{ padding: '10px 11px', font: "400 12.5px 'Geist'", color: '#9aa0a8' }}>No templates yet.</div>}
              <div style={{ font: "400 11.5px 'Geist'", color: '#9aa0a8', padding: '7px 11px 5px', lineHeight: 1.45 }}>One entry per template — completions are counted on the right.</div>
            </div>
          )}
        </div>
      </div>

      {/* summary strip */}
      <div style={{ ...CARD, display: 'flex', overflow: 'hidden' }}>
        <Cell label="Completions" value={String(stats.completed)} eyebrow={EYEBROW} />
        <Div />
        <Cell label="Completion rate" value={`${stats.rate}%`} valueColor="#1f7a52" sub={`${stats.missed} missed of ${stats.due} due`} eyebrow={EYEBROW} />
        <Div />
        <Cell label="Flagged items" value={String(stats.flaggedItems)} dot={stats.flaggedItems ? '#d98a1a' : undefined} sub={stats.flaggedChecklists ? `in ${stats.flaggedChecklists} checklist${stats.flaggedChecklists === 1 ? '' : 's'}` : 'none flagged'} eyebrow={EYEBROW} />
        <Div />
        {currentSiteId ? (
          <Cell label="Missed checks" value={String(stats.missed)} dot={stats.missed ? '#d98a1a' : undefined} sub={stats.missed ? `${stats.completed} of ${stats.due} done` : 'all checks done'} eyebrow={EYEBROW} />
        ) : (
          <Cell label="Worst site" value={stats.worst && stats.worst.missed > 0 ? stats.worst.name : '—'} valueSize={20} sub={stats.worst && stats.worst.missed > 0 ? `${stats.worst.missed} missed check${stats.worst.missed === 1 ? '' : 's'}` : 'all sites on track'} eyebrow={EYEBROW} />
        )}
      </div>

      {/* table */}
      <div style={{ ...CARD, borderColor: '#e9eaed', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 700 }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '11px 20px', borderBottom: '1px solid #eef0f2', background: '#fbfbfc' }}>
              {['Date', 'Checklist', 'Site', 'Completed by', 'Items', 'Status'].map((h, i) => (
                <span key={h} style={{ font: "600 11px 'Geist'", letterSpacing: '.06em', textTransform: 'uppercase', color: '#9aa0a8', textAlign: i >= 4 ? 'right' : 'left' }}>{h}</span>
              ))}
            </div>
            {isLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#9aa0a8', fontSize: 13 }}>Loading…</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: '36px 20px', textAlign: 'center', color: '#8a9099', fontSize: 13.5 }}>Nothing in this range — widen the dates or select more templates.</div>
            ) : rows.map((r, i) => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '13px 20px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid #f2f3f5', alignItems: 'center' }}>
                <span style={{ font: "500 13px 'Geist'", color: '#8a9099', fontVariantNumeric: 'tabular-nums' }}>{format(parseISO(r.at), 'dd MMM, HH:mm')}</span>
                <span style={{ font: "600 14px 'Geist'", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                <span style={{ font: "500 13px 'Geist'", color: '#5c626b', whiteSpace: 'nowrap' }}>{r.site}</span>
                <span style={{ font: "500 13px 'Geist'", color: '#5c626b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.by}</span>
                <span style={{ font: "500 13px 'Geist'", color: '#5c626b', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.ok}/{r.total}</span>
                {(() => {
                  const st = r.flagged ? { bg: '#fbf1e1', fg: '#b07d1e', dot: '#d98a1a', label: `${r.flagged} flagged` }
                    : r.total === 0 ? { bg: '#f1f2f4', fg: '#8a9099', dot: '#c2c6cc', label: 'No items' }
                      : { bg: '#eaf4ee', fg: '#1f7a52', dot: '#1f9d63', label: 'Clean' }
                  return (
                    <span style={{ justifySelf: 'end', display: 'inline-flex', alignItems: 'center', gap: 6, font: "600 12px 'Geist'", padding: '4px 10px', borderRadius: 20, background: st.bg, color: st.fg }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot }} />{st.label}
                    </span>
                  )
                })()}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Div() { return <div style={{ width: 1, background: '#eef0f2', margin: '15px 0' }} /> }

function Cell({ label, value, sub, valueColor, valueSize, dot, eyebrow }: { label: string; value: string; sub?: string; valueColor?: string; valueSize?: number; dot?: string; eyebrow: React.CSSProperties }) {
  return (
    <div style={{ flex: 1, padding: '16px 20px', minWidth: 0 }}>
      <div style={eyebrow}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
        {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flex: 'none' }} />}
        <span style={{ fontWeight: 700, fontSize: valueSize ?? 24, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: valueColor ?? '#16181d', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
      </div>
      {sub && <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 7, whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  )
}
