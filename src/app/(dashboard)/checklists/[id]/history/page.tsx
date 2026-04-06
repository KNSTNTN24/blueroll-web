'use client'

import { use, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import {
  ArrowLeft, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  ShieldCheck, ClipboardList,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

export default function ChecklistHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const business = useAuthStore((s) => s.business)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggleExpanded(completionId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(completionId)) next.delete(completionId)
      else next.add(completionId)
      return next
    })
  }

  // ── Load template ──
  const { data: template } = useQuery({
    queryKey: ['checklist-template', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_templates')
        .select('id, name, description')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
  })

  // ── Load completions with responses ──
  const { data: completions = [], isLoading } = useQuery({
    queryKey: ['checklist-history', id, business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('checklist_completions')
        .select(`
          *,
          completed_by_profile:profiles!checklist_completions_completed_by_fkey(full_name),
          signed_off_by_profile:profiles!checklist_completions_signed_off_by_fkey(full_name),
          checklist_responses(
            *,
            item:checklist_template_items(name, item_type, unit, min_value, max_value)
          )
        `)
        .eq('template_id', id)
        .eq('business_id', business.id)
        .order('completed_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 h-7 w-7 p-0"
          onClick={() => router.push('/checklists')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {template?.name ?? 'Checklist'} — History
          </h1>
          {template?.description && (
            <p className="mt-1 text-[13px] text-muted-foreground">{template.description}</p>
          )}
        </div>
      </div>

      {completions.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No completions yet"
          description="This checklist has not been completed yet."
        />
      ) : (
        <div className="space-y-3">
          {completions.map((comp: any) => {
            const isOpen = expanded.has(comp.id)
            const flaggedCount = (comp.checklist_responses ?? []).filter((r: any) => r.flagged).length
            const responses: any[] = comp.checklist_responses ?? []
            // Sort responses by item sort_order
            responses.sort((a: any, b: any) => (a.item?.sort_order ?? 0) - (b.item?.sort_order ?? 0))

            return (
              <div key={comp.id} className="rounded-lg border border-border bg-white">
                <button
                  type="button"
                  onClick={() => toggleExpanded(comp.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-foreground">
                        {format(new Date(comp.completed_at), 'dd MMM yyyy, HH:mm')}
                      </p>
                      {comp.signed_off_by && (
                        <StatusBadge status="success" label="Signed Off" />
                      )}
                      {flaggedCount > 0 && (
                        <StatusBadge status="error" label={`${flaggedCount} flagged`} />
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      By {comp.completed_by_profile?.full_name ?? 'Unknown'}
                      {comp.signed_off_by_profile && (
                        <> &middot; Signed off by {comp.signed_off_by_profile.full_name}</>
                      )}
                    </p>
                  </div>
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>

                {isOpen && (
                  <div className="border-t border-border px-4 py-3 space-y-2">
                    {responses.map((resp: any) => (
                      <div
                        key={resp.id}
                        className={cn(
                          'flex items-start justify-between rounded-md px-3 py-2',
                          resp.flagged ? 'bg-red-50' : 'bg-gray-50/50',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-foreground">
                              {resp.item?.name ?? 'Unknown item'}
                            </span>
                            {resp.flagged && (
                              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                            )}
                          </div>
                          {resp.notes && (
                            <p className="mt-0.5 text-[12px] text-muted-foreground italic">{resp.notes}</p>
                          )}
                        </div>
                        <div className="ml-3 shrink-0 text-right">
                          {resp.item?.item_type === 'tick' && (
                            <span className={cn('text-[13px] font-medium', resp.value === 'true' ? 'text-emerald-600' : 'text-muted-foreground')}>
                              {resp.value === 'true' ? 'Done' : 'Not done'}
                            </span>
                          )}
                          {resp.item?.item_type === 'temperature' && (
                            <span className={cn('text-[13px] font-medium tabular-nums', resp.flagged ? 'text-red-600' : 'text-foreground')}>
                              {resp.value} {resp.item.unit ?? '°C'}
                            </span>
                          )}
                          {resp.item?.item_type === 'text' && (
                            <span className="text-[13px] text-muted-foreground max-w-[200px] truncate block">
                              {resp.value || '—'}
                            </span>
                          )}
                          {resp.item?.item_type === 'yes_no' && (
                            <StatusBadge
                              status={resp.value === 'yes' ? 'success' : resp.value === 'no' ? 'error' : 'neutral'}
                              label={resp.value === 'yes' ? 'Yes' : resp.value === 'no' ? 'No' : 'N/A'}
                            />
                          )}
                          {resp.item?.item_type === 'photo' && (
                            resp.photo_url ? (
                              <a href={resp.photo_url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-emerald-600 hover:underline">
                                View
                              </a>
                            ) : (
                              <span className="text-[12px] text-muted-foreground">No photo</span>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
