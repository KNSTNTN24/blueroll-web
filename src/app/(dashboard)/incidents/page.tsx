'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Plus, Search, Check, Pencil, Trash2, X, RotateCcw, CircleCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { notifyNewIncident, notifyIncidentResolved } from '@/lib/notifications'
import { format, startOfMonth, differenceInHours } from 'date-fns'

interface Incident {
  id: string
  type: string
  description: string
  action_taken: string | null
  follow_up: string | null
  status: string
  reported_by: string
  resolved_by: string | null
  resolved_at: string | null
  resolved_notes: string | null
  date: string
  created_at: string
  reporter?: { full_name: string | null; email: string }
}

type Tab = 'all' | 'open' | 'resolved'

function initials(name: string | null | undefined, email?: string): string {
  if (name) { const p = name.split(' ').filter(Boolean); return (p.length >= 2 ? p[0][0] + p[p.length-1][0] : (p[0]?.[0] ?? '')).toUpperCase() }
  return (email?.[0] ?? '?').toUpperCase()
}

export default function IncidentsPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [resolveId, setResolveId] = useState<string | null>(null)
  const [resolveNote, setResolveNote] = useState('')

  // Unified report/edit form state
  const [fType, setFType] = useState('incident')
  const [fDesc, setFDesc] = useState('')
  const [fAction, setFAction] = useState('')
  const [fFollow, setFFollow] = useState('')
  const [fDate, setFDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  const { data: incidents = [], isLoading } = useQuery({
    queryKey: ['incidents', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('incidents')
        .select('*, reporter:profiles!incidents_reported_by_fkey(full_name, email)')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Incident[]
    },
    enabled: !!business?.id,
  })

  // Summary
  const openCount = incidents.filter((i) => i.status === 'open').length
  const complaintCount = incidents.filter((i) => i.type === 'complaint').length
  const monthStart = startOfMonth(new Date())
  const resolvedThisMonth = incidents.filter((i) => i.status === 'resolved' && i.resolved_at && new Date(i.resolved_at) >= monthStart).length
  const resolvedWithTimes = incidents.filter((i) => i.status === 'resolved' && i.resolved_at)
  const avgDays = resolvedWithTimes.length
    ? (resolvedWithTimes.reduce((sum, i) => sum + Math.max(0, differenceInHours(new Date(i.resolved_at!), new Date(i.created_at))), 0) / resolvedWithTimes.length / 24)
    : null

  const counts = { all: incidents.length, open: openCount, resolved: incidents.filter((i) => i.status === 'resolved').length }

  const filtered = incidents.filter((i) => {
    const matchTab = tab === 'all' || i.status === tab
    const matchQuery = !query || i.description.toLowerCase().includes(query.toLowerCase())
    return matchTab && matchQuery
  })

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!business?.id || !profile?.id) throw new Error('No business')
      if (editingId) {
        const { error } = await supabase.from('incidents').update({
          type: fType, description: fDesc, action_taken: fAction || null, follow_up: fFollow || null, date: fDate,
        }).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('incidents').insert({
          business_id: business.id, type: fType, description: fDesc,
          action_taken: fAction || null, follow_up: fFollow || null, status: 'open', reported_by: profile.id, date: fDate,
        })
        if (error) throw error
        await notifyNewIncident(business.id, fDesc.substring(0, 100))
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success(editingId ? 'Incident updated' : 'Incident reported')
      setFormOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !resolveId) throw new Error('No user')
      const incident = incidents.find((i) => i.id === resolveId)
      const { error } = await supabase.from('incidents').update({
        status: 'resolved', resolved_by: profile.id, resolved_at: new Date().toISOString(), resolved_notes: resolveNote || null,
      }).eq('id', resolveId)
      if (error) throw error
      if (incident) await notifyIncidentResolved(incident.reported_by, incident.description.substring(0, 100))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident resolved')
      setResolveId(null); setResolveNote('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const reopenMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('incidents').update({ status: 'open', resolved_by: null, resolved_at: null, resolved_notes: null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['incidents'] }); toast.success('Incident reopened') },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('incidents').delete().eq('id', id); if (error) throw error },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['incidents'] }); toast.success('Incident deleted') },
    onError: (err: Error) => toast.error(err.message),
  })

  function openNew() {
    setEditingId(null); setFType('incident'); setFDesc(''); setFAction(''); setFFollow(''); setFDate(format(new Date(), 'yyyy-MM-dd')); setFormOpen(true)
  }
  function openEdit(i: Incident) {
    setEditingId(i.id); setFType(i.type); setFDesc(i.description); setFAction(i.action_taken ?? ''); setFFollow(i.follow_up ?? '')
    setFDate(i.date ? format(new Date(i.date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')); setFormOpen(true)
  }

  const resolveTarget = incidents.find((i) => i.id === resolveId)
  const tabs: { key: Tab; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'open', label: 'Open' }, { key: 'resolved', label: 'Resolved' }]

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-foreground">Incidents</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">Track complaints and incidents across the kitchen</p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus strokeWidth={2} /> Report incident
        </Button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <SummaryCard label="Open" value={openCount} dot="#d98a1a" />
        <SummaryCard label="Complaints" value={complaintCount} />
        <SummaryCard label="Resolved this month" value={resolvedThisMonth} />
        <SummaryCard label="Avg. resolution" value={avgDays == null ? '—' : avgDays.toFixed(1)} unit={avgDays == null ? undefined : 'days'} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="flex gap-1 rounded-[11px] bg-[#eceef1] p-1">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={cn(
              'flex items-center gap-1.5 rounded-[8px] px-[15px] py-[7px] text-[13.5px] font-semibold transition-colors',
              tab === t.key ? 'bg-card text-[#1c1f24] shadow-[0_1px_2px_rgba(16,24,40,.07)]' : 'text-muted-foreground',
            )}>
              {t.label}<span className={cn('text-[11px] font-semibold', tab === t.key ? 'text-[#8a9099]' : 'text-[#b0b5bc]')}>{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex w-[280px] max-w-full items-center gap-2.5 rounded-[11px] border border-input bg-card px-3 py-[9px] focus-within:border-brand focus-within:ring-[3px] focus-within:ring-[rgba(31,157,99,.12)]">
          <Search className="h-4 w-4 shrink-0 text-[#9aa0a8]" strokeWidth={1.7} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search incidents…"
            className="min-w-0 flex-1 border-none bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground" />
        </label>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        {isLoading ? (
          <div className="p-12 text-center text-[14px] text-muted-foreground">Loading incidents…</div>
        ) : filtered.length === 0 ? (
          <div className="p-[50px] text-center text-[14px] text-[#9aa0a8]">No incidents in this view.</div>
        ) : filtered.map((inc) => {
          const isOpen = inc.status === 'open'
          const accent = isOpen ? '#e2b87e' : '#cde3d4'
          return (
            <div key={inc.id} className="group grid min-h-[66px] items-center gap-3.5 border-b border-[#f2f3f5] pr-[18px] transition-colors last:border-0 hover:bg-[#fafbfb]"
              style={{ gridTemplateColumns: '4px 1fr 150px 116px 116px' }}>
              {/* accent bar */}
              <div className="self-stretch rounded-r-[3px]" style={{ background: accent }} />
              {/* main */}
              <div className="min-w-0 py-[13px]">
                <div className="flex items-center gap-2.5">
                  <span className={cn('shrink-0 rounded-md px-2 py-[3px] text-[11px] font-semibold tracking-[0.02em]',
                    inc.type === 'complaint' ? 'bg-[#f8f0e8] text-[#9a5b2a]' : 'bg-[#f1f2f4] text-[#5c626b]')}>
                    {inc.type === 'complaint' ? 'Complaint' : 'Incident'}
                  </span>
                  <span className="truncate text-[14.5px] font-semibold text-[#1c1f24]">{inc.description}</span>
                </div>
                <div className="mt-[5px] flex items-center gap-2 text-[12.5px] text-[#8a9099]">
                  <span className="text-[12px] font-medium text-[#9aa0a8]">{format(new Date(inc.date || inc.created_at), 'dd MMM yyyy')}</span>
                </div>
                {inc.status === 'resolved' && inc.resolved_notes && (
                  <div className="mt-[7px] flex items-start gap-1.5 text-[12.5px] leading-[1.45] text-[#1f7a52]">
                    <Check className="mt-0.5 h-[13px] w-[13px] shrink-0" strokeWidth={2} />
                    <span className="text-[#5c7568]" style={{ textWrap: 'pretty' } as any}>{inc.resolved_notes}</span>
                  </div>
                )}
              </div>
              {/* reporter */}
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#5b6472] text-[10px] font-bold text-white">
                  {initials(inc.reporter?.full_name, inc.reporter?.email)}
                </div>
                <span className="truncate text-[13px] text-[#41464d]">{inc.reporter?.full_name || inc.reporter?.email || 'Unknown'}</span>
              </div>
              {/* status */}
              <div>
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-[11px] py-[5px] text-[12.5px] font-semibold',
                  isOpen ? 'bg-[#fbf1e1] text-[#b07d1e]' : 'bg-[#eaf4ee] text-[#1f7a52]')}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: isOpen ? '#d98a1a' : '#1f9d63' }} />
                  {isOpen ? 'Open' : 'Resolved'}
                </span>
              </div>
              {/* actions */}
              <div className="flex justify-end gap-[3px] opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {isOpen ? (
                  <button onClick={() => { setResolveNote(''); setResolveId(inc.id) }} title="Mark resolved"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#bfe0cd] bg-[#eaf4ee] px-[11px] py-1.5 text-[12.5px] font-semibold text-[#1a6e49] transition-colors hover:bg-[#dcefe4]">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.4} /> Resolve
                  </button>
                ) : (
                  <button onClick={() => reopenMutation.mutate(inc.id)} title="Reopen"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[#9aa0a8] transition-colors hover:bg-[#f1f2f4] hover:text-[#1c1f24]">
                    <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                )}
                {isManager && (
                  <>
                    <button onClick={() => openEdit(inc)} title="Edit"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[#9aa0a8] transition-colors hover:bg-[#f1f2f4] hover:text-[#1c1f24]">
                      <Pencil className="h-[15px] w-[15px]" strokeWidth={1.7} />
                    </button>
                    <button onClick={() => { if (confirm('Delete this incident?')) deleteMutation.mutate(inc.id) }} title="Delete"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[#cf9a9a] transition-colors hover:bg-warn-tint hover:text-warn">
                      <Trash2 className="h-[15px] w-[15px]" strokeWidth={1.7} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ===== Report / Edit slide-over ===== */}
      {formOpen && (
        <div onClick={() => setFormOpen(false)} className="fixed inset-0 z-50 flex justify-end bg-[rgba(20,22,27,.36)]">
          <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); saveMutation.mutate() }}
            className="flex h-full w-[460px] max-w-[92vw] flex-col bg-card shadow-[-24px_0_64px_-32px_rgba(16,24,40,.4)]">
            <div className="flex items-center justify-between border-b border-[#eef0f2] px-6 py-5">
              <div>
                <h2 className="text-[18px] font-bold text-foreground">{editingId ? 'Edit incident' : 'Report an incident'}</h2>
                <p className="mt-0.5 text-[13px] text-[#8a9099]">{editingId ? 'Update the details below.' : 'Log a complaint or incident for the record.'}</p>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-[#f1f2f4] text-[#5c626b] transition-colors hover:bg-[#e7e9ec]">
                <X className="h-[17px] w-[17px]" strokeWidth={2} />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-[22px]">
              <div>
                <label className="mb-2 block text-[13px] font-semibold text-[#41464d]">Type</label>
                <div className="flex gap-2">
                  {[{ v: 'incident', l: 'Incident' }, { v: 'complaint', l: 'Complaint' }].map((o) => (
                    <button key={o.v} type="button" onClick={() => setFType(o.v)} className={cn(
                      'flex-1 rounded-[10px] py-2.5 text-[13.5px] font-semibold transition-colors',
                      fType === o.v ? 'border-[1.5px] border-brand bg-[#f5faf7] text-[#1a6e49]' : 'border border-input bg-card text-[#5c626b] hover:border-[#cdd1d6]',
                    )}>{o.l}</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-[13px] font-semibold text-[#41464d]">Description <span className="text-warn">*</span></label>
                <textarea required value={fDesc} onChange={(e) => setFDesc(e.target.value)} rows={4}
                  placeholder="What happened? Include location, equipment, and any readings."
                  className="h-24 w-full resize-none rounded-[10px] border border-input bg-card px-[13px] py-[11px] text-[14px] leading-[1.55] text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-brand focus:ring-[3px] focus:ring-[rgba(31,157,99,.12)]" />
              </div>

              <div>
                <label className="mb-2 block text-[13px] font-semibold text-[#41464d]">Date</label>
                <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)}
                  className="w-full rounded-[10px] border border-input bg-card px-[13px] py-[11px] text-[14px] text-foreground outline-none transition-shadow focus:border-brand focus:ring-[3px] focus:ring-[rgba(31,157,99,.12)]" />
              </div>

              <div>
                <label className="mb-2 block text-[13px] font-semibold text-[#41464d]">Action taken</label>
                <textarea value={fAction} onChange={(e) => setFAction(e.target.value)} rows={3}
                  placeholder="What was done immediately?"
                  className="h-[74px] w-full resize-none rounded-[10px] border border-input bg-card px-[13px] py-[11px] text-[14px] leading-[1.55] text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-brand focus:ring-[3px] focus:ring-[rgba(31,157,99,.12)]" />
              </div>

              <div>
                <label className="mb-2 block text-[13px] font-semibold text-[#41464d]">Follow up</label>
                <textarea value={fFollow} onChange={(e) => setFFollow(e.target.value)} rows={3}
                  placeholder="Any follow-up actions needed?"
                  className="h-[74px] w-full resize-none rounded-[10px] border border-input bg-card px-[13px] py-[11px] text-[14px] leading-[1.55] text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-brand focus:ring-[3px] focus:ring-[rgba(31,157,99,.12)]" />
              </div>
            </div>

            <div className="flex gap-2.5 border-t border-[#eef0f2] px-6 py-4">
              <button type="button" onClick={() => setFormOpen(false)} className="flex-1 rounded-[11px] border border-input bg-card py-[11px] text-[14px] font-semibold text-[#5c626b] transition-colors hover:bg-[#f4f5f6]">Cancel</button>
              <button type="submit" disabled={saveMutation.isPending || !fDesc.trim()} className="flex-1 rounded-[11px] bg-brand py-[11px] text-[14px] font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,.1)] transition-opacity hover:opacity-90 disabled:opacity-50">
                {saveMutation.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Report incident'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Resolve dialog ===== */}
      {resolveId && (
        <div onClick={() => { setResolveId(null); setResolveNote('') }} className="fixed inset-0 z-[51] flex items-center justify-center bg-[rgba(20,22,27,.36)] p-6">
          <div onClick={(e) => e.stopPropagation()} className="w-[440px] max-w-full overflow-hidden rounded-2xl bg-card shadow-[0_30px_64px_-28px_rgba(16,24,40,.45)]">
            <div className="px-[22px] pb-4 pt-5">
              <div className="flex items-center gap-[11px]">
                <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[#eaf4ee] text-[#1f7a52]">
                  <CircleCheck className="h-5 w-5" strokeWidth={1.9} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[16.5px] font-bold text-foreground">Resolve incident</h2>
                  <p className="mt-0.5 truncate text-[12.5px] text-[#8a9099]">{resolveTarget?.description}</p>
                </div>
              </div>
              <label className="mb-2 mt-[18px] block text-[13px] font-semibold text-[#41464d]">Resolution note <span className="text-warn">*</span></label>
              <textarea value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} rows={4} autoFocus
                placeholder="Describe the corrective action taken — e.g. engineer called, unit back to 4°C, stock discarded."
                className="h-[104px] w-full resize-none rounded-[11px] border border-input bg-card px-[13px] py-3 text-[14px] leading-[1.55] text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-brand focus:ring-[3px] focus:ring-[rgba(31,157,99,.12)]" />
              <p className="mt-2 text-[12px] text-[#9aa0a8]">A note is required — it&apos;s saved to the audit log with your name and time.</p>
            </div>
            <div className="flex gap-2.5 border-t border-[#eef0f2] bg-[#fbfbfc] px-[22px] py-3.5">
              <button onClick={() => { setResolveId(null); setResolveNote('') }} className="flex-1 rounded-[11px] border border-input bg-card py-2.5 text-[14px] font-semibold text-[#5c626b] transition-colors hover:bg-[#f4f5f6]">Cancel</button>
              <button onClick={() => resolveMutation.mutate()} disabled={!resolveNote.trim() || resolveMutation.isPending}
                className={cn('inline-flex flex-[1.4] items-center justify-center gap-1.5 rounded-[11px] py-2.5 text-[14px] font-semibold transition-colors',
                  resolveNote.trim() ? 'bg-brand text-white shadow-[0_1px_2px_rgba(16,24,40,.1)] hover:opacity-90' : 'cursor-not-allowed bg-[#cfe6da] text-[#8fb9a4]')}>
                <Check className="h-[15px] w-[15px]" strokeWidth={2.4} /> Mark resolved
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, unit, dot }: { label: string; value: number | string; unit?: string; dot?: string }) {
  return (
    <div className="rounded-[14px] border border-border bg-card px-[18px] py-4">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#9aa0a8]">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        {dot && <span className="h-[7px] w-[7px] self-center rounded-full" style={{ background: dot }} />}
        <span className="text-[26px] font-bold leading-none tabular-nums text-[#1c1f24]">{value}</span>
        {unit && <span className="text-[13px] font-semibold text-[#9aa0a8]">{unit}</span>}
      </div>
    </div>
  )
}
