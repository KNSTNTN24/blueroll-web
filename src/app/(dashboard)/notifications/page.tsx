'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Bell,
  BellOff,
  CheckCheck,
  ClipboardCheck,
  AlertTriangle,
  FileText,
  Truck,
  Info,
  Calendar,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import type { LucideIcon } from 'lucide-react'

const NOTIFICATION_ICONS: Record<string, LucideIcon> = {
  checklist: ClipboardCheck,
  incident: AlertTriangle,
  document: FileText,
  delivery: Truck,
  reminder: Calendar,
}

function getIcon(type: string): LucideIcon {
  return NOTIFICATION_ICONS[type] ?? Info
}

export default function NotificationsPage() {
  const { profile } = useAuthStore()
  const queryClient = useQueryClient()

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications', profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile!.id)
        .order('created_at', { ascending: false })
        .limit(50)
      return data ?? []
    },
    enabled: !!profile?.id,
  })

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const unread = notifications?.filter((n) => !n.read).map((n) => n.id) ?? []
      if (unread.length === 0) return
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', unread)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      toast.success('All notifications marked as read')
    },
    onError: (err) => toast.error(err.message),
  })

  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
      >
        {unreadCount > 0 && (
          <Button
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            size="sm"
            variant="outline"
          >
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
            Mark all read
          </Button>
        )}
      </PageHeader>

      {!notifications || notifications.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="No notifications"
          description="You have no notifications yet. You'll be notified about important food safety events."
        />
      ) : (
        <div className="rounded-lg border border-border bg-white divide-y divide-border">
          {notifications.map((notification) => {
            const Icon = getIcon(notification.type)
            return (
              <button
                key={notification.id}
                onClick={() => {
                  if (!notification.read) markReadMutation.mutate(notification.id)
                  if (notification.link) window.location.href = notification.link
                }}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50',
                  !notification.read && 'bg-blue-50/50'
                )}
              >
                <div className={cn(
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                  !notification.read ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                )}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn(
                      'text-[13px]',
                      !notification.read ? 'font-medium' : 'text-muted-foreground'
                    )}>
                      {notification.title}
                    </p>
                    {!notification.read && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                    )}
                  </div>
                  <p className="text-[12px] text-muted-foreground line-clamp-1">
                    {notification.message}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
