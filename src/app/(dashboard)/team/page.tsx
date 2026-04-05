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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { USER_ROLES, ROLE_LABELS, type UserRole } from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  Users,
  UserPlus,
  Mail,
  Copy,
  Check,
  ArrowUpDown,
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Role badge colors
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  manager: 'bg-blue-50 text-blue-700 border-blue-200',
  chef: 'bg-amber-50 text-amber-700 border-amber-200',
  kitchen_staff: 'bg-gray-50 text-gray-600 border-gray-200',
  front_of_house: 'bg-purple-50 text-purple-700 border-purple-200',
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        ROLE_COLORS[role] ?? 'bg-gray-50 text-gray-600 border-gray-200'
      )}
    >
      {ROLE_LABELS[role as UserRole] ?? role.replace('_', ' ')}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortField = 'name' | 'role' | 'joined'
type SortDir = 'asc' | 'desc'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TeamPage() {
  const { profile, business } = useAuthStore()
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const today = format(new Date(), 'yyyy-MM-dd')

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('kitchen_staff')
  const [inviteResult, setInviteResult] = useState<{ token: string; link: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Fetch team members
  const { data: members, isLoading } = useQuery({
    queryKey: ['team-members', business?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('business_id', business!.id)
        .order('full_name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  // Fetch today's check-ins
  const { data: checkins } = useQuery({
    queryKey: ['team-checkins-today', business?.id, today],
    queryFn: async () => {
      const { data } = await supabase
        .from('staff_checkins')
        .select('*')
        .eq('business_id', business!.id)
        .eq('date', today)
        .is('checked_out_at', null)
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const checkinMap = new Map(
    (checkins ?? []).map((c) => [c.user_id, c])
  )

  // Sorted members
  const sorted = [...(members ?? [])].sort((a, b) => {
    let cmp = 0
    if (sortField === 'name') {
      cmp = (a.full_name ?? '').localeCompare(b.full_name ?? '')
    } else if (sortField === 'role') {
      cmp = a.role.localeCompare(b.role)
    } else {
      cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  // Invite mutation
  const inviteMutation = useMutation({
    mutationFn: async () => {
      const token = generateToken()
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 7)

      const { error } = await supabase.from('invites').insert({
        email: inviteEmail,
        role: inviteRole,
        business_id: business!.id,
        invited_by: profile!.id,
        token,
        expires_at: expiresAt.toISOString(),
      })
      if (error) throw error
      return { token }
    },
    onSuccess: (data) => {
      const link = `${window.location.origin}/onboarding`
      setInviteResult({ token: data.token, link })
      queryClient.invalidateQueries({ queryKey: ['team-members'] })
      toast.success('Invite created')
    },
    onError: () => {
      toast.error('Failed to create invite')
    },
  })

  function generateToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  function handleInvite() {
    if (!inviteEmail.trim()) {
      toast.error('Please enter an email address')
      return
    }
    inviteMutation.mutate()
  }

  function copyInviteLink() {
    if (inviteResult) {
      navigator.clipboard.writeText(inviteResult.link)
      setCopied(true)
      toast.success('Invite link copied')
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function resetInvite() {
    setInviteEmail('')
    setInviteRole('kitchen_staff')
    setInviteResult(null)
    setCopied(false)
  }

  function getInitials(name: string | null): string {
    if (!name) return '?'
    return name
      .split(' ')
      .map((p) => p[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description={`${members?.length ?? 0} team member${(members?.length ?? 0) !== 1 ? 's' : ''}`}
      >
        {isManager && (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => {
              resetInvite()
              setInviteOpen(true)
            }}
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            Invite
          </Button>
        )}
      </PageHeader>

      {members?.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No team members"
          description="Invite your team to start collaborating on food safety."
          action={
            isManager
              ? {
                  label: 'Invite team member',
                  onClick: () => {
                    resetInvite()
                    setInviteOpen(true)
                  },
                }
              : undefined
          }
        />
      ) : (
        <div className="rounded-lg border border-border bg-white">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th
                  className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                  onClick={() => toggleSort('name')}
                >
                  <span className="inline-flex items-center gap-1">
                    Name
                    <ArrowUpDown className="h-3 w-3" />
                  </span>
                </th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                  Email
                </th>
                <th
                  className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                  onClick={() => toggleSort('role')}
                >
                  <span className="inline-flex items-center gap-1">
                    Role
                    <ArrowUpDown className="h-3 w-3" />
                  </span>
                </th>
                <th
                  className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                  onClick={() => toggleSort('joined')}
                >
                  <span className="inline-flex items-center gap-1">
                    Joined
                    <ArrowUpDown className="h-3 w-3" />
                  </span>
                </th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((member) => {
                const checkin = checkinMap.get(member.id)
                const isOnSite = !!checkin
                return (
                  <tr
                    key={member.id}
                    className="transition-colors hover:bg-accent/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar size="sm">
                          {member.avatar_url ? (
                            <AvatarImage src={member.avatar_url} alt={member.full_name ?? ''} />
                          ) : null}
                          <AvatarFallback>
                            {getInitials(member.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">
                          {member.full_name ?? 'Unnamed'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {member.email}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={member.role} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {format(new Date(member.created_at), 'dd MMM yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      {isOnSite ? (
                        <div className="flex items-center gap-2">
                          <StatusBadge status="success" label="On Site" />
                          {checkin.mood && (
                            <span className="text-sm">{checkin.mood}</span>
                          )}
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {formatDistanceToNow(new Date(checkin.checked_in_at), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      ) : (
                        <StatusBadge status="neutral" label="Off Site" />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite Sheet */}
      <Sheet
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open)
          if (!open) resetInvite()
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Invite Team Member</SheetTitle>
            <SheetDescription>
              Send an invite link to add someone to your team.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 p-4">
            {!inviteResult ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[12px] text-muted-foreground">Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@restaurant.com"
                      className="pl-8 text-[13px]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[12px] text-muted-foreground">Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v ?? "")}>
                    <SelectTrigger className="w-full text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {USER_ROLES.filter((r) => r !== 'owner').map((role) => (
                        <SelectItem key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  onClick={handleInvite}
                  disabled={inviteMutation.isPending || !inviteEmail.trim()}
                  className="w-full bg-emerald-600 text-[13px] hover:bg-emerald-700"
                >
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                  {inviteMutation.isPending ? 'Sending...' : 'Send Invite'}
                </Button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-600" />
                    <p className="text-[13px] font-medium text-emerald-700">
                      Invite created
                    </p>
                  </div>
                  <p className="mt-1 text-[12px] text-emerald-600">
                    Send this to {inviteEmail}:
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[12px] text-muted-foreground">Invite Code</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={inviteResult.token}
                      className="font-mono text-center text-[14px] font-semibold tracking-widest"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(inviteResult!.token)
                        setCopied(true)
                        toast.success('Token copied!')
                        setTimeout(() => setCopied(false), 2000)
                      }}
                      className="shrink-0"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <p className="mb-2 text-[12px] font-medium text-blue-800">
                    Instructions for the new team member:
                  </p>
                  <ol className="space-y-1 text-[12px] text-blue-700">
                    <li>1. Open the app or go to <span className="font-medium">{typeof window !== 'undefined' ? window.location.origin : 'app.blueroll.app'}</span></li>
                    <li>2. Tap &ldquo;Create Account&rdquo; and register</li>
                    <li>3. Choose &ldquo;Joining a team&rdquo;</li>
                    <li>4. Paste the invite code above</li>
                  </ol>
                </div>

                <Button
                  variant="outline"
                  onClick={() => resetInvite()}
                  className="w-full text-[13px]"
                >
                  Invite Another
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
