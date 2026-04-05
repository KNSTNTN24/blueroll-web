'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  AlertTriangle,
  Download,
  Calendar,
} from 'lucide-react'
import { format, addDays, subDays, startOfDay, endOfDay } from 'date-fns'

type CompletionRow = {
  id: string
  template_id: string
  completed_by: string
  completed_at: string
  signed_off_by: string | null
  notes: string | null
  template: { name: string } | null
  completer: { full_name: string | null } | null
}

type IncidentRow = {
  id: string
  type: string
  description: string
  status: string
  date: string
  created_at: string
  reporter: { full_name: string | null } | null
}

export default function DiaryPage() {
  const { business } = useAuthStore()
  const [selectedDate, setSelectedDate] = useState(new Date())

  const dateStart = startOfDay(selectedDate).toISOString()
  const dateEnd = endOfDay(selectedDate).toISOString()
  const dateStr = format(selectedDate, 'yyyy-MM-dd')

  const { data: completions, isLoading: loadingCompletions } = useQuery({
    queryKey: ['diary-completions', business?.id, dateStr],
    queryFn: async () => {
      const { data } = await supabase
        .from('checklist_completions')
        .select('*, template:checklist_templates(name), completer:profiles!checklist_completions_completed_by_fkey(full_name)')
        .eq('business_id', business!.id)
        .gte('completed_at', dateStart)
        .lte('completed_at', dateEnd)
        .order('completed_at')
      return (data ?? []) as unknown as CompletionRow[]
    },
    enabled: !!business?.id,
  })

  const { data: incidents, isLoading: loadingIncidents } = useQuery({
    queryKey: ['diary-incidents', business?.id, dateStr],
    queryFn: async () => {
      const { data } = await supabase
        .from('incidents')
        .select('*, reporter:profiles!incidents_reported_by_fkey(full_name)')
        .eq('business_id', business!.id)
        .eq('date', dateStr)
        .order('created_at')
      return (data ?? []) as unknown as IncidentRow[]
    },
    enabled: !!business?.id,
  })

  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
  const isLoading = loadingCompletions || loadingIncidents
  const hasEntries = (completions?.length ?? 0) > 0 || (incidents?.length ?? 0) > 0

  const handleExport = () => {
    const lines: string[] = []
    lines.push(`HACCP Diary - ${format(selectedDate, 'EEEE dd MMMM yyyy')}`)
    lines.push('='.repeat(50))
    lines.push('')

    if (completions && completions.length > 0) {
      lines.push('COMPLETED CHECKLISTS')
      lines.push('-'.repeat(30))
      completions.forEach((c) => {
        lines.push(`  ${format(new Date(c.completed_at), 'HH:mm')} - ${c.template?.name ?? 'Unknown'} (by ${c.completer?.full_name ?? 'Unknown'})${c.signed_off_by ? ' [Signed off]' : ''}`)
        if (c.notes) lines.push(`    Notes: ${c.notes}`)
      })
      lines.push('')
    }

    if (incidents && incidents.length > 0) {
      lines.push('INCIDENTS & COMPLAINTS')
      lines.push('-'.repeat(30))
      incidents.forEach((i) => {
        lines.push(`  ${format(new Date(i.created_at), 'HH:mm')} - [${i.type.toUpperCase()}] ${i.description} (by ${i.reporter?.full_name ?? 'Unknown'}) - Status: ${i.status}`)
      })
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `diary-${dateStr}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Diary"
        description="Daily record of food safety activities"
      >
        <Button
          onClick={handleExport}
          size="sm"
          variant="outline"
          disabled={!hasEntries}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export
        </Button>
      </PageHeader>

      {/* Date navigation */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSelectedDate((d) => subDays(d, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-[14px] font-medium">
            {format(selectedDate, 'EEEE dd MMMM yyyy')}
          </span>
          {isToday && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              Today
            </span>
          )}
        </div>
        <button
          onClick={() => setSelectedDate((d) => addDays(d, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {!isToday && (
          <button
            onClick={() => setSelectedDate(new Date())}
            className="text-[12px] text-emerald-600 hover:text-emerald-700"
          >
            Go to today
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : !hasEntries ? (
        <EmptyState
          icon={BookOpen}
          title="No entries"
          description={`No food safety activities recorded for ${format(selectedDate, 'dd MMM yyyy')}.`}
        />
      ) : (
        <div className="space-y-6">
          {/* Checklists */}
          {completions && completions.length > 0 && (
            <div>
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                <ClipboardCheck className="h-4 w-4" />
                Completed Checklists ({completions.length})
              </h3>
              <div className="rounded-lg border border-border bg-white divide-y divide-border">
                {completions.map((completion) => (
                  <div key={completion.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
                      <ClipboardCheck className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium">{completion.template?.name ?? 'Checklist'}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Completed by {completion.completer?.full_name ?? 'Unknown'}{' '}
                        at {format(new Date(completion.completed_at), 'HH:mm')}
                        {completion.notes && ` — ${completion.notes}`}
                      </p>
                    </div>
                    <StatusBadge
                      status={completion.signed_off_by ? 'success' : 'info'}
                      label={completion.signed_off_by ? 'Signed Off' : 'Completed'}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Incidents */}
          {incidents && incidents.length > 0 && (
            <div>
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                Incidents & Complaints ({incidents.length})
              </h3>
              <div className="rounded-lg border border-border bg-white divide-y divide-border">
                {incidents.map((incident) => (
                  <div key={incident.id} className="flex items-center gap-4 px-4 py-3">
                    <div className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                      incident.type === 'complaint'
                        ? 'bg-amber-50 text-amber-600'
                        : 'bg-red-50 text-red-600'
                    )}>
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium capitalize">{incident.type}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {incident.description} — Reported by {incident.reporter?.full_name ?? 'Unknown'}
                      </p>
                    </div>
                    <StatusBadge
                      status={incident.status === 'resolved' ? 'success' : 'error'}
                      label={incident.status === 'resolved' ? 'Resolved' : 'Open'}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
