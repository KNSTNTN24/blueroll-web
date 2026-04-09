'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { AlertTriangle, Plus, Pencil, Trash2, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { INCIDENT_TYPES } from '@/lib/constants'
import { notifyNewIncident, notifyIncidentResolved } from '@/lib/notifications'
import { format } from 'date-fns'

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

export default function IncidentsPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [tab, setTab] = useState<Tab>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [showResolve, setShowResolve] = useState<string | null>(null)
  const [showEdit, setShowEdit] = useState<Incident | null>(null)

  // Create form state
  const [cType, setCType] = useState<string>('incident')
  const [cDesc, setCDesc] = useState('')
  const [cAction, setCAction] = useState('')
  const [cFollowUp, setCFollowUp] = useState('')
  const [cDate, setCDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  // Resolve form state
  const [rNotes, setRNotes] = useState('')

  // Edit form state
  const [eType, setEType] = useState<string>('incident')
  const [eDesc, setEDesc] = useState('')
  const [eAction, setEAction] = useState('')
  const [eFollowUp, setEFollowUp] = useState('')

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

  const filtered = incidents.filter((i) => {
    if (tab === 'open') return i.status === 'open'
    if (tab === 'resolved') return i.status === 'resolved'
    return true
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!business?.id || !profile?.id) throw new Error('No business')
      const { error } = await supabase.from('incidents').insert({
        business_id: business.id,
        type: cType,
        description: cDesc,
        action_taken: cAction || null,
        follow_up: cFollowUp || null,
        status: 'open',
        reported_by: profile.id,
        date: cDate,
      })
      if (error) throw error
      await notifyNewIncident(business.id, cDesc.substring(0, 100))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident reported')
      setShowCreate(false)
      setCType('incident')
      setCDesc('')
      setCAction('')
      setCFollowUp('')
      setCDate(format(new Date(), 'yyyy-MM-dd'))
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const resolveMutation = useMutation({
    mutationFn: async (incidentId: string) => {
      if (!profile?.id) throw new Error('No user')
      const incident = incidents.find((i) => i.id === incidentId)
      const { error } = await supabase
        .from('incidents')
        .update({
          status: 'resolved',
          resolved_by: profile.id,
          resolved_at: new Date().toISOString(),
          resolved_notes: rNotes || null,
        })
        .eq('id', incidentId)
      if (error) throw error
      if (incident) {
        await notifyIncidentResolved(incident.reported_by, incident.description.substring(0, 100))
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident resolved')
      setShowResolve(null)
      setRNotes('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const editMutation = useMutation({
    mutationFn: async (incidentId: string) => {
      const { error } = await supabase
        .from('incidents')
        .update({
          type: eType,
          description: eDesc,
          action_taken: eAction || null,
          follow_up: eFollowUp || null,
        })
        .eq('id', incidentId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident updated')
      setShowEdit(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (incidentId: string) => {
      const { error } = await supabase.from('incidents').delete().eq('id', incidentId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function openEdit(incident: Incident) {
    setEType(incident.type)
    setEDesc(incident.description)
    setEAction(incident.action_taken ?? '')
    setEFollowUp(incident.follow_up ?? '')
    setShowEdit(incident)
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'resolved', label: 'Resolved' },
  ]

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Incidents" description="Track complaints and incidents" />
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Incidents" description="Track complaints and incidents">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5" />
          Report incident
        </Button>
      </PageHeader>

      {/* Filter Tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-white p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              tab === t.key
                ? 'bg-emerald-50 text-emerald-700'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Create Dialog */}
      {showCreate && (
        <div className="rounded-lg border border-border bg-white p-4">
          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate() }} className="space-y-4">
            <h3 className="text-[14px] font-medium text-foreground">Report an incident</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-foreground">Type</label>
                <select
                  value={cType}
                  onChange={(e) => setCType(e.target.value ?? '')}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {INCIDENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-foreground">Date</label>
                <input
                  type="date"
                  value={cDate}
                  onChange={(e) => setCDate(e.target.value)}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Description</label>
              <textarea
                required
                value={cDesc}
                onChange={(e) => setCDesc(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Describe what happened..."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Action taken</label>
              <textarea
                value={cAction}
                onChange={(e) => setCAction(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="What actions were taken..."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Follow up</label>
              <textarea
                value={cFollowUp}
                onChange={(e) => setCFollowUp(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Follow up actions needed..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button size="sm" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Submitting...' : 'Submit'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Resolve Dialog */}
      {showResolve && (
        <div className="rounded-lg border border-border bg-white p-4">
          <form onSubmit={(e) => { e.preventDefault(); resolveMutation.mutate(showResolve) }} className="space-y-4">
            <h3 className="text-[14px] font-medium text-foreground">Resolve incident</h3>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Resolution notes</label>
              <textarea
                value={rNotes}
                onChange={(e) => setRNotes(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="How was this resolved..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" type="button" onClick={() => { setShowResolve(null); setRNotes('') }}>Cancel</Button>
              <Button size="sm" type="submit" disabled={resolveMutation.isPending}>
                {resolveMutation.isPending ? 'Resolving...' : 'Resolve'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Dialog */}
      {showEdit && (
        <div className="rounded-lg border border-border bg-white p-4">
          <form onSubmit={(e) => { e.preventDefault(); editMutation.mutate(showEdit.id) }} className="space-y-4">
            <h3 className="text-[14px] font-medium text-foreground">Edit incident</h3>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Type</label>
              <select
                value={eType}
                onChange={(e) => setEType(e.target.value ?? '')}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {INCIDENT_TYPES.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Description</label>
              <textarea
                required
                value={eDesc}
                onChange={(e) => setEDesc(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Action taken</label>
              <textarea
                value={eAction}
                onChange={(e) => setEAction(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Follow up</label>
              <textarea
                value={eFollowUp}
                onChange={(e) => setEFollowUp(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setShowEdit(null)}>Cancel</Button>
              <Button size="sm" type="submit" disabled={editMutation.isPending}>
                {editMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No incidents"
          description={tab === 'all' ? 'No incidents have been reported yet.' : `No ${tab} incidents.`}
        />
      ) : (
        <div className="rounded-lg border border-border bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Date</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Reported by</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((inc) => (
                <tr key={inc.id} className="hover:bg-accent/50">
                  <td className="px-4 py-2.5 text-[13px] tabular-nums text-muted-foreground">
                    {format(new Date(inc.date || inc.created_at), 'dd MMM yyyy')}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                      inc.type === 'complaint'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                    )}>
                      {inc.type.charAt(0).toUpperCase() + inc.type.slice(1)}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-4 py-2.5 text-[13px] text-foreground">
                    {inc.description}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-muted-foreground">
                    {inc.reporter?.full_name || inc.reporter?.email || 'Unknown'}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge
                      status={inc.status === 'open' ? 'warning' : 'success'}
                      label={inc.status.charAt(0).toUpperCase() + inc.status.slice(1)}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {inc.status === 'open' && (
                        <Button variant="ghost" size="icon" onClick={() => { setRNotes(''); setShowResolve(inc.id) }} title="Resolve">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        </Button>
                      )}
                      {isManager && (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(inc)} title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => { if (confirm('Delete this incident?')) deleteMutation.mutate(inc.id) }}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
