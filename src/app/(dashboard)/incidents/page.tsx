'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

type IncidentWithProfiles = {
  id: string
  type: string
  description: string
  action_taken: string | null
  follow_up: string | null
  reported_by: string
  date: string
  business_id: string
  created_at: string
  status: string
  resolved_by: string | null
  resolved_at: string | null
  resolved_notes: string | null
  updated_at: string | null
  reporter: { full_name: string | null } | null
  resolver: { full_name: string | null } | null
}

export default function IncidentsPage() {
  const { profile, business } = useAuthStore()
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [tab, setTab] = useState('all')
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [showResolveDialog, setShowResolveDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [selectedIncident, setSelectedIncident] = useState<IncidentWithProfiles | null>(null)

  const [newType, setNewType] = useState('incident')
  const [newDescription, setNewDescription] = useState('')
  const [newActionTaken, setNewActionTaken] = useState('')
  const [newDate, setNewDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [resolveNotes, setResolveNotes] = useState('')

  const { data: incidents, isLoading } = useQuery({
    queryKey: ['incidents', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('incidents')
        .select('*, reporter:profiles!incidents_reported_by_fkey(full_name), resolver:profiles!incidents_resolved_by_fkey(full_name)')
        .eq('business_id', business!.id)
        .order('date', { ascending: false })
      return (data ?? []) as unknown as IncidentWithProfiles[]
    },
    enabled: !!business?.id,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('incidents').insert({
        type: newType,
        description: newDescription,
        action_taken: newActionTaken || null,
        date: newDate,
        reported_by: profile!.id,
        business_id: business!.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident reported')
      setShowNewDialog(false)
      resetForm()
    },
    onError: (err) => toast.error(err.message),
  })

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('incidents')
        .update({
          status: 'resolved',
          resolved_by: profile!.id,
          resolved_at: new Date().toISOString(),
          resolved_notes: resolveNotes || null,
        })
        .eq('id', selectedIncident!.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident resolved')
      setShowResolveDialog(false)
      setSelectedIncident(null)
      setResolveNotes('')
    },
    onError: (err) => toast.error(err.message),
  })

  const editMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('incidents')
        .update({
          type: newType,
          description: newDescription,
          action_taken: newActionTaken || null,
        })
        .eq('id', selectedIncident!.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident updated')
      setShowEditDialog(false)
      setSelectedIncident(null)
      resetForm()
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('incidents').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident deleted')
    },
    onError: (err) => toast.error(err.message),
  })

  const resetForm = () => {
    setNewType('incident')
    setNewDescription('')
    setNewActionTaken('')
    setNewDate(format(new Date(), 'yyyy-MM-dd'))
  }

  const openEdit = (incident: IncidentWithProfiles) => {
    setSelectedIncident(incident)
    setNewType(incident.type)
    setNewDescription(incident.description)
    setNewActionTaken(incident.action_taken ?? '')
    setShowEditDialog(true)
  }

  const filtered = incidents?.filter((i) => {
    if (tab === 'open') return i.status === 'open'
    if (tab === 'resolved') return i.status === 'resolved'
    return true
  }) ?? []

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
        title="Incidents & Complaints"
        description="Track food safety incidents and customer complaints"
      >
        <Button
          onClick={() => { resetForm(); setShowNewDialog(true) }}
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New Incident
        </Button>
      </PageHeader>

      <Tabs value={tab} onValueChange={(v) => setTab(v ?? "")}>
        <TabsList>
          <TabsTrigger value="all">All ({incidents?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="open">Open ({incidents?.filter((i) => i.status === 'open').length ?? 0})</TabsTrigger>
          <TabsTrigger value="resolved">Resolved ({incidents?.filter((i) => i.status === 'resolved').length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {filtered.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="No incidents"
              description={tab === 'all' ? 'No incidents or complaints have been reported.' : `No ${tab} incidents found.`}
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
                  {filtered.map((incident) => (
                    <tr key={incident.id} className="transition-colors hover:bg-accent/50">
                      <td className="px-4 py-3 text-[13px] tabular-nums text-muted-foreground">
                        {format(new Date(incident.date), 'dd MMM yyyy')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
                          incident.type === 'complaint'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-red-50 text-red-700'
                        )}>
                          {incident.type}
                        </span>
                      </td>
                      <td className="max-w-xs px-4 py-3 text-[13px] truncate">
                        {incident.description}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-muted-foreground">
                        {incident.reporter?.full_name ?? 'Unknown'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={incident.status === 'resolved' ? 'success' : 'error'}
                          label={incident.status === 'resolved' ? 'Resolved' : 'Open'}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger>
                              <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {incident.status === 'open' && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedIncident(incident)
                                    setResolveNotes('')
                                    setShowResolveDialog(true)
                                  }}
                                >
                                  <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                                  Resolve
                                </DropdownMenuItem>
                              )}
                              {isManager && (
                                <>
                                  <DropdownMenuItem onClick={() => openEdit(incident)}>
                                    <Pencil className="mr-2 h-3.5 w-3.5" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-red-600"
                                    onClick={() => deleteMutation.mutate(incident.id)}
                                  >
                                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                                    Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Incident Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Incident</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v ?? "")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incident">Incident</SelectItem>
                  <SelectItem value="complaint">Complaint</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Date</Label>
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Description</Label>
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Describe the incident..."
                className="min-h-[80px] text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Action Taken</Label>
              <Textarea
                value={newActionTaken}
                onChange={(e) => setNewActionTaken(e.target.value)}
                placeholder="What action was taken? (optional)"
                className="min-h-[60px] text-[13px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowNewDialog(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!newDescription.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Incident</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-[13px] text-muted-foreground">
              {selectedIncident?.description}
            </p>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Resolution Notes</Label>
              <Textarea
                value={resolveNotes}
                onChange={(e) => setResolveNotes(e.target.value)}
                placeholder="Describe how the incident was resolved..."
                className="min-h-[80px] text-[13px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowResolveDialog(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={resolveMutation.isPending}
              onClick={() => resolveMutation.mutate()}
            >
              {resolveMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Incident</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v ?? "")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incident">Incident</SelectItem>
                  <SelectItem value="complaint">Complaint</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Description</Label>
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="min-h-[80px] text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Action Taken</Label>
              <Textarea
                value={newActionTaken}
                onChange={(e) => setNewActionTaken(e.target.value)}
                className="min-h-[60px] text-[13px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!newDescription.trim() || editMutation.isPending}
              onClick={() => editMutation.mutate()}
            >
              {editMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
