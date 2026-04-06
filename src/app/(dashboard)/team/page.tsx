'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Users, Plus, Copy, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { ROLE_LABELS, ROLE_COLORS, USER_ROLES, type UserRole } from '@/lib/constants'
import { format } from 'date-fns'

function generateToken(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const arr = new Uint8Array(length)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => chars[b % chars.length]).join('')
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(' ').filter(Boolean)
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (parts[0]?.[0] ?? '').toUpperCase()
  }
  return email[0]?.toUpperCase() ?? '?'
}

export default function TeamPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('kitchen_staff')
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('business_id', business.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const { data: checkins = [] } = useQuery({
    queryKey: ['staff-checkins', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const { data, error } = await supabase
        .from('staff_checkins')
        .select('*')
        .eq('business_id', business.id)
        .gte('checked_in_at', today.toISOString())
        .is('checked_out_at', null)
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const checkinMap = new Map(checkins.map((c: { user_id: string }) => [c.user_id, c]))

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!business?.id || !profile?.id) throw new Error('No business')
      const token = generateToken(32)
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 7)

      const { error } = await supabase.from('invites').insert({
        business_id: business.id,
        email: inviteEmail,
        role: inviteRole,
        token,
        invited_by: profile.id,
        expires_at: expiresAt.toISOString(),
      })
      if (error) throw error
      return token
    },
    onSuccess: (token) => {
      setGeneratedToken(token)
      queryClient.invalidateQueries({ queryKey: ['team'] })
      toast.success('Invite created')
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create invite')
    },
  })

  function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault()
    inviteMutation.mutate()
  }

  function handleCopyToken() {
    if (!generatedToken) return
    navigator.clipboard.writeText(generatedToken)
    setCopied(true)
    toast.success('Token copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  function resetInvite() {
    setShowInvite(false)
    setInviteEmail('')
    setInviteRole('kitchen_staff')
    setGeneratedToken(null)
    setCopied(false)
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Team" description="Manage your team members" />
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Team" description="Manage your team members">
        {isManager && (
          <Button size="sm" onClick={() => { resetInvite(); setShowInvite(true) }}>
            <Plus className="h-3.5 w-3.5" />
            Invite member
          </Button>
        )}
      </PageHeader>

      {/* Invite Sheet */}
      {showInvite && (
        <div className="rounded-lg border border-border bg-white p-4">
          {generatedToken ? (
            <div className="space-y-4">
              <h3 className="text-[14px] font-medium text-foreground">Invite created</h3>
              <div className="rounded-lg border border-border bg-gray-50 p-4">
                <p className="mb-2 text-[12px] font-medium text-muted-foreground">Invite Token</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border border-border bg-white px-3 py-2 font-mono text-[15px] font-semibold text-foreground tracking-wide">
                    {generatedToken}
                  </code>
                  <Button variant="outline" size="sm" onClick={handleCopyToken}>
                    {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-emerald-50 p-4">
                <p className="mb-2 text-[13px] font-medium text-emerald-800">Send these instructions to the new member:</p>
                <ol className="space-y-1 text-[13px] text-emerald-700">
                  <li>1. Open the app or website</li>
                  <li>2. Tap &quot;Create Account&quot;</li>
                  <li>3. Select &quot;Joining a team&quot;</li>
                  <li>4. Paste the invite code</li>
                </ol>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={resetInvite}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleInviteSubmit} className="space-y-4">
              <h3 className="text-[14px] font-medium text-foreground">Invite a team member</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-foreground">Email</label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="colleague@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-foreground">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value ?? '')}
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {USER_ROLES.filter((r) => r !== 'owner').map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" type="button" onClick={resetInvite}>
                  Cancel
                </Button>
                <Button size="sm" type="submit" disabled={inviteMutation.isPending}>
                  {inviteMutation.isPending ? 'Creating...' : 'Create invite'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No team members"
          description="Invite your first team member to get started."
          action={isManager ? { label: 'Invite member', onClick: () => setShowInvite(true) } : undefined}
        />
      ) : (
        <div className="rounded-lg border border-border bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Member</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Role</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Joined</th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m: { id: string; full_name: string | null; email: string; role: string; created_at: string }) => {
                const isOnSite = checkinMap.has(m.id)
                return (
                  <tr key={m.id} className="hover:bg-accent/50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="text-[10px]">{getInitials(m.full_name, m.email)}</AvatarFallback>
                        </Avatar>
                        <span className="text-[13px] font-medium text-foreground">{m.full_name || 'Unnamed'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground">{m.email}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', ROLE_COLORS[m.role as UserRole] ?? ROLE_COLORS.kitchen_staff)}>
                        {ROLE_LABELS[m.role as UserRole] ?? m.role}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] tabular-nums text-muted-foreground">
                      {format(new Date(m.created_at), 'dd MMM yyyy')}
                    </td>
                    <td className="px-4 py-2.5">
                      {isOnSite ? (
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          On-site
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                          Off-site
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
