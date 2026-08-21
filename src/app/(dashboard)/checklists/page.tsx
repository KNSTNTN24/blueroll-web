'use client'

import { useState, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  Plus, Pencil, Clock, ChevronLeft, ClipboardCheck, BookOpen, ShieldCheck,
  Sun, Thermometer, Sparkles, Moon, ArrowRight,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { InspectionEmpty, EmptyPrimary, EmptySecondary, ChecklistArt } from '@/components/shared/inspection-empty'
import { useRoleLabel } from '@/hooks/use-role-label'
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
  const roleLabel = useRoleLabel()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const [view, setView] = useState<'today' | 'library'>(searchParams.get('tab') === 'library' && isManager ? 'library' : 'today')

  const currentSiteId = useAuthStore((s) => s.currentSiteId)

  // ── Today's templates for user's role ──
  const { data: myTemplates = [], isLoading: loadingMy } = useQuery({
    queryKey: ['my-checklists', business?.id, profile?.role_id, profile?.role, profile?.is_group_admin, currentSiteId],
    queryFn: async () => {
      if (!business?.id || !profile?.role) return []
      let q = supabase
        .from('checklist_templates')
        .select('*, checklist_template_items(id)')
        .eq('business_id', business.id)
        .eq('active', true)
      // Owners (full access) and group admins see every checklist. Everyone
      // else is filtered by their role: prefer the precise role_id match
      // (supports custom roles), falling back to the base-tier role for any
      // legacy profile without a role_id.
      const seesAll = profile.role === 'owner' || profile.is_group_admin
      if (!seesAll) {
        if (profile.role_id) q = q.contains('assigned_role_ids', [profile.role_id])
        else q = q.contains('assigned_roles', [profile.role])
      }
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

  // ── My in-progress drafts (for card partial progress) ──
  const { data: drafts = [] } = useQuery({
    queryKey: ['my-drafts', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => (await supabase.from('checklist_drafts').select('template_id, responses').eq('created_by', profile!.id)).data ?? [],
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
                    <span key={r} className="whitespace-nowrap rounded-full border border-[#e4e6ea] px-[9px] py-[3px] text-[11.5px] font-medium text-[#5c626b]">{roleLabel(r)}</span>
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

  // ── Today (work queue, grouped by shift) ──
  // Per-checklist tile styling by name keyword.
  function tileFor(name: string): { bg: string; fg: string; Icon: typeof Sun } {
    const n = name.toLowerCase()
    if (/open/.test(n)) return { bg: '#fbf1e1', fg: '#b07d1e', Icon: Sun }
    if (/temp|fridge|freez|chill|cook/.test(n)) return { bg: '#eef2f6', fg: '#4e6e81', Icon: Thermometer }
    if (/clean|wash|sanit/.test(n)) return { bg: '#f1f0f4', fg: '#6b6580', Icon: Sparkles }
    if (/clos|end of day|shutdown/.test(n)) return { bg: '#eae7f2', fg: '#5b5480', Icon: Moon }
    return { bg: '#e9f4ee', fg: '#1f7a52', Icon: ClipboardCheck }
  }
  // Assign a template to a shift group from its deadline hour.
  function shiftOf(t: any): 0 | 1 | 2 {
    if (!t.deadline_time) return 1
    const h = parseInt(String(t.deadline_time).slice(0, 2), 10)
    if (h < 12) return 0
    if (h < 17) return 1
    return 2
  }
  // Card model: done / total items, derived state + status badge.
  function cardModel(t: any) {
    const s = getStatus(t)
    const total = t.checklist_template_items?.length ?? 0
    const draft = drafts.find((d: any) => d.template_id === t.id)
    const draftAnswered = draft?.responses ? Object.values(draft.responses).filter((r: any) => r && r.value !== '' && r.value != null).length : 0
    if (s.done) return { s, total, done: total, state: 'done' as const }
    if (draftAnswered > 0) return { s, total, done: Math.min(draftAnswered, total), state: 'progress' as const }
    return { s, total, done: 0, state: 'todo' as const }
  }

  const models = sortedMyTemplates.map((t: any) => ({ t, ...cardModel(t) }))
  const total = models.length
  const doneCount = models.filter((m) => m.state === 'done').length
  const overdueCount = models.filter((m) => m.state !== 'done' && m.s.label === 'Overdue').length
  const todoCount = total - doneCount - overdueCount
  const pct = total ? doneCount / total : 0
  const C = 2 * Math.PI * 25
  const headline = total === 0 ? '' : doneCount === total ? 'All done for today — nice work' : overdueCount > 0 ? 'Some checks need attention' : "Let's get today's checks done"
  const SHIFTS: { label: string; window: string }[] = [
    { label: 'Opening', window: 'Before service' },
    { label: 'During service', window: 'Anytime today' },
    { label: 'Closing', window: 'End of day' },
  ]
  const currentSite = useAuthStore.getState().sites.find((sx) => sx.id === currentSiteId)

  function StatusChip({ m }: { m: ReturnType<typeof cardModel> }) {
    let bg = '#f1f2f4', fg = '#6b7280', label = 'To do'
    if (m.state === 'done') {
      if (m.s.status === 'warning') { bg = '#fbf1e1'; fg = '#b07d1e'; label = 'Awaiting sign-off' }
      else { bg = '#e9f2ec'; fg = '#1a6e49'; label = 'Done' }
    } else if (m.s.label === 'Overdue') { bg = '#fbf1e1'; fg = '#b07d1e'; label = 'Overdue' }
    else if (m.state === 'progress') { bg = '#fbf1e1'; fg = '#b07d1e'; label = 'In progress' }
    return <span style={{ font: "600 11.5px 'Geist'", padding: '3px 10px', borderRadius: 20, background: bg, color: fg, whiteSpace: 'nowrap' }}>{label}</span>
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* head */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.025em' }}>Today&apos;s checklists</h1>
          <div style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>{format(new Date(), 'EEEE d MMMM')}{currentSite ? ` · ${currentSite.name}` : ''}</div>
        </div>
        {isManager && (
          <button onClick={() => setView('library')} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e2e4e8', color: '#41464d', font: "600 13.5px 'Geist'", padding: '9px 14px', borderRadius: 10, cursor: 'pointer' }}>
            <BookOpen className="h-4 w-4" style={{ color: '#5c626b' }} strokeWidth={1.7} /> Manage templates
          </button>
        )}
      </div>

      {loadingMy ? (
        <div className="flex items-center justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" /></div>
      ) : total === 0 ? (
        <InspectionEmpty illustration={ChecklistArt} badge="The first thing an EHO inspector asks to see"
          title="Your daily checks, on autopilot"
          sentence="Templates assign themselves to every shift and keep signed, timestamped records.">
          {isManager && <>
            <EmptyPrimary onClick={() => router.push('/checklists/new')}><Plus className="h-4 w-4" strokeWidth={2} /> New Template</EmptyPrimary>
            <EmptySecondary onClick={() => router.push('/checklists/new?from=fsa')}><ShieldCheck className="h-4 w-4 text-brand" strokeWidth={1.8} /> Start from FSA templates</EmptySecondary>
          </>}
        </InspectionEmpty>
      ) : (
        <>
          {/* day progress banner */}
          <div style={{ background: '#14161b', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 64, height: 64, flex: 'none' }}>
              <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="32" cy="32" r="25" fill="none" stroke="#2c2f37" strokeWidth="7" />
                <circle cx="32" cy="32" r="25" fill="none" stroke="#1f9d63" strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: 'stroke-dashoffset .5s' }} />
              </svg>
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 15px 'Geist'", color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{Math.round(pct * 100)}%</span>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ font: "700 17px 'Geist'", color: '#fff', letterSpacing: '-.01em' }}>{headline}</div>
              <div style={{ font: "500 13px 'Geist'", color: '#9aa0a8', marginTop: 3 }}>{doneCount} of {total} checklists complete</div>
            </div>
            <div style={{ display: 'flex', gap: 26 }}>
              {[{ n: doneCount, l: 'Done', c: '#4ec98f' }, { n: todoCount, l: 'To do', c: '#e6e8ec' }, { n: overdueCount, l: 'Overdue', c: overdueCount > 0 ? '#f0a24d' : '#5c626b' }].map((st) => (
                <div key={st.l} style={{ textAlign: 'center' }}>
                  <div style={{ font: "700 22px 'Geist'", color: st.c, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{st.n}</div>
                  <div style={{ font: "500 11.5px 'Geist'", color: '#8a9099', marginTop: 5 }}>{st.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* shift groups */}
          {SHIFTS.map((shift, si) => {
            const group = models.filter((m) => shiftOf(m.t) === si)
            if (group.length === 0) return null
            return (
              <div key={shift.label}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 2px 11px' }}>
                  <span style={{ font: "600 11.5px 'Geist'", letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a9099', whiteSpace: 'nowrap' }}>{shift.label}</span>
                  <span style={{ font: "500 12px 'Geist'", color: '#b3b8bf', whiteSpace: 'nowrap' }}>{shift.window}</span>
                  <span style={{ flex: 1, height: 1, background: '#eceef0' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {group.map((m) => {
                    const tile = tileFor(m.t.name)
                    const cta = m.state === 'done' ? 'Review' : m.state === 'progress' ? 'Continue' : 'Start'
                    const barPct = m.total ? Math.round((m.done / m.total) * 100) : 0
                    return (
                      <div key={m.t.id} onClick={() => router.push(`/checklists/${m.t.id}`)} role="button"
                        style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 15, padding: '15px 17px', display: 'flex', alignItems: 'center', gap: 15, cursor: 'pointer', transition: 'box-shadow .16s, border-color .16s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 20px 44px -26px rgba(16,24,40,.28)'; e.currentTarget.style.borderColor = '#dfe2e6' }}
                        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e9eaed' }}>
                        <span style={{ width: 44, height: 44, borderRadius: 12, background: tile.bg, color: tile.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><tile.Icon className="h-[21px] w-[21px]" strokeWidth={1.7} /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                            <span style={{ font: "600 15px 'Geist'", color: '#1c1f24' }}>{m.t.name}</span>
                            <StatusChip m={m} />
                          </div>
                          <div style={{ font: "500 12.5px 'Geist'", color: '#8a9099', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {m.state === 'done' ? `${m.total} of ${m.total} items` : `${m.done} of ${m.total} items`}
                            {m.t.deadline_time && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock className="h-3 w-3" strokeWidth={1.8} /> by {String(m.t.deadline_time).slice(0, 5)}</span>}
                          </div>
                          <div style={{ height: 6, background: '#eef0f2', borderRadius: 20, overflow: 'hidden', marginTop: 9, maxWidth: 420 }}>
                            <div style={{ height: '100%', width: `${barPct}%`, background: m.done > 0 ? '#1f9d63' : '#c2c6cc', borderRadius: 20, transition: 'width .3s' }} />
                          </div>
                        </div>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none', font: "600 13px 'Geist'", padding: '9px 15px', borderRadius: 10, background: m.state === 'done' ? '#f4f5f6' : '#1f9d63', color: m.state === 'done' ? '#41464d' : '#fff', border: m.state === 'done' ? '1px solid #e5e7ea' : 'none' }}>
                          {cta} <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </>
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
