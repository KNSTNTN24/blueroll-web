'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  ClipboardList, Plus, History, Pencil, Clock,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { CHECKLIST_FREQUENCIES, ROLE_LABELS, type UserRole } from '@/lib/constants'
import { startOfDay, startOfWeek, startOfMonth } from 'date-fns'

function getPeriodStart(frequency: string): Date {
  const now = new Date()
  if (frequency === 'weekly') return startOfWeek(now, { weekStartsOn: 1 })
  if (frequency === 'monthly') return startOfMonth(now)
  if (frequency === 'four_weekly') {
    const d = startOfWeek(now, { weekStartsOn: 1 })
    d.setDate(d.getDate() - 21)
    return d
  }
  return startOfDay(now)
}

export default function ChecklistsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  // ── Today's templates for user's role ──
  const { data: myTemplates = [], isLoading: loadingMy } = useQuery({
    queryKey: ['my-checklists', business?.id, profile?.role],
    queryFn: async () => {
      if (!business?.id || !profile?.role) return []
      const { data, error } = await supabase
        .from('checklist_templates')
        .select('*, checklist_template_items(id)')
        .eq('business_id', business.id)
        .eq('active', true)
        .contains('assigned_roles', [profile.role])
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id && !!profile?.role,
  })

  // ── All templates for library ──
  const { data: allTemplates = [], isLoading: loadingAll } = useQuery({
    queryKey: ['all-checklists', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('checklist_templates')
        .select('*, checklist_template_items(id)')
        .eq('business_id', business.id)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id && isManager,
  })

  // ── Completions for status check ──
  const { data: completions = [] } = useQuery({
    queryKey: ['checklist-completions', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      // Fetch completions from the last month to cover all period types
      const monthAgo = new Date()
      monthAgo.setDate(monthAgo.getDate() - 35)
      const { data, error } = await supabase
        .from('checklist_completions')
        .select('template_id, completed_at, signed_off_by')
        .eq('business_id', business.id)
        .gte('completed_at', monthAgo.toISOString())
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  function getStatus(template: any): { label: string; status: 'success' | 'warning' | 'info' | 'neutral' } {
    const periodStart = getPeriodStart(template.frequency)
    const completion = completions.find(
      (c: any) => c.template_id === template.id && new Date(c.completed_at) >= periodStart
    )
    if (!completion) return { label: 'Pending', status: 'neutral' }
    if (completion.signed_off_by) return { label: 'Signed Off', status: 'success' }
    if (template.supervisor_role) return { label: 'Awaiting Sign-off', status: 'warning' }
    return { label: 'Completed', status: 'success' }
  }

  // ── Toggle active mutation ──
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('checklist_templates')
        .update({ active })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-checklists'] })
      queryClient.invalidateQueries({ queryKey: ['my-checklists'] })
      toast.success('Template updated')
    },
    onError: () => toast.error('Failed to update template'),
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Checklists" description="Daily food safety checks">
        {isManager && (
          <Button
            size="sm"
            onClick={() => router.push('/checklists/new')}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            New Template
          </Button>
        )}
      </PageHeader>

      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          {isManager && <TabsTrigger value="library">Library</TabsTrigger>}
        </TabsList>

        {/* ── Today tab ── */}
        <TabsContent value="today" className="mt-4">
          {loadingMy ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
            </div>
          ) : myTemplates.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No checklists assigned"
              description="There are no active checklists for your role today."
            />
          ) : (
            <div className="space-y-2">
              {myTemplates.map((t: any) => {
                const s = getStatus(t)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => router.push(`/checklists/${t.id}`)}
                    className="flex w-full items-center gap-4 rounded-lg border border-border bg-white px-4 py-3 text-left transition-colors hover:bg-accent/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground">{t.name}</p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {t.frequency} &middot; {t.checklist_template_items?.length ?? 0} items
                        {t.deadline_time && (
                          <span className="inline-flex items-center gap-1 ml-2">
                            <Clock className="h-3 w-3" /> by {t.deadline_time}
                          </span>
                        )}
                      </p>
                    </div>
                    <StatusBadge status={s.status} label={s.label} />
                  </button>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Library tab (managers) ── */}
        {isManager && (
          <TabsContent value="library" className="mt-4">
            {loadingAll ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
              </div>
            ) : allTemplates.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No templates"
                description="Create your first checklist template."
                action={{ label: 'New Template', onClick: () => router.push('/checklists/new') }}
              />
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Frequency</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Items</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Roles</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Active</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allTemplates.map((t: any) => (
                      <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium text-foreground">{t.name}</td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">{t.frequency}</td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {t.checklist_template_items?.length ?? 0}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(t.assigned_roles ?? []).map((r: string) => (
                              <span
                                key={r}
                                className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600 border border-gray-200"
                              >
                                {ROLE_LABELS[r as UserRole] ?? r}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Switch
                            checked={t.active}
                            onCheckedChange={(checked) =>
                              toggleActiveMutation.mutate({ id: t.id, active: checked })
                            }
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => router.push(`/checklists/edit/${t.id}`)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => router.push(`/checklists/${t.id}/history`)}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
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
