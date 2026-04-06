'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LogOut, Trash2, ExternalLink, CreditCard } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/status-badge'
import { ROLE_LABELS, type UserRole } from '@/lib/constants'

export default function SettingsPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const reset = useAuthStore((s) => s.reset)
  const router = useRouter()

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSaveName() {
    if (!profile?.id) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName || null })
        .eq('id', profile.id)
      if (error) throw error
      useAuthStore.getState().setProfile({ ...profile, full_name: fullName || null })
      toast.success('Name updated')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update name')
    } finally {
      setSaving(false)
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    reset()
    router.replace('/login')
  }

  const manageSubscriptionMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const res = await supabase.functions.invoke('manage-subscription', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.error) throw res.error
      return res.data as { url: string }
    },
    onSuccess: (data) => {
      window.open(data.url, '_blank')
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to open subscription portal'),
  })

  const subStatus = business?.subscription_status
  const subStatusLabel = subStatus === 'active' ? 'Active'
    : subStatus === 'trialing' ? 'Trial'
    : subStatus === 'canceled' ? 'Cancelled'
    : subStatus === 'past_due' ? 'Past due'
    : 'None'
  const subStatusType = subStatus === 'active' ? 'success'
    : subStatus === 'trialing' ? 'info'
    : subStatus === 'canceled' || subStatus === 'past_due' ? 'error'
    : 'neutral'

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your account and business settings" />

      <div className="max-w-lg space-y-6">
        {/* Profile */}
        <div className="rounded-lg border border-border bg-white p-4 space-y-4">
          <h2 className="text-[14px] font-medium text-foreground">Profile</h2>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-foreground">Full name</label>
            <div className="flex gap-2">
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="flex-1 rounded-md border border-border bg-white px-3 py-2 text-[13px] text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Your name"
              />
              <Button
                size="sm"
                onClick={handleSaveName}
                disabled={saving || fullName === (profile?.full_name ?? '')}
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">Email</label>
            <p className="text-[13px] text-foreground">{profile?.email ?? '-'}</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">Role</label>
            <p className="text-[13px] text-foreground">{ROLE_LABELS[(profile?.role ?? '') as UserRole] ?? profile?.role ?? '-'}</p>
          </div>
        </div>

        {/* Business */}
        <div className="rounded-lg border border-border bg-white p-4 space-y-4">
          <h2 className="text-[14px] font-medium text-foreground">Business</h2>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">Name</label>
            <p className="text-[13px] text-foreground">{business?.name ?? '-'}</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">Address</label>
            <p className="text-[13px] text-foreground">{business?.address ?? '-'}</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-muted-foreground">FSA rating</label>
            <p className="text-[13px] text-foreground">{business?.fsa_rating ?? '-'}</p>
          </div>
        </div>

        {/* Subscription */}
        <div className="rounded-lg border border-border bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-medium text-foreground">Subscription</h2>
            <StatusBadge
              status={subStatusType as 'success' | 'info' | 'error' | 'neutral'}
              label={subStatusLabel}
            />
          </div>

          {business?.trial_ends_at && subStatus === 'trialing' && (
            <p className="text-[12px] text-muted-foreground">
              Trial ends {new Date(business.trial_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => manageSubscriptionMutation.mutate()}
            disabled={manageSubscriptionMutation.isPending}
          >
            <CreditCard className="h-3.5 w-3.5" />
            {manageSubscriptionMutation.isPending ? 'Opening...' : 'Manage subscription'}
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Button variant="outline" size="sm" onClick={handleSignOut} className="w-full justify-center">
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>

          <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 space-y-3">
            <h2 className="text-[14px] font-medium text-red-700">Danger zone</h2>
            <p className="text-[12px] text-red-600">
              Deleting your account will permanently remove all your data. This action cannot be undone.
            </p>
            <Button variant="outline" size="sm" disabled className="border-red-200 text-red-600 opacity-70">
              <Trash2 className="h-3.5 w-3.5" />
              Delete account (coming soon)
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
