'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { format, startOfMonth, endOfDay, parseISO } from 'date-fns'
import {
  FileBarChart, Printer, AlertTriangle, CheckCircle2, ClipboardList, Flag,
} from 'lucide-react'
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
          responses:checklist_responses (value, notes, flagged, item:checklist_items (name))
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

  function handlePrint() {
    window.print()
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Checklist completion reports and compliance data">
        <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
          <Printer className="h-3.5 w-3.5" />
          Print / PDF
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
