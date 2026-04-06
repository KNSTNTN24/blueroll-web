'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  Bell, ClipboardCheck, AlertTriangle, Users, LogIn,
  FileText, Shield, CheckCheck,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import type { LucideIcon } from 'lucide-react'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  link: string | null
  is_read: boolean
  created_at: string
}

const typeIcons: Record<string, LucideIcon> = {
  checklist: ClipboardCheck,
  incident: AlertTriangle,
  team: Users,
  checkin: LogIn,
  document: FileText,
  haccp: Shield,
}

export default function NotificationsPage() {
  const profile = useAuthStore((s) => s.profile)
  const queryClient = useQueryClient()

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return []
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as Notification[]
    },
    enabled: !!profile?.id,
  })

  const markReadMutation = useMutation({
    mutationFn: async (notifId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notifId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) return
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', profile.id)
        .eq('is_read', false)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      toast.success('All notifications marked as read')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleClick(notif: Notification) {
    if (!notif.is_read) {
      markReadMutation.mutate(notif.id)
    }
    if (notif.link) {
      window.location.href = notif.link
    }
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Notifications" description="Stay updated on your team's activity" />
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" description="Stay updated on your team's activity">
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all as read
          </Button>
        )}
      </PageHeader>

      {notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications"
          description="You're all caught up. Notifications will appear here."
        />
      ) : (
        <div className="rounded-lg border border-border bg-white divide-y divide-border">
          {notifications.map((notif) => {
            const Icon = typeIcons[notif.type] ?? Bell
            return (
              <button
                key={notif.id}
                onClick={() => handleClick(notif)}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50',
                  !notif.is_read && 'bg-emerald-50/30'
                )}
              >
                <div className={cn(
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                  !notif.is_read
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-border bg-gray-50'
                )}>
                  <Icon className={cn('h-3.5 w-3.5', !notif.is_read ? 'text-emerald-600' : 'text-muted-foreground')} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[13px]', !notif.is_read ? 'font-medium text-foreground' : 'text-foreground')}>
                      {notif.title}
                    </span>
                    {!notif.is_read && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted-foreground line-clamp-2">{notif.message}</p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
