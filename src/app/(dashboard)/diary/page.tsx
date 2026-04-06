'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { ChevronLeft, ChevronRight, CalendarDays, ClipboardCheck, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { format, addDays, subDays, startOfDay, endOfDay, isToday } from 'date-fns'

interface Completion {
  id: string
  completed_by: string
  completed_at: string
  template?: { name: string }
  completer?: { full_name: string | null; email: string }
}

interface Incident {
  id: string
  type: string
  description: string
  status: string
  created_at: string
  reporter?: { full_name: string | null; email: string }
}

type TimelineEntry = {
  time: string
  type: 'checklist' | 'incident'
  title: string
  subtitle: string
  status?: string
}

export default function DiaryPage() {
  const business = useAuthStore((s) => s.business)
  const [date, setDate] = useState(new Date())

  const dayStart = startOfDay(date).toISOString()
  const dayEnd = endOfDay(date).toISOString()

  const { data: completions = [] } = useQuery({
    queryKey: ['diary-completions', business?.id, dayStart],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('checklist_completions')
        .select('*, template:checklist_templates(name), completer:profiles!checklist_completions_completed_by_fkey(full_name, email)')
        .eq('business_id', business.id)
        .gte('completed_at', dayStart)
        .lte('completed_at', dayEnd)
        .order('completed_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as Completion[]
    },
    enabled: !!business?.id,
  })

  const { data: incidents = [] } = useQuery({
    queryKey: ['diary-incidents', business?.id, dayStart],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('incidents')
        .select('*, reporter:profiles!incidents_reported_by_fkey(full_name, email)')
        .eq('business_id', business.id)
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as Incident[]
    },
    enabled: !!business?.id,
  })

  const timeline: TimelineEntry[] = [
    ...completions.map((c) => ({
      time: c.completed_at,
      type: 'checklist' as const,
      title: c.template?.name ?? 'Checklist',
      subtitle: `Completed by ${c.completer?.full_name || c.completer?.email || 'Unknown'}`,
    })),
    ...incidents.map((i) => ({
      time: i.created_at,
      type: 'incident' as const,
      title: `${i.type.charAt(0).toUpperCase() + i.type.slice(1)}: ${i.description.substring(0, 80)}`,
      subtitle: `Reported by ${i.reporter?.full_name || i.reporter?.email || 'Unknown'}`,
      status: i.status,
    })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  return (
    <div className="space-y-6">
      <PageHeader title="Diary" description="Daily activity log" />

      {/* Date Navigation */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setDate(subDays(date, 1))}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-1.5 text-[13px] font-medium text-foreground">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          {format(date, 'EEEE, dd MMMM yyyy')}
        </div>
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        {!isToday(date) && (
          <Button variant="outline" size="sm" onClick={() => setDate(new Date())}>
            Today
          </Button>
        )}
      </div>

      {/* Timeline */}
      {timeline.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No activity"
          description={`No checklists or incidents recorded for ${format(date, 'dd MMMM yyyy')}.`}
        />
      ) : (
        <div className="space-y-0">
          {timeline.map((entry, idx) => (
            <div key={idx} className="flex gap-4">
              {/* Timeline line */}
              <div className="flex flex-col items-center">
                <div className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border',
                  entry.type === 'checklist'
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-amber-200 bg-amber-50'
                )}>
                  {entry.type === 'checklist' ? (
                    <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  )}
                </div>
                {idx < timeline.length - 1 && (
                  <div className="w-px flex-1 bg-border" />
                )}
              </div>

              {/* Content */}
              <div className="pb-6 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] tabular-nums text-muted-foreground">
                    {format(new Date(entry.time), 'HH:mm')}
                  </span>
                  {entry.status && (
                    <StatusBadge
                      status={entry.status === 'open' ? 'warning' : 'success'}
                      label={entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                    />
                  )}
                </div>
                <p className="mt-0.5 text-[13px] font-medium text-foreground">{entry.title}</p>
                <p className="text-[12px] text-muted-foreground">{entry.subtitle}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
