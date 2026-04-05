'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  ClipboardCheck,
  Plus,
  ChevronRight,
  Clock,
  Pencil,
  History,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, startOfDay, endOfDay } from 'date-fns'
import { toast } from 'sonner'

export default function ChecklistsPage() {
  const { profile, business } = useAuthStore()
  const router = useRouter()
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const today = new Date()

  const { data: templates, isLoading } = useQuery({
    queryKey: ['checklist-templates', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('checklist_templates')
        .select('*, checklist_template_items(*)')
        .eq('business_id', business!.id)
        .order('name')
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const { data: completions } = useQuery({
    queryKey: ['checklist-completions-today', business?.id],
    queryFn: async () => {
      const todayStart = startOfDay(today).toISOString()
      const todayEnd = endOfDay(today).toISOString()
      const { data } = await supabase
        .from('checklist_completions')
        .select('*, profiles!checklist_completions_completed_by_fkey(full_name)')
        .eq('business_id', business!.id)
        .gte('completed_at', todayStart)
        .lte('completed_at', todayEnd)
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('checklist_templates')
        .update({ active })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-templates'] })
      toast.success('Checklist updated')
    },
  })

  const activeTemplates = templates?.filter((t) => t.active) ?? []
  const myTemplates = activeTemplates.filter((t) =>
    t.assigned_roles.includes(profile?.role ?? '')
  )

  const getStatus = (templateId: string) => {
    const completion = completions?.find((c) => c.template_id === templateId)
    if (!completion) return { status: 'pending' as const, label: 'Pending' }
    if (completion.signed_off_by) return { status: 'success' as const, label: 'Signed Off' }
    return { status: 'success' as const, label: 'Completed' }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Checklists"
        description="Daily, weekly, and monthly HACCP checklists"
      >
        {isManager && (
          <Button
            onClick={() => router.push('/checklists/new')}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Checklist
          </Button>
        )}
      </PageHeader>

      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          {isManager && <TabsTrigger value="library">Library</TabsTrigger>}
        </TabsList>

        <TabsContent value="today" className="mt-4">
          {myTemplates.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No checklists assigned"
              description="There are no active checklists assigned to your role. Ask your manager to assign checklists."
            />
          ) : (
            <div className="rounded-lg border border-border bg-white">
              <div className="divide-y divide-border">
                {myTemplates.map((template) => {
                  const { status, label } = getStatus(template.id)
                  return (
                    <Link
                      key={template.id}
                      href={`/checklists/${template.id}`}
                      className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-accent/50"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-md',
                            status === 'success'
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-gray-50 text-gray-400'
                          )}
                        >
                          <ClipboardCheck className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-[13px] font-medium">{template.name}</p>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="capitalize">{template.frequency}</span>
                            <span>&middot;</span>
                            <span>
                              {(template.checklist_template_items as unknown[])?.length ?? 0} items
                            </span>
                            {template.deadline_time && (
                              <>
                                <span>&middot;</span>
                                <span className="flex items-center gap-0.5">
                                  <Clock className="h-3 w-3" />
                                  {template.deadline_time}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge
                          status={status === 'success' ? 'success' : 'warning'}
                          label={label}
                        />
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </TabsContent>

        {isManager && (
          <TabsContent value="library" className="mt-4">
            {templates?.length === 0 ? (
              <EmptyState
                icon={ClipboardCheck}
                title="No checklists yet"
                description="Create your first checklist template or import the default UK HACCP templates."
                action={{
                  label: 'New Checklist',
                  onClick: () => router.push('/checklists/new'),
                }}
              />
            ) : (
              <div className="rounded-lg border border-border bg-white">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                        Name
                      </th>
                      <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                        Frequency
                      </th>
                      <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                        Items
                      </th>
                      <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                        Assigned
                      </th>
                      <th className="px-4 py-2.5 text-center text-[12px] font-medium text-muted-foreground">
                        Active
                      </th>
                      <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {templates?.map((template) => (
                      <tr key={template.id} className="transition-colors hover:bg-accent/50">
                        <td className="px-4 py-3 text-[13px] font-medium">
                          {template.name}
                        </td>
                        <td className="px-4 py-3 text-[13px] capitalize text-muted-foreground">
                          {template.frequency}
                        </td>
                        <td className="px-4 py-3 text-[13px] tabular-nums text-muted-foreground">
                          {(template.checklist_template_items as unknown[])?.length ?? 0}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {template.assigned_roles.map((role: string) => (
                              <span
                                key={role}
                                className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground"
                              >
                                {role.replace('_', ' ')}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Switch
                            checked={template.active}
                            onCheckedChange={(checked) =>
                              toggleActive.mutate({ id: template.id, active: checked })
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => router.push(`/checklists/edit/${template.id}`)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => router.push(`/checklists/${template.id}/history`)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <History className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
