'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  FileBarChart,
  Download,
  CalendarDays,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ArrowUpDown,
  Filter,
  Printer,
} from 'lucide-react'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompletionRow {
  id: string
  template_id: string
  completed_by: string
  completed_at: string
  signed_off_by: string | null
  notes: string | null
  business_id: string
  checklist_templates: {
    name: string
  } | null
  profiles: {
    full_name: string | null
  } | null
  checklist_responses: {
    id: string
    item_id: string
    value: string
    flagged: boolean
    notes: string | null
    checklist_template_items: {
      name: string
    } | null
  }[]
}

type SortField = 'date' | 'checklist' | 'completedBy' | 'flagged'
type SortDir = 'asc' | 'desc'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  const { business } = useAuthStore()
  const today = new Date()

  const [dateFrom, setDateFrom] = useState(format(subDays(today, 30), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(today, 'yyyy-MM-dd'))
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set())
  const [showReport, setShowReport] = useState(false)
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showFilters, setShowFilters] = useState(false)

  // Fetch all checklist templates for filtering
  const { data: templates } = useQuery({
    queryKey: ['checklist-templates-list', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('checklist_templates')
        .select('id, name')
        .eq('business_id', business!.id)
        .order('name')
      return data ?? []
    },
    enabled: !!business?.id,
  })

  // Fetch completions with responses for date range
  const { data: completions, isLoading, refetch } = useQuery({
    queryKey: ['report-completions', business?.id, dateFrom, dateTo],
    queryFn: async () => {
      const from = startOfDay(new Date(dateFrom)).toISOString()
      const to = endOfDay(new Date(dateTo)).toISOString()

      const { data, error } = await supabase
        .from('checklist_completions')
        .select(
          `
          *,
          checklist_templates!checklist_completions_template_id_fkey(name),
          profiles!checklist_completions_completed_by_fkey(full_name),
          checklist_responses(
            id,
            item_id,
            value,
            flagged,
            notes,
            checklist_template_items!checklist_responses_item_id_fkey(name)
          )
        `
        )
        .eq('business_id', business!.id)
        .gte('completed_at', from)
        .lte('completed_at', to)
        .order('completed_at', { ascending: false })

      if (error) throw error
      return (data ?? []) as unknown as CompletionRow[]
    },
    enabled: !!business?.id && showReport,
  })

  // Filter by selected templates
  const filtered = useMemo(() => {
    if (!completions) return []
    if (selectedTemplates.size === 0) return completions
    return completions.filter((c) => selectedTemplates.has(c.template_id))
  }, [completions, selectedTemplates])

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortField === 'date') {
        cmp = new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime()
      } else if (sortField === 'checklist') {
        cmp = (a.checklist_templates?.name ?? '').localeCompare(
          b.checklist_templates?.name ?? ''
        )
      } else if (sortField === 'completedBy') {
        cmp = (a.profiles?.full_name ?? '').localeCompare(b.profiles?.full_name ?? '')
      } else if (sortField === 'flagged') {
        const aF = a.checklist_responses.filter((r) => r.flagged).length
        const bF = b.checklist_responses.filter((r) => r.flagged).length
        cmp = aF - bF
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortField, sortDir])

  // Summary stats
  const summary = useMemo(() => {
    const totalCompletions = filtered.length
    const totalItems = filtered.reduce((acc, c) => acc + c.checklist_responses.length, 0)
    const flaggedCount = filtered.reduce(
      (acc, c) => acc + c.checklist_responses.filter((r) => r.flagged).length,
      0
    )
    const compliance = totalItems > 0 ? ((totalItems - flaggedCount) / totalItems) * 100 : 0

    return { totalCompletions, totalItems, flaggedCount, compliance }
  }, [filtered])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'date' ? 'desc' : 'asc')
    }
  }

  function toggleTemplate(id: string) {
    setSelectedTemplates((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleGenerate() {
    setShowReport(true)
    refetch()
    toast.success('Generating report...')
  }

  function exportPDF() {
    window.print()
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Reports"
        description="Review checklist completions and compliance metrics"
      >
        {showReport && sorted.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportPDF} className="text-[12px]">
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            Print / PDF
          </Button>
        )}
      </PageHeader>

      {/* Filters */}
      <div className="rounded-lg border border-border bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-[12px] text-muted-foreground">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40 text-[13px] tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] text-muted-foreground">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40 text-[13px] tabular-nums"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((s) => !s)}
            className="text-[12px]"
          >
            <Filter className="mr-1.5 h-3.5 w-3.5" />
            Filters
            {selectedTemplates.size > 0 && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] text-white">
                {selectedTemplates.size}
              </span>
            )}
          </Button>

          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={isLoading}
            className="bg-emerald-600 text-[12px] hover:bg-emerald-700"
          >
            <FileBarChart className="mr-1.5 h-3.5 w-3.5" />
            Generate Report
          </Button>
        </div>

        {/* Template filter checkboxes */}
        {showFilters && templates && templates.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">
              Checklist Templates
            </p>
            <div className="flex flex-wrap gap-3">
              {templates.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-2 text-[13px]"
                >
                  <Checkbox
                    checked={selectedTemplates.has(t.id)}
                    onCheckedChange={() => toggleTemplate(t.id)}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Summary cards */}
      {showReport && !isLoading && (
        <div className="grid grid-cols-4 gap-4">
          <SummaryCard
            icon={ClipboardCheck}
            label="Total Completions"
            value={String(summary.totalCompletions)}
            color="text-emerald-600"
          />
          <SummaryCard
            icon={CheckCircle2}
            label="Items Checked"
            value={String(summary.totalItems)}
            color="text-blue-600"
          />
          <SummaryCard
            icon={AlertTriangle}
            label="Flagged Items"
            value={String(summary.flaggedCount)}
            color={summary.flaggedCount > 0 ? 'text-red-600' : 'text-emerald-600'}
          />
          <SummaryCard
            icon={FileBarChart}
            label="Compliance Rate"
            value={`${summary.compliance.toFixed(1)}%`}
            color={summary.compliance >= 95 ? 'text-emerald-600' : summary.compliance >= 80 ? 'text-amber-600' : 'text-red-600'}
          />
        </div>
      )}

      {/* Report table */}
      {showReport && !isLoading && sorted.length === 0 && (
        <EmptyState
          icon={FileBarChart}
          title="No completions found"
          description="No checklist completions found for the selected date range and filters."
        />
      )}

      {showReport && !isLoading && sorted.length > 0 && (
        <div className="rounded-lg border border-border bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <SortableHeader
                    label="Date"
                    field="date"
                    currentField={sortField}
                    currentDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableHeader
                    label="Checklist"
                    field="checklist"
                    currentField={sortField}
                    currentDir={sortDir}
                    onClick={toggleSort}
                  />
                  <SortableHeader
                    label="Completed By"
                    field="completedBy"
                    currentField={sortField}
                    currentDir={sortDir}
                    onClick={toggleSort}
                  />
                  <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                    Items
                  </th>
                  <SortableHeader
                    label="Flagged"
                    field="flagged"
                    currentField={sortField}
                    currentDir={sortDir}
                    onClick={toggleSort}
                  />
                  <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                    Flagged Items
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((completion) => {
                  const flaggedResponses = completion.checklist_responses.filter(
                    (r) => r.flagged
                  )
                  return (
                    <tr
                      key={completion.id}
                      className="transition-colors hover:bg-accent/50"
                    >
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {format(new Date(completion.completed_at), 'dd MMM yyyy HH:mm')}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {completion.checklist_templates?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {completion.profiles?.full_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {completion.checklist_responses.length}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {flaggedResponses.length > 0 ? (
                          <span className="font-medium text-red-600">
                            {flaggedResponses.length}
                          </span>
                        ) : (
                          <span className="text-emerald-600">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {flaggedResponses.length > 0 ? (
                          <StatusBadge status="error" label="Issues" />
                        ) : completion.signed_off_by ? (
                          <StatusBadge status="success" label="Signed Off" />
                        ) : (
                          <StatusBadge status="success" label="Complete" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {flaggedResponses.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {flaggedResponses.map((r) => (
                              <span
                                key={r.id}
                                className="inline-flex items-center rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 border border-red-200"
                                title={r.notes ?? undefined}
                              >
                                {r.checklist_template_items?.name ?? r.item_id}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loading state */}
      {showReport && isLoading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType
  label: string
  value: string
  color: string
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', color)} strokeWidth={1.5} />
        <span className="text-[12px] text-muted-foreground">{label}</span>
      </div>
      <p className={cn('mt-2 text-2xl font-semibold tracking-tight tabular-nums', color)}>
        {value}
      </p>
    </div>
  )
}

function SortableHeader({
  label,
  field,
  currentField,
  currentDir,
  onClick,
}: {
  label: string
  field: SortField
  currentField: SortField
  currentDir: SortDir
  onClick: (field: SortField) => void
}) {
  return (
    <th
      className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground cursor-pointer hover:text-foreground"
      onClick={() => onClick(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          className={cn(
            'h-3 w-3',
            currentField === field ? 'text-foreground' : 'text-muted-foreground/50'
          )}
        />
      </span>
    </th>
  )
}
