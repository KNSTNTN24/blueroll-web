'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LogOut, CreditCard, ExternalLink, Plus, X } from 'lucide-react'
import { ROLE_LABELS, DEFAULT_EQUIPMENT, type UserRole } from '@/lib/constants'
import { SitesSettings } from './sites-settings'
import { MembersRoles } from './members-roles'
import { NotificationsSettings } from './notifications-settings'

const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, padding: 22, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)' }
const H1: React.CSSProperties = { margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-.01em', color: '#16181d' }
const SUB: React.CSSProperties = { color: '#6b7280', fontSize: 13.5, marginTop: 4 }
const LABEL: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#41464d', display: 'block', marginBottom: 8 }
const FIELD: React.CSSProperties = { width: '100%', maxWidth: 420, background: '#fff', border: '1px solid #e2e4e8', borderRadius: 10, padding: '11px 13px', fontSize: 14, color: '#1c1f24' }
const INPUT: React.CSSProperties = { ...FIELD, outline: 'none' }
const GREEN_BTN: React.CSSProperties = { background: '#1f9d63', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, padding: '11px 18px', borderRadius: 11, cursor: 'pointer' }

type Tab = 'General' | 'Sites' | 'Members & roles' | 'Notifications' | 'Billing'

export default function SettingsPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const reset = useAuthStore((s) => s.reset)
  const isGroupAdmin = profile?.is_group_admin || profile?.role === 'owner' || profile?.role === 'manager'
  const router = useRouter()

  const tabs: Tab[] = ['General', ...(isGroupAdmin ? (['Sites', 'Members & roles', 'Notifications'] as Tab[]) : []), 'Billing']
  const [tab, setTab] = useState<Tab>('General')

  const [groupName, setGroupName] = useState(business?.name ?? '')
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [savingOrg, setSavingOrg] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const [equipmentList, setEquipmentList] = useState<string[]>(business?.equipment ?? [])
  const [customEquipment, setCustomEquipment] = useState('')
  const [savingEquipment, setSavingEquipment] = useState(false)

  async function handleSaveOrg() {
    if (!business?.id) return
    setSavingOrg(true)
    try {
      const { error } = await supabase.from('businesses').update({ name: groupName || null }).eq('id', business.id)
      if (error) throw error
      useAuthStore.getState().setBusiness({ ...business, name: groupName })
      toast.success('Saved')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally { setSavingOrg(false) }
  }

  async function handleSaveName() {
    if (!profile?.id) return
    setSavingName(true)
    try {
      const { error } = await supabase.from('profiles').update({ full_name: fullName || null }).eq('id', profile.id)
      if (error) throw error
      useAuthStore.getState().setProfile({ ...profile, full_name: fullName || null })
      toast.success('Name updated')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update name')
    } finally { setSavingName(false) }
  }

  function toggleEquipment(item: string) {
    setEquipmentList((prev) => (prev.includes(item) ? prev.filter((e) => e !== item) : [...prev, item]))
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
      const { error } = await supabase.from('businesses').update({ equipment: equipmentList }).eq('id', business.id)
      if (error) throw error
      useAuthStore.getState().setBusiness({ ...business, equipment: equipmentList })
      toast.success('Equipment saved')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save equipment')
    } finally { setSavingEquipment(false) }
  }
  const equipmentChanged = JSON.stringify(equipmentList.slice().sort()) !== JSON.stringify((business?.equipment ?? []).slice().sort())
  const allEquipmentOptions = [...DEFAULT_EQUIPMENT, ...equipmentList.filter((e) => !(DEFAULT_EQUIPMENT as readonly string[]).includes(e))]

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
        body: { action: 'portal', customerId: business.stripe_customer_id, returnUrl: `${window.location.origin}/settings` },
      })
      if (res.error) {
        const ctx = (res.error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') { try { const detail = await ctx.json(); if (detail?.error) throw new Error(detail.error) } catch {} }
        throw res.error
      }
      return res.data as { portalUrl: string }
    },
    onSuccess: (data) => window.location.assign(data.portalUrl),
    onError: (err: Error) => toast.error(err.message || 'Failed to open subscription portal'),
  })

  const subStatus = business?.subscription_status
  const subLabel = subStatus === 'active' ? 'Active' : subStatus === 'trialing' ? 'Trial' : subStatus === 'canceled' ? 'Cancelled' : subStatus === 'past_due' ? 'Past due' : 'None'
  const subActive = subStatus === 'active' || subStatus === 'trialing'

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', maxWidth: 1060, fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      {/* tab nav */}
      <nav style={{ width: 190, flex: 'none', display: 'flex', flexDirection: 'column', gap: 2, position: 'sticky', top: 0 }}>
        {tabs.map((t) => {
          const on = tab === t
          return (
            <button key={t} onClick={() => setTab(t)}
              style={{ textAlign: 'left', border: 'none', cursor: 'pointer', padding: '9px 12px', borderRadius: 9, fontSize: 14, fontWeight: on ? 600 : 500, background: on ? '#e7f0ea' : 'transparent', color: on ? '#1a6e49' : '#5c626b' }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = '#eef0f2' }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent' }}>
              {t}
            </button>
          )
        })}
      </nav>

      {/* panels */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tab === 'Sites' && <SitesSettings />}
        {tab === 'Members & roles' && <MembersRoles />}
        {tab === 'Notifications' && <NotificationsSettings />}

        {tab === 'General' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h1 style={H1}>General</h1>
              <div style={SUB}>Organisation details for {business?.name ?? 'your group'}</div>
            </div>

            {/* Organisation */}
            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={LABEL}>Group name</label>
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} style={INPUT}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
              </div>
              <div>
                <label style={LABEL}>Registered address</label>
                <div style={{ ...FIELD, color: business?.address ? '#1c1f24' : '#9aa0a8' }}>{business?.address ?? 'Not set'}</div>
              </div>
              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                <button onClick={handleSaveOrg} disabled={savingOrg || groupName === (business?.name ?? '')}
                  style={{ ...GREEN_BTN, opacity: savingOrg || groupName === (business?.name ?? '') ? 0.55 : 1 }}>
                  {savingOrg ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>

            {/* Your profile */}
            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Your profile</div>
              <div>
                <label style={LABEL}>Full name</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: 420 }}>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} style={{ ...INPUT, flex: 1 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
                  <button onClick={handleSaveName} disabled={savingName || fullName === (profile?.full_name ?? '')}
                    style={{ ...GREEN_BTN, padding: '11px 15px', opacity: savingName || fullName === (profile?.full_name ?? '') ? 0.55 : 1 }}>
                    {savingName ? '…' : 'Save'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
                <div><div style={{ ...LABEL, marginBottom: 4 }}>Email</div><div style={{ fontSize: 14, color: '#1c1f24' }}>{profile?.email ?? '—'}</div></div>
                <div><div style={{ ...LABEL, marginBottom: 4 }}>Role</div><div style={{ fontSize: 14, color: '#1c1f24' }}>{ROLE_LABELS[(profile?.role ?? '') as UserRole] ?? profile?.role ?? '—'}</div></div>
              </div>
            </div>

            {/* Kitchen equipment */}
            <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Kitchen equipment</div>
                  <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 3 }}>Used for AI checklist generation.</div>
                </div>
                <button onClick={handleSaveEquipment} disabled={savingEquipment || !equipmentChanged}
                  style={{ ...GREEN_BTN, padding: '9px 14px', opacity: savingEquipment || !equipmentChanged ? 0.55 : 1 }}>
                  {savingEquipment ? 'Saving…' : 'Save'}
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {allEquipmentOptions.map((item) => {
                  const selected = equipmentList.includes(item)
                  const isCustom = !(DEFAULT_EQUIPMENT as readonly string[]).includes(item)
                  return (
                    <button key={item} type="button" onClick={() => toggleEquipment(item)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 20, padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        border: selected ? '1px solid #bfe0cd' : '1px solid #e7e9ec', background: selected ? '#eaf4ee' : '#f7f8f9', color: selected ? '#1a6e49' : '#5c626b' }}>
                      {item}{isCustom && selected && <X className="h-3 w-3" />}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, maxWidth: 420 }}>
                <input value={customEquipment} onChange={(e) => setCustomEquipment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomEquipment() } }}
                  placeholder="Add custom equipment…" style={{ ...INPUT, flex: 1, padding: '9px 12px', fontSize: 13 }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
                <button onClick={addCustomEquipment} disabled={!customEquipment.trim()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #e2e4e8', background: '#fff', color: '#5c626b', fontSize: 13, fontWeight: 600, padding: '9px 13px', borderRadius: 9, cursor: 'pointer', opacity: customEquipment.trim() ? 1 : 0.55 }}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'Billing' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h1 style={H1}>Billing</h1>
              <div style={SUB}>Plan, payment and subscription</div>
            </div>
            <div style={CARD}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ fontSize: 17, fontWeight: 700 }}>BlueRoll subscription</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: subActive ? '#1a6e49' : '#8a9099', background: subActive ? '#e7f0ea' : '#f1f2f4', padding: '4px 9px', borderRadius: 6 }}>{subLabel}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#8a9099', marginTop: 5 }}>
                    {business?.trial_ends_at && subStatus === 'trialing'
                      ? `Trial ends ${new Date(business.trial_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
                      : 'Unlimited team members · all features included'}
                  </div>
                </div>
              </div>
              <div style={{ height: 1, background: '#eef0f2', margin: '18px 0' }} />
              <button onClick={() => manageSubscriptionMutation.mutate()} disabled={manageSubscriptionMutation.isPending}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid #e2e4e8', background: '#fff', color: '#41464d', fontSize: 13.5, fontWeight: 600, padding: '10px 15px', borderRadius: 10, cursor: 'pointer' }}>
                <CreditCard className="h-4 w-4" />
                {manageSubscriptionMutation.isPending ? 'Opening…' : 'Manage subscription'}
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>

            <div style={{ ...CARD, padding: 18 }}>
              <button onClick={handleSignOut}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid #e2e4e8', background: '#fff', color: '#5c626b', fontSize: 13.5, fontWeight: 600, padding: '10px 15px', borderRadius: 10, cursor: 'pointer' }}>
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
