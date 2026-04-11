'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { format, startOfMonth, endOfDay, parseISO } from 'date-fns'
import {
  FileBarChart, Download, AlertTriangle, CheckCircle2, ClipboardList, Flag,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function ReportsPage() {
  const business = useAuthStore((s) => s.business)

  const now = new Date()
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(now), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(now, 'yyyy-MM-dd'))
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([])
  const [exportMode, setExportMode] = useState<'detailed' | 'table'>('detailed')

  // Fetch templates for the filter
  const { data: templates = [] } = useQuery({
    queryKey: ['report-templates', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('checklist_templates')
        .select('id, name')
        .eq('business_id', business.id)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  // Fetch completions with responses
  const { data: completions = [], isLoading } = useQuery({
    queryKey: ['report-completions', business?.id, dateFrom, dateTo, selectedTemplates],
    queryFn: async () => {
      if (!business?.id) return []
      let query = supabase
        .from('checklist_completions')
        .select(`
          *,
          template:checklist_templates (name),
          completed_by_profile:profiles!checklist_completions_completed_by_fkey (full_name),
          responses:checklist_responses (value, notes, flagged, item:checklist_template_items (name, item_type, sort_order))
        `)
        .eq('business_id', business.id)
        .gte('completed_at', dateFrom)
        .lte('completed_at', endOfDay(parseISO(dateTo)).toISOString())
        .order('completed_at', { ascending: false })

      if (selectedTemplates.length > 0) {
        query = query.in('template_id', selectedTemplates)
      }

      const { data, error } = await query
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  // Summary stats
  const summary = useMemo(() => {
    const total = completions.length
    let totalItems = 0
    let flaggedItems = 0

    completions.forEach((c: any) => {
      const responses = c.responses ?? []
      totalItems += responses.length
      flaggedItems += responses.filter((r: any) => r.flagged).length
    })

    const compliance = totalItems > 0 ? ((totalItems - flaggedItems) / totalItems) * 100 : 100

    return { total, totalItems, flaggedItems, compliance }
  }, [completions])

  function toggleTemplate(id: string) {
    setSelectedTemplates((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    )
  }

  function handleExportPDF() {
    if (completions.length === 0) {
      toast.error('No data to export')
      return
    }

    const bizName = business?.name ?? 'Restaurant'
    const periodLabel = `${format(parseISO(dateFrom), 'dd MMM yyyy')} — ${format(parseISO(dateTo), 'dd MMM yyyy')}`
    const generated = format(new Date(), 'dd MMM yyyy HH:mm')

    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Compliance Report — ${bizName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; font-size: 11px; padding: 24px; }
  .header { text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 2px solid #059669; }
  .header h1 { font-size: 20px; color: #059669; margin-bottom: 4px; }
  .header .period { font-size: 13px; color: #555; }
  .header .generated { font-size: 10px; color: #999; margin-top: 4px; }
  .summary { display: flex; gap: 16px; margin-bottom: 20px; }
  .stat { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center; }
  .stat .val { font-size: 20px; font-weight: 700; }
  .stat .lbl { font-size: 10px; color: #666; margin-top: 2px; }
  .stat.green .val { color: #059669; }
  .stat.red .val { color: #dc2626; }
  .stat.blue .val { color: #2563eb; }
  .checklist { margin-bottom: 16px; page-break-inside: avoid; }
  .checklist-header { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px 6px 0 0; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
  .checklist-header h3 { font-size: 13px; font-weight: 600; }
  .checklist-meta { font-size: 10px; color: #666; }
  .responses { border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 6px 6px; }
  .response { display: flex; align-items: flex-start; padding: 6px 14px; border-bottom: 1px solid #f3f4f6; }
  .response:last-child { border-bottom: none; }
  .response .name { flex: 1; font-size: 11px; }
  .response .value { width: 100px; text-align: center; font-size: 11px; font-weight: 500; }
  .response .notes { flex: 1; font-size: 10px; color: #666; font-style: italic; }
  .flagged { color: #dc2626; font-weight: 600; }
  .pass { color: #059669; }
  @media print { body { padding: 12px; } .checklist { page-break-inside: avoid; } }
</style></head><body>`

    // Header
    html += `<div class="header">
      <h1>${bizName} — Compliance Report</h1>
      <div class="period">${periodLabel}</div>
      <div class="generated">Generated ${generated}</div>
    </div>`

    // Summary
    html += `<div class="summary">
      <div class="stat blue"><div class="val">${summary.total}</div><div class="lbl">Completions</div></div>
      <div class="stat green"><div class="val">${summary.totalItems}</div><div class="lbl">Total Items</div></div>
      <div class="stat red"><div class="val">${summary.flaggedItems}</div><div class="lbl">Flagged</div></div>
      <div class="stat ${summary.compliance >= 90 ? 'green' : 'red'}"><div class="val">${summary.compliance.toFixed(1)}%</div><div class="lbl">Compliance</div></div>
    </div>`

    if (exportMode === 'detailed') {
      // ── Detailed mode: each completion as a separate block ──
      completions.forEach((c: any) => {
        const responses = (c.responses ?? []).slice().sort((a: any, b: any) => (a.item?.sort_order ?? 0) - (b.item?.sort_order ?? 0))
        const flaggedCount = responses.filter((r: any) => r.flagged).length
        const dateStr = format(parseISO(c.completed_at), 'dd MMM yyyy, HH:mm')
        const by = c.completed_by_profile?.full_name ?? 'Unknown'

        html += `<div class="checklist">
          <div class="checklist-header">
            <h3>${c.template?.name ?? 'Checklist'}</h3>
            <div class="checklist-meta">${dateStr} · ${by}${flaggedCount > 0 ? ` · <span class="flagged">${flaggedCount} flagged</span>` : ''}</div>
          </div>
          <div class="responses">`

        if (responses.length === 0) {
          html += `<div class="response"><span class="name" style="color:#999">No responses recorded</span></div>`
        } else {
          responses.forEach((r: any) => {
            const itemName = r.item?.name ?? 'Item'
            const isFlagged = r.flagged
            const valueClass = isFlagged ? 'flagged' : 'pass'
            const displayValue = r.value === 'yes' ? '✓ Yes' : r.value === 'no' ? '✗ No' : r.value ?? '-'
            html += `<div class="response">
              <span class="name">${itemName}</span>
              <span class="value ${valueClass}">${displayValue}</span>
              <span class="notes">${r.notes ?? ''}</span>
            </div>`
          })
        }

        html += `</div></div>`
      })
    } else {
      // ── Table mode: group by template, rows = items, columns = dates ──
      // Group completions by template_id
      const byTemplate = new Map<string, { name: string; completions: any[] }>()
      completions.forEach((c: any) => {
        const tid = c.template_id ?? 'unknown'
        if (!byTemplate.has(tid)) {
          byTemplate.set(tid, { name: c.template?.name ?? 'Checklist', completions: [] })
        }
        byTemplate.get(tid)!.completions.push(c)
      })

      byTemplate.forEach((group) => {
        // Sort completions by date ascending for columns
        const sorted = group.completions.slice().sort(
          (a: any, b: any) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime(),
        )

        // Collect all unique items across completions (by item name + sort_order)
        const itemMap = new Map<string, { name: string; sortOrder: number }>()
        sorted.forEach((c: any) => {
          (c.responses ?? []).forEach((r: any) => {
            if (r.item?.name && !itemMap.has(r.item.name)) {
              itemMap.set(r.item.name, { name: r.item.name, sortOrder: r.item.sort_order ?? 999 })
            }
          })
        })
        const items = Array.from(itemMap.values()).sort((a, b) => a.sortOrder - b.sortOrder)

        // Build response lookup: completionId → itemName → response
        const lookup = new Map<string, Map<string, any>>()
        sorted.forEach((c: any) => {
          const resMap = new Map<string, any>()
          ;(c.responses ?? []).forEach((r: any) => {
            if (r.item?.name) resMap.set(r.item.name, r)
          })
          lookup.set(c.id, resMap)
        })

        html += `<div class="checklist" style="page-break-inside:auto;">
          <h3 style="font-size:14px;font-weight:600;margin-bottom:8px;">${group.name}</h3>
          <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead>
              <tr>
                <th style="text-align:left;padding:6px 8px;border:1px solid #e5e7eb;background:#f9fafb;min-width:180px;font-size:10px;">Item</th>`

        sorted.forEach((c: any) => {
          const d = format(parseISO(c.completed_at), 'dd MMM')
          const by = c.completed_by_profile?.full_name?.split(' ')[0] ?? ''
          html += `<th style="text-align:center;padding:6px 4px;border:1px solid #e5e7eb;background:#f9fafb;min-width:60px;font-size:9px;white-space:nowrap;">${d}<br/><span style="font-weight:400;color:#999;">${by}</span></th>`
        })

        html += `</tr></thead><tbody>`

        items.forEach((item) => {
          html += `<tr><td style="padding:5px 8px;border:1px solid #e5e7eb;font-size:10px;">${item.name}</td>`
          sorted.forEach((c: any) => {
            const r = lookup.get(c.id)?.get(item.name)
            if (!r) {
              html += `<td style="text-align:center;padding:5px 4px;border:1px solid #e5e7eb;color:#ccc;">—</td>`
            } else {
              const val = r.value === 'yes' ? '✓' : r.value === 'no' ? '✗' : r.value ?? '—'
              const bg = r.flagged ? '#fef2f2' : ''
              const color = r.flagged ? '#dc2626' : r.value === 'yes' ? '#059669' : '#111'
              const fw = r.flagged ? '700' : '500'
              const title = r.notes ? ` title="${r.notes.replace(/"/g, '&quot;')}"` : ''
              html += `<td style="text-align:center;padding:5px 4px;border:1px solid #e5e7eb;background:${bg};color:${color};font-weight:${fw};font-size:10px;"${title}>${val}</td>`
            }
          })
          html += `</tr>`
        })

        html += `</tbody></table></div></div>`
      })
    }

    html += `<div style="text-align:center;margin-top:20px;font-size:10px;color:#999;">
      Blueroll · blueroll.app · ${completions.length} completions · ${summary.compliance.toFixed(1)}% compliance
    </div></body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Checklist completion reports and compliance data">
        <Button variant="outline" size="sm" onClick={handleExportPDF} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          Export PDF
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-muted-foreground">From</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="text-[13px] w-[160px]"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-muted-foreground">To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="text-[13px] w-[160px]"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-muted-foreground">Templates</label>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t: any) => {
              const selected = selectedTemplates.includes(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => toggleTemplate(t.id)}
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${
                    selected
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : 'bg-muted/50 text-muted-foreground border-border hover:border-emerald-200'
                  }`}
                >
                  {t.name}
                </button>
              )
            })}
            {templates.length === 0 && (
              <span className="text-[12px] text-muted-foreground">No templates found</span>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-muted-foreground">Export format</label>
          <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30">
            {([
              { id: 'detailed' as const, label: 'Detailed' },
              { id: 'table' as const, label: 'Table' },
            ]).map((m) => (
              <button
                key={m.id}
                onClick={() => setExportMode(m.id)}
                className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  exportMode === m.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard
          icon={ClipboardList}
          label="Total Completions"
          value={summary.total.toString()}
          color="text-blue-600"
          bgColor="bg-blue-50"
        />
        <SummaryCard
          icon={CheckCircle2}
          label="Total Items"
          value={summary.totalItems.toString()}
          color="text-emerald-600"
          bgColor="bg-emerald-50"
        />
        <SummaryCard
          icon={Flag}
          label="Flagged Items"
          value={summary.flaggedItems.toString()}
          color="text-red-600"
          bgColor="bg-red-50"
        />
        <SummaryCard
          icon={FileBarChart}
          label="Compliance"
          value={`${summary.compliance.toFixed(1)}%`}
          color={summary.compliance >= 90 ? 'text-emerald-600' : summary.compliance >= 70 ? 'text-amber-600' : 'text-red-600'}
          bgColor={summary.compliance >= 90 ? 'bg-emerald-50' : summary.compliance >= 70 ? 'bg-amber-50' : 'bg-red-50'}
        />
      </div>

      {/* Report table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">
          Loading report data...
        </div>
      ) : completions.length === 0 ? (
        <EmptyState
          icon={FileBarChart}
          title="No completions found"
          description="Adjust the date range or template filters to see data"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Checklist</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Completed By</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Items</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Flagged</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {completions.map((c: any) => {
                const responses = c.responses ?? []
                const flagged = responses.filter((r: any) => r.flagged).length
                return (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 text-muted-foreground">
                      {format(parseISO(c.completed_at), 'dd MMM yyyy, HH:mm')}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {c.template?.name ?? 'Unknown'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.completed_by_profile?.full_name ?? 'Unknown'}
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      {responses.length}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {flagged > 0 ? (
                        <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                          <AlertTriangle className="h-3 w-3" />
                          {flagged}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={flagged > 0 ? 'warning' : 'success'}
                        label={flagged > 0 ? 'Flagged' : 'Clean'}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ── Summary card ── */
function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
  bgColor,
}: {
  icon: any
  label: string
  value: string
  color: string
  bgColor: string
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${bgColor}`}>
          <Icon className={`h-4 w-4 ${color}`} />
        </div>
      </div>
      <p className="text-[22px] font-semibold text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}
