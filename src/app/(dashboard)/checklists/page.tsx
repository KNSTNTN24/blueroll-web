'use client'

import { useState, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  Plus, Pencil, Clock, ChevronLeft, ClipboardCheck, BookOpen, ShieldCheck,
} from 'lucide-react'
import { StatusBadge } from '@/components/shared/status-badge'
import { Switch } from '@/components/ui/switch'
import { InspectionEmpty, EmptyPrimary, EmptySecondary, ChecklistArt } from '@/components/shared/inspection-empty'
import { ROLE_LABELS, type UserRole } from '@/lib/constants'
import { checklistStatus, compareTemplates } from '@/lib/checklist-status'
import { startOfDay, startOfWeek, startOfMonth, format } from 'date-fns'

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

function ChecklistsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const [view, setView] = useState<'today' | 'library'>(searchParams.get('tab') === 'library' && isManager ? 'library' : 'today')

  const currentSiteId = useAuthStore((s) => s.currentSiteId)

  // ── Today's templates for user's role ──
  const { data: myTemplates = [], isLoading: loadingMy } = useQuery({
    queryKey: ['my-checklists', business?.id, profile?.role, currentSiteId],
    queryFn: async () => {
      if (!business?.id || !profile?.role) return []
      let q = supabase
        .from('checklist_templates')
        .select('*, checklist_template_items(id)')
        .eq('business_id', business.id)
        .eq('active', true)
        .contains('assigned_roles', [profile.role])
      if (currentSiteId) q = q.eq('site_id', currentSiteId)
      const { data, error } = await q.order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id && !!profile?.role,
  })

  // ── All templates for library ──
  const { data: allTemplates = [], isLoading: loadingAll } = useQuery({
    queryKey: ['all-checklists', business?.id, currentSiteId],
    queryFn: async () => {
      if (!business?.id) return []
      let q = supabase
        .from('checklist_templates')
        .select('*, checklist_template_items(id)')
        .eq('business_id', business.id)
      if (currentSiteId) q = q.eq('site_id', currentSiteId)
      const { data, error } = await q.order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id && isManager,
  })

  // ── Completions for status check ──
  const { data: completions = [] } = useQuery({
    queryKey: ['checklist-completions', business?.id, currentSiteId],
    queryFn: async () => {
      if (!business?.id) return []
      // Fetch completions from the last month to cover all period types
      const monthAgo = new Date()
      monthAgo.setDate(monthAgo.getDate() - 35)
      let q = supabase
        .from('checklist_completions')
        .select('template_id, completed_at, signed_off_by')
        .eq('business_id', business.id)
        .gte('completed_at', monthAgo.toISOString())
      if (currentSiteId) q = q.eq('site_id', currentSiteId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  function getStatus(template: any) {
    // multi-per-day counts TODAY regardless of declared frequency
    const periodStart = getPeriodStart(template.multi_per_day ? 'daily' : template.frequency)
    const periodCompletions = completions.filter(
      (c: any) => c.template_id === template.id && new Date(c.completed_at) >= periodStart
    )
    return checklistStatus(template, periodCompletions)
  }

  // Sort Today templates by status: pending first, earlier deadline first, then name
  const sortedMyTemplates = [...myTemplates]
    .map((t: any) => ({ t, done: getStatus(t).done }))
    .sort(compareTemplates)
    .map((x) => x.t)

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

  // ── Template library (separate view) ──
  if (view === 'library' && isManager) {
    return (
      <div className="flex flex-col gap-4" style={{ fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
        <button onClick={() => setView('today')} className="inline-flex items-center gap-1.5 self-start text-[13px] font-semibold text-[#5c626b] hover:text-foreground">
          <ChevronLeft className="h-[15px] w-[15px]" strokeWidth={1.8} /> Back to today&apos;s checks
        </button>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="text-[24px] font-bold tracking-[-.02em] text-[#16181d]">Template library</h1>
            <p className="mt-1 text-[14px] text-[#6b7280]">Reusable checklists — assign each to sites and shifts, and Today fills itself</p>
          </div>
          <button onClick={() => router.push('/checklists/new')}
            className="flex items-center gap-2 rounded-[11px] bg-brand px-[17px] py-[11px] text-[14px] font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,.1)] transition-opacity hover:opacity-90">
            <Plus className="h-4 w-4" strokeWidth={2} /> New Template
          </button>
        </div>

        {loadingAll ? (
          <div className="flex items-center justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" /></div>
        ) : allTemplates.length === 0 ? (
          <InspectionEmpty illustration={ChecklistArt} badge="The first thing an EHO inspector asks to see"
            title="Your daily checks, on autopilot"
            sentence="Templates assign themselves to every shift and keep signed, timestamped records.">
            <EmptyPrimary onClick={() => router.push('/checklists/new')}><Plus className="h-4 w-4" strokeWidth={2} /> New Template</EmptyPrimary>
          </InspectionEmpty>
        ) : (
          <div className="overflow-hidden rounded-[16px] border border-[#e9eaed] bg-white shadow-[0_1px_2px_rgba(16,24,40,.03),0_14px_36px_-28px_rgba(16,24,40,.16)]">
            {allTemplates.map((t: any) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3.5 border-b border-[#f2f3f5] px-5 py-3.5 last:border-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#e9f4ee] text-[#1f7a52]">
                  <ClipboardCheck className="h-[17px] w-[17px]" strokeWidth={1.7} />
                </div>
                <div className="w-[230px] shrink-0">
                  <div className="text-[14.5px] font-semibold text-foreground">{t.name}</div>
                  <div className="mt-0.5 text-[12.5px] text-[#8a9099]">{t.checklist_template_items?.length ?? 0} checks · <span className="capitalize">{t.frequency}</span></div>
                </div>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {(t.assigned_roles ?? []).map((r: string) => (
                    <span key={r} className="whitespace-nowrap rounded-full border border-[#e4e6ea] px-[9px] py-[3px] text-[11.5px] font-medium text-[#5c626b]">{ROLE_LABELS[r as UserRole] ?? r}</span>
                  ))}
                </div>
                <Switch checked={t.active} onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: t.id, active: checked })} />
                <button onClick={() => router.push(`/checklists/edit/${t.id}`)}
                  className="flex shrink-0 items-center gap-1.5 rounded-[9px] border border-[#e2e4e8] bg-white px-3 py-[7px] text-[12.5px] font-semibold text-[#41464d] transition-colors hover:border-[#cdd1d6] hover:text-[#1c1f24]">
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} /> Edit
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Today (work queue) ──
  return (
    <div className="flex flex-col gap-4" style={{ fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-.02em] text-[#16181d]">Checklists</h1>
          <p className="mt-1 text-[14px] text-[#6b7280]">Today&apos;s food safety checks · {format(new Date(), 'EEEE d MMMM')}</p>
        </div>
        {isManager && (
          <div className="flex gap-2.5">
            <button onClick={() => setView('library')}
              className="flex items-center gap-2 rounded-[10px] border border-[#e2e4e8] bg-white px-[15px] py-2.5 text-[13.5px] font-semibold text-[#41464d] transition-colors hover:border-[#cdd1d6] hover:text-[#1c1f24]">
              <BookOpen className="h-4 w-4 text-[#5c626b]" strokeWidth={1.7} /> Template library
            </button>
            <button onClick={() => router.push('/checklists/new')}
              className="flex items-center gap-2 rounded-[11px] bg-brand px-[17px] py-[11px] text-[14px] font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,.1)] transition-opacity hover:opacity-90">
              <Plus className="h-4 w-4" strokeWidth={2} /> New Template
            </button>
          </div>
        )}
      </div>

      {loadingMy ? (
        <div className="flex items-center justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" /></div>
      ) : myTemplates.length === 0 ? (
        <InspectionEmpty illustration={ChecklistArt} badge="The first thing an EHO inspector asks to see"
          title="Your daily checks, on autopilot"
          sentence="Templates assign themselves to every shift and keep signed, timestamped records.">
          {isManager && <>
            <EmptyPrimary onClick={() => router.push('/checklists/new')}><Plus className="h-4 w-4" strokeWidth={2} /> New Template</EmptyPrimary>
            <EmptySecondary onClick={() => router.push('/checklists/new?from=fsa')}><ShieldCheck className="h-4 w-4 text-brand" strokeWidth={1.8} /> Start from FSA templates</EmptySecondary>
          </>}
        </InspectionEmpty>
      ) : (
        <div className="space-y-2">
          {sortedMyTemplates.map((t: any) => {
            const s = getStatus(t)
            return (
              <button key={t.id} type="button" onClick={() => router.push(`/checklists/${t.id}`)}
                className="flex w-full items-center gap-4 rounded-[12px] border border-[#e9eaed] bg-white px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(16,24,40,.03)] transition-colors hover:bg-[#fafbfb]">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-foreground">{t.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-[#8a9099]">
                    <span className="capitalize">{t.frequency}</span> · {t.checklist_template_items?.length ?? 0} checks
                    {t.deadline_time && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> by {t.deadline_time}</span>}
                  </p>
                </div>
                <StatusBadge status={s.status} label={s.label} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function ChecklistsPage() {
  return (
    <Suspense fallback={null}>
      <ChecklistsPageInner />
    </Suspense>
  )
}
