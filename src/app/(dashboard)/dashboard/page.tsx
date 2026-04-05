'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { MOOD_EMOJIS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  ClipboardCheck,
  AlertCircle,
  Bell,
  Users,
  Clock,
  LogIn,
  LogOut,
  ChevronRight,
  Star,
} from 'lucide-react'
import { formatDistanceToNow, format, startOfDay, endOfDay } from 'date-fns'
import Link from 'next/link'
import { toast } from 'sonner'
import { useState } from 'react'

export default function DashboardPage() {
  const { profile, business } = useAuthStore()
  const queryClient = useQueryClient()
  const [selectedMood, setSelectedMood] = useState<string | null>(null)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const today = new Date()
  const todayStart = startOfDay(today).toISOString()
  const todayEnd = endOfDay(today).toISOString()

  // Fetch today's checklist templates and completions
  const { data: templates } = useQuery({
    queryKey: ['checklist-templates', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('checklist_templates')
        .select('*, checklist_template_items(*)')
        .eq('business_id', business!.id)
        .eq('active', true)
        .order('name')
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const { data: completions } = useQuery({
    queryKey: ['checklist-completions-today', business?.id],
    queryFn: async () => {
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

  // My tasks
  const myTasks = templates
    ?.filter((t) => t.assigned_roles.includes(profile?.role ?? ''))
    .map((t) => {
      const completion = completions?.find((c) => c.template_id === t.id)
      return { ...t, completion, isCompleted: !!completion }
    })

  const completedCount = myTasks?.filter((t) => t.isCompleted).length ?? 0
  const totalCount = myTasks?.length ?? 0

  // Open incidents
  const { data: incidents } = useQuery({
    queryKey: ['incidents-open', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('incidents')
        .select('*, profiles!incidents_reported_by_fkey(full_name)')
        .eq('business_id', business!.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(5)
      return data ?? []
    },
    enabled: !!business?.id,
  })

  // Recent notifications
  const { data: notifications } = useQuery({
    queryKey: ['notifications-recent', profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile!.id)
        .order('created_at', { ascending: false })
        .limit(5)
      return data ?? []
    },
    enabled: !!profile?.id,
  })

  // Check-in status
  const { data: myCheckin } = useQuery({
    queryKey: ['my-checkin', profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('staff_checkins')
        .select('*')
        .eq('user_id', profile!.id)
        .eq('date', format(today, 'yyyy-MM-dd'))
        .is('checked_out_at', null)
        .maybeSingle()
      return data
    },
    enabled: !!profile?.id,
  })

  const { data: onSiteStaff } = useQuery({
    queryKey: ['on-site-staff', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('staff_checkins')
        .select('*, profiles!staff_checkins_user_id_fkey(full_name, role, avatar_url)')
        .eq('business_id', business!.id)
        .eq('date', format(today, 'yyyy-MM-dd'))
        .is('checked_out_at', null)
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const checkInMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('staff_checkins').insert({
        user_id: profile!.id,
        business_id: business!.id,
        mood: selectedMood,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-checkin'] })
      queryClient.invalidateQueries({ queryKey: ['on-site-staff'] })
      toast.success('Checked in')
    },
  })

  const checkOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('staff_checkins')
        .update({ checked_out_at: new Date().toISOString() })
        .eq('id', myCheckin!.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-checkin'] })
      queryClient.invalidateQueries({ queryKey: ['on-site-staff'] })
      toast.success('Checked out')
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good ${today.getHours() < 12 ? 'morning' : today.getHours() < 18 ? 'afternoon' : 'evening'}, ${profile?.full_name?.split(' ')[0] ?? 'there'}`}
        description={format(today, 'EEEE, d MMMM yyyy')}
      />

      {/* Metrics row */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          icon={ClipboardCheck}
          label="Tasks completed"
          value={`${completedCount}/${totalCount}`}
          trend={totalCount > 0 ? `${Math.round((completedCount / totalCount) * 100)}%` : '—'}
          trendColor={completedCount === totalCount && totalCount > 0 ? 'text-emerald-600' : 'text-amber-600'}
        />
        <MetricCard
          icon={AlertCircle}
          label="Open incidents"
          value={String(incidents?.length ?? 0)}
          trend={incidents?.length ? 'Needs attention' : 'All clear'}
          trendColor={incidents?.length ? 'text-red-600' : 'text-emerald-600'}
        />
        <MetricCard
          icon={Users}
          label="On site now"
          value={String(onSiteStaff?.length ?? 0)}
          trend="staff members"
          trendColor="text-muted-foreground"
        />
        <MetricCard
          icon={Star}
          label="FSA Rating"
          value={business?.fsa_rating ?? '—'}
          trend={business?.fsa_rating ? 'Current rating' : 'Not set'}
          trendColor="text-muted-foreground"
        />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left column — Check-in + My Tasks */}
        <div className="col-span-2 space-y-6">
          {/* Check-in card */}
          <div className="rounded-lg border border-border bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-[13px] font-medium">Check-in</h3>
              </div>
              {myCheckin ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => checkOutMutation.mutate()}
                  disabled={checkOutMutation.isPending}
                  className="text-[12px]"
                >
                  <LogOut className="mr-1.5 h-3.5 w-3.5" />
                  Check out
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {MOOD_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => setSelectedMood(selectedMood === emoji ? null : emoji)}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors',
                          selectedMood === emoji
                            ? 'bg-emerald-100 ring-1 ring-emerald-300'
                            : 'hover:bg-accent'
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => checkInMutation.mutate()}
                    disabled={checkInMutation.isPending}
                    className="bg-emerald-600 text-[12px] hover:bg-emerald-700"
                  >
                    <LogIn className="mr-1.5 h-3.5 w-3.5" />
                    Check in
                  </Button>
                </div>
              )}
            </div>
            {myCheckin && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Checked in {formatDistanceToNow(new Date(myCheckin.checked_in_at), { addSuffix: true })}
                {myCheckin.mood && ` — ${myCheckin.mood}`}
              </p>
            )}
          </div>

          {/* My Tasks */}
          <div className="rounded-lg border border-border bg-white">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-[13px] font-medium">My Tasks Today</h3>
              <Link
                href="/checklists"
                className="text-[12px] text-emerald-600 hover:text-emerald-700"
              >
                View all
              </Link>
            </div>
            <div className="divide-y divide-border">
              {myTasks?.length === 0 && (
                <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                  No tasks assigned to your role today
                </div>
              )}
              {myTasks?.map((task) => (
                <Link
                  key={task.id}
                  href={`/checklists/${task.id}`}
                  className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-accent/50"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-md',
                        task.isCompleted
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-gray-50 text-gray-400'
                      )}
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-[13px] font-medium">{task.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {task.frequency} &middot;{' '}
                        {(task.checklist_template_items as unknown[])?.length ?? 0} items
                        {task.deadline_time && ` &middot; Due by ${task.deadline_time}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {task.isCompleted ? (
                      <StatusBadge status="success" label="Done" />
                    ) : (
                      <StatusBadge status="warning" label="Pending" />
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Team Tasks (manager) */}
          {isManager && (
            <div className="rounded-lg border border-border bg-white">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-[13px] font-medium">On-site Staff</h3>
                <Link
                  href="/team"
                  className="text-[12px] text-emerald-600 hover:text-emerald-700"
                >
                  View team
                </Link>
              </div>
              <div className="divide-y divide-border">
                {onSiteStaff?.length === 0 && (
                  <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                    No staff on site right now
                  </div>
                )}
                {onSiteStaff?.map((checkin) => {
                  const p = checkin.profiles as { full_name: string | null; role: string | null } | null
                  return (
                    <div key={checkin.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-medium text-emerald-700">
                          {p?.full_name?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium">{p?.full_name ?? 'Unknown'}</p>
                          <p className="text-[11px] text-muted-foreground capitalize">
                            {p?.role?.replace('_', ' ')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {checkin.mood && <span className="text-sm">{checkin.mood}</span>}
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {formatDistanceToNow(new Date(checkin.checked_in_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right column — Incidents + Notifications */}
        <div className="space-y-6">
          {/* Open Incidents */}
          <div className="rounded-lg border border-border bg-white">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                <h3 className="text-[13px] font-medium">Open Incidents</h3>
              </div>
              <Link
                href="/incidents"
                className="text-[12px] text-emerald-600 hover:text-emerald-700"
              >
                View all
              </Link>
            </div>
            <div className="divide-y divide-border">
              {incidents?.length === 0 && (
                <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                  No open incidents
                </div>
              )}
              {incidents?.map((incident) => (
                <div key={incident.id} className="px-4 py-3">
                  <div className="flex items-start justify-between">
                    <p className="text-[13px] font-medium leading-snug">
                      {incident.description.length > 60
                        ? incident.description.slice(0, 60) + '...'
                        : incident.description}
                    </p>
                    <StatusBadge
                      status={incident.type === 'complaint' ? 'warning' : 'error'}
                      label={incident.type}
                      className="ml-2 shrink-0"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(incident.created_at), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Notifications */}
          <div className="rounded-lg border border-border bg-white">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-[13px] font-medium">Notifications</h3>
              </div>
              <Link
                href="/notifications"
                className="text-[12px] text-emerald-600 hover:text-emerald-700"
              >
                View all
              </Link>
            </div>
            <div className="divide-y divide-border">
              {notifications?.length === 0 && (
                <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                  No new notifications
                </div>
              )}
              {notifications?.map((notif) => (
                <div
                  key={notif.id}
                  className={cn(
                    'px-4 py-3',
                    !notif.read && 'bg-blue-50/50'
                  )}
                >
                  <p className="text-[13px] font-medium leading-snug">
                    {notif.title}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground line-clamp-2">
                    {notif.message}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  trend,
  trendColor,
}: {
  icon: React.ElementType
  label: string
  value: string
  trend: string
  trendColor: string
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-[12px] text-muted-foreground">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className={cn('mt-0.5 text-[11px] font-medium', trendColor)}>{trend}</p>
    </div>
  )
}
