'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  CheckSquare, AlertTriangle, Users, Star, Bell, Clock,
  ChevronRight, LogIn, LogOut,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/status-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { MOOD_EMOJIS, CHECKLIST_FREQUENCIES } from '@/lib/constants'
import { notifyCheckIn, notifyCheckOut } from '@/lib/notifications'
import { format, formatDistanceToNow, startOfDay, endOfDay, startOfWeek, startOfMonth } from 'date-fns'

function getInitials(name: string | null, email?: string): string {
  if (name) {
    const parts = name.split(' ').filter(Boolean)
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (parts[0]?.[0] ?? '').toUpperCase()
  }
  return (email?.[0] ?? '?').toUpperCase()
}

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

export default function DashboardPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const [selectedMood, setSelectedMood] = useState<string | null>(null)

  const today = new Date()
  const todayStart = startOfDay(today).toISOString()
  const todayEnd = endOfDay(today).toISOString()

  // ── Active checkin for current user ──
  const { data: activeCheckin } = useQuery({
    queryKey: ['my-checkin', profile?.id],
    queryFn: async () => {
      if (!profile?.id || !business?.id) return null
      const { data } = await supabase
        .from('staff_checkins')
        .select('*')
        .eq('user_id', profile.id)
        .eq('business_id', business.id)
        .gte('checked_in_at', todayStart)
        .is('checked_out_at', null)
        .order('checked_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data
    },
    enabled: !!profile?.id && !!business?.id,
  })

  // ── My Tasks: active templates for user role ──
  const { data: myTemplates = [] } = useQuery({
    queryKey: ['my-templates', business?.id, profile?.role],
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

  // ── Completions for current periods ──
  const { data: completions = [] } = useQuery({
    queryKey: ['my-completions', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('checklist_completions')
        .select('template_id, completed_at, signed_off_by')
        .eq('business_id', business.id)
        .gte('completed_at', todayStart)
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  // ── Open incidents ──
  const { data: openIncidents = [] } = useQuery({
    queryKey: ['open-incidents', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('incidents')
        .select('*')
        .eq('business_id', business.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  // ── On-site staff ──
  const { data: onSiteStaff = [] } = useQuery({
    queryKey: ['on-site-staff', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('staff_checkins')
        .select('*, profile:profiles(full_name, email, avatar_url)')
        .eq('business_id', business.id)
        .gte('checked_in_at', todayStart)
        .is('checked_out_at', null)
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  // ── Notifications ──
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return []
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return data ?? []
    },
    enabled: !!profile?.id,
  })

  // ── Metrics ──
  function getTemplateStatus(template: any): string {
    const periodStart = getPeriodStart(template.frequency)
    const completion = completions.find(
      (c: any) => c.template_id === template.id && new Date(c.completed_at) >= periodStart
    )
    if (!completion) return 'Pending'
    if (completion.signed_off_by) return 'Signed Off'
    if (template.supervisor_role) return 'Awaiting Sign-off'
    return 'Completed'
  }

  const totalTasks = myTemplates.length
  const completedTasks = myTemplates.filter(
    (t: any) => getTemplateStatus(t) !== 'Pending'
  ).length

  // ── Check-in mutation ──
  const checkInMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id || !business?.id || !selectedMood) throw new Error('Missing data')
      const { error } = await supabase.from('staff_checkins').insert({
        user_id: profile.id,
        business_id: business.id,
        mood: selectedMood,
        checked_in_at: new Date().toISOString(),
      })
      if (error) throw error
      await notifyCheckIn(business.id, profile.full_name ?? profile.email)
    },
    onSuccess: () => {
      toast.success('Checked in')
      setSelectedMood(null)
      queryClient.invalidateQueries({ queryKey: ['my-checkin'] })
      queryClient.invalidateQueries({ queryKey: ['on-site-staff'] })
    },
    onError: () => toast.error('Failed to check in'),
  })

  const checkOutMutation = useMutation({
    mutationFn: async () => {
      if (!activeCheckin?.id || !business?.id || !profile) throw new Error('No active check-in')
      const { error } = await supabase
        .from('staff_checkins')
        .update({ checked_out_at: new Date().toISOString() })
        .eq('id', activeCheckin.id)
      if (error) throw error
      await notifyCheckOut(business.id, profile.full_name ?? profile.email)
    },
    onSuccess: () => {
      toast.success('Checked out')
      queryClient.invalidateQueries({ queryKey: ['my-checkin'] })
      queryClient.invalidateQueries({ queryKey: ['on-site-staff'] })
    },
    onError: () => toast.error('Failed to check out'),
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Your daily overview" />

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={CheckSquare}
          label="Tasks Completed"
          value={`${completedTasks}/${totalTasks}`}
          sub={totalTasks > 0 ? `${Math.round((completedTasks / totalTasks) * 100)}%` : '0%'}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Open Incidents"
          value={String(openIncidents.length)}
          sub={openIncidents.length === 0 ? 'All clear' : 'Needs attention'}
          variant={openIncidents.length > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          icon={Users}
          label="On-site Staff"
          value={String(onSiteStaff.length)}
          sub="Currently checked in"
        />
        <MetricCard
          icon={Star}
          label="FSA Rating"
          value={business?.fsa_rating ?? '--'}
          sub="Current rating"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Check-in card */}
        <div className="rounded-lg border border-border bg-white p-4">
          <h3 className="text-[13px] font-medium text-foreground mb-3">Check-in</h3>
          {activeCheckin ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Checked in at {format(new Date(activeCheckin.checked_in_at), 'HH:mm')}
                {activeCheckin.mood && <span className="text-lg">{activeCheckin.mood}</span>}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => checkOutMutation.mutate()}
                disabled={checkOutMutation.isPending}
                className="gap-1.5"
              >
                <LogOut className="h-3.5 w-3.5" />
                {checkOutMutation.isPending ? 'Checking out...' : 'Check out'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {MOOD_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setSelectedMood(emoji)}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-lg text-xl transition-colors',
                      selectedMood === emoji
                        ? 'bg-emerald-100 ring-2 ring-emerald-500'
                        : 'hover:bg-gray-100',
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                onClick={() => checkInMutation.mutate()}
                disabled={!selectedMood || checkInMutation.isPending}
                className="gap-1.5"
              >
                <LogIn className="h-3.5 w-3.5" />
                {checkInMutation.isPending ? 'Checking in...' : 'Check in'}
              </Button>
            </div>
          )}
        </div>

        {/* My Tasks */}
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium text-foreground">My Tasks</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[12px]"
              onClick={() => router.push('/checklists')}
            >
              View all <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
          {myTemplates.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-muted-foreground">
              No tasks assigned to your role
            </p>
          ) : (
            <div className="space-y-1">
              {myTemplates.map((t: any) => {
                const status = getTemplateStatus(t)
                const statusMap: Record<string, 'success' | 'warning' | 'info' | 'neutral'> = {
                  Completed: 'success',
                  'Signed Off': 'success',
                  'Awaiting Sign-off': 'warning',
                  Pending: 'neutral',
                }
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => router.push(`/checklists/${t.id}`)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left hover:bg-accent/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">{t.name}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {t.frequency} &middot; {t.checklist_template_items?.length ?? 0} items
                        {t.deadline_time && ` &middot; by ${t.deadline_time}`}
                      </p>
                    </div>
                    <StatusBadge
                      status={statusMap[status] ?? 'neutral'}
                      label={status}
                    />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* On-site Staff (managers only) */}
        {isManager && (
          <div className="rounded-lg border border-border bg-white p-4">
            <h3 className="text-[13px] font-medium text-foreground mb-3">On-site Staff</h3>
            {onSiteStaff.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-muted-foreground">
                No staff currently on-site
              </p>
            ) : (
              <div className="space-y-2">
                {onSiteStaff.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-md px-2 py-1.5">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[10px]">
                        {getInitials(s.profile?.full_name, s.profile?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {s.profile?.full_name ?? 'Unnamed'}
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        Since {format(new Date(s.checked_in_at), 'HH:mm')}
                      </p>
                    </div>
                    {s.mood && <span className="text-lg">{s.mood}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Open Incidents */}
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium text-foreground">Open Incidents</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[12px]"
              onClick={() => router.push('/incidents')}
            >
              View all <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
          {openIncidents.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-muted-foreground">
              No open incidents
            </p>
          ) : (
            <div className="space-y-1">
              {openIncidents.map((inc: any) => (
                <div key={inc.id} className="flex items-start gap-3 rounded-md px-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-foreground line-clamp-1">
                      {inc.description}
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      {formatDistanceToNow(new Date(inc.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <StatusBadge
                    status={inc.type === 'complaint' ? 'warning' : 'error'}
                    label={inc.type === 'complaint' ? 'Complaint' : 'Incident'}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="rounded-lg border border-border bg-white p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium text-foreground">Notifications</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[12px]"
              onClick={() => router.push('/notifications')}
            >
              View all <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
          {notifications.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-muted-foreground">
              No notifications
            </p>
          ) : (
            <div className="space-y-1">
              {notifications.map((n: any) => (
                <div
                  key={n.id}
                  className={cn(
                    'flex items-start gap-3 rounded-md px-2 py-2',
                    !n.read_at && 'bg-emerald-50/50',
                  )}
                >
                  <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[13px]', !n.read_at ? 'font-medium text-foreground' : 'text-foreground')}>
                      {n.title}
                    </p>
                    <p className="text-[12px] text-muted-foreground line-clamp-1">{n.message}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  {!n.read_at && (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Metric card ── */
function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  variant = 'default',
}: {
  icon: any
  label: string
  value: string
  sub?: string
  variant?: 'default' | 'warning'
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg',
          variant === 'warning' ? 'bg-amber-50' : 'bg-emerald-50',
        )}>
          <Icon className={cn(
            'h-4 w-4',
            variant === 'warning' ? 'text-amber-600' : 'text-emerald-600',
          )} strokeWidth={1.5} />
        </div>
        <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-[24px] font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="text-[12px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}
