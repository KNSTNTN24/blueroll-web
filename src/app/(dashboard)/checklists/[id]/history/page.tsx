'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { ArrowLeft, History, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { useState } from 'react'

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: templateId } = use(params)
  const { business } = useAuthStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: template } = useQuery({
    queryKey: ['checklist-template', templateId],
    queryFn: async () => {
      const { data } = await supabase
        .from('checklist_templates')
        .select('*, checklist_template_items(*)')
        .eq('id', templateId)
        .single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any
    },
  })

  const { data: completions } = useQuery({
    queryKey: ['checklist-history', templateId],
    queryFn: async () => {
      const { data } = await supabase
        .from('checklist_completions')
        .select(`
          *,
          checklist_responses(*),
          profiles!checklist_completions_completed_by_fkey(full_name)
        `)
        .eq('template_id', templateId)
        .eq('business_id', business!.id)
        .order('completed_at', { ascending: false })
        .limit(50)
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const items = (template?.checklist_template_items ?? []) as Array<{
    id: string; name: string; item_type: string; unit: string | null
  }>
  const itemMap = new Map(items.map((i) => [i.id, i]))

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/checklists"
          className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Checklists
        </Link>
        <PageHeader
          title={`${template?.name ?? 'Checklist'} — History`}
          description="All past completions"
        />
      </div>

      {completions?.length === 0 ? (
        <EmptyState
          icon={History}
          title="No completions yet"
          description="This checklist hasn't been completed yet."
        />
      ) : (
        <div className="space-y-2">
          {completions?.map((completion) => {
            const isExpanded = expandedId === completion.id
            const responses = (completion.checklist_responses ?? []) as Array<{
              item_id: string; value: string; notes: string | null; flagged: boolean
            }>
            const flaggedCount = responses.filter((r) => r.flagged).length
            const completerName = (completion.profiles as { full_name: string | null } | null)?.full_name ?? 'Unknown'

            return (
              <div key={completion.id} className="rounded-lg border border-border bg-white">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : completion.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-accent/50"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-[13px] font-medium">
                        {format(new Date(completion.completed_at), 'dd MMM yyyy, HH:mm')}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        by {completerName}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {flaggedCount > 0 && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-red-600">
                        <AlertTriangle className="h-3 w-3" />
                        {flaggedCount} flagged
                      </span>
                    )}
                    <StatusBadge
                      status={completion.signed_off_by ? 'success' : 'info'}
                      label={completion.signed_off_by ? 'Signed Off' : 'Completed'}
                    />
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border px-4 py-3">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-left text-[11px] text-muted-foreground">
                          <th className="pb-2 font-medium">Item</th>
                          <th className="pb-2 font-medium">Response</th>
                          <th className="pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {responses.map((resp) => {
                          const item = itemMap.get(resp.item_id)
                          return (
                            <tr key={resp.item_id}>
                              <td className="py-2">{item?.name ?? 'Unknown'}</td>
                              <td className="py-2 tabular-nums">
                                {resp.value}
                                {item?.unit && ` ${item.unit}`}
                              </td>
                              <td className="py-2">
                                {resp.flagged ? (
                                  <span className="text-red-600 font-medium">Flagged</span>
                                ) : (
                                  <span className="text-emerald-600">OK</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {completion.notes && (
                      <p className="mt-2 text-[12px] text-muted-foreground">
                        Notes: {completion.notes}
                      </p>
                    )}
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
