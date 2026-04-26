'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LogOut, Trash2, ExternalLink, CreditCard, Plus, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/status-badge'
import { ROLE_LABELS, DEFAULT_EQUIPMENT, type UserRole } from '@/lib/constants'
import { cn } from '@/lib/utils'

export default function SettingsPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const reset = useAuthStore((s) => s.reset)
  const router = useRouter()

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [saving, setSaving] = useState(false)
  const [equipmentList, setEquipmentList] = useState<string[]>(business?.equipment ?? [])
  const [customEquipment, setCustomEquipment] = useState('')
  const [savingEquipment, setSavingEquipment] = useState(false)

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

  function toggleEquipment(item: string) {
    setEquipmentList((prev) =>
      prev.includes(item) ? prev.filter((e) => e !== item) : [...prev, item],
    )
  }

  function addCustomEquipment() {
    const trimmed = customEquipment.trim()
    if (!trimmed || equipmentList.includes(trimmed)) return
    setEquipmentList((prev) => [...prev, trimmed])
    setCustomEquipment('')
  }

  async function handleSaveEquipment() {
    if (!business?.id) return
    setSavingEquipment(true)
    try {
      const { error } = await supabase
        .from('businesses')
        .update({ equipment: equipmentList })
        .eq('id', business.id)
      if (error) throw error
      useAuthStore.getState().setBusiness({ ...business, equipment: equipmentList })
      toast.success('Equipment saved')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save equipment')
    } finally {
      setSavingEquipment(false)
    }
  }

  const equipmentChanged = JSON.stringify(equipmentList.slice().sort()) !== JSON.stringify((business?.equipment ?? []).slice().sort())

  // All chips to show: defaults + any custom items from saved list
  const allEquipmentOptions = [
    ...DEFAULT_EQUIPMENT,
    ...equipmentList.filter((e) => !(DEFAULT_EQUIPMENT as readonly string[]).includes(e)),
  ]

  async function handleSignOut() {
    await supabase.auth.signOut()
    reset()
    window.location.href = '/onboarding'
  }

  const manageSubscriptionMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      if (!business?.stripe_customer_id) throw new Error('No Stripe customer for this business')

      const res = await supabase.functions.invoke('manage-subscription', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          action: 'portal',
          customerId: business.stripe_customer_id,
          returnUrl: `${window.location.origin}/settings`,
        },
      })
      if (res.error) {
        const ctx = (res.error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            const detail = await ctx.json()
            if (detail?.error) throw new Error(detail.error)
          } catch {}
        }
        throw res.error
      }
      return res.data as { portalUrl: string }
    },
    onSuccess: (data) => {
      window.location.assign(data.portalUrl)
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

        {/* Kitchen Equipment */}
        <div className="rounded-lg border border-border bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-medium text-foreground">Kitchen Equipment</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Select equipment in your kitchen. Used for AI checklist generation.</p>
            </div>
            <Button
              size="sm"
              onClick={handleSaveEquipment}
              disabled={savingEquipment || !equipmentChanged}
            >
              {savingEquipment ? 'Saving...' : 'Save'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {allEquipmentOptions.map((item) => {
              const selected = equipmentList.includes(item)
              const isCustom = !(DEFAULT_EQUIPMENT as readonly string[]).includes(item)
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleEquipment(item)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors',
                    selected
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : 'bg-muted/50 text-muted-foreground border-border hover:border-emerald-200',
                  )}
                >
                  {item}
                  {isCustom && selected && <X className="h-2.5 w-2.5" />}
                </button>
              )
            })}
          </div>

          <div className="flex gap-2">
            <input
              value={customEquipment}
              onChange={(e) => setCustomEquipment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomEquipment())}
              placeholder="Add custom equipment..."
              className="flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-[12px] text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <Button variant="outline" size="sm" onClick={addCustomEquipment} disabled={!customEquipment.trim()}>
              <Plus className="h-3 w-3" />
              Add
            </Button>
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
