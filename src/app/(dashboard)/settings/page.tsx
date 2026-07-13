'use client'

import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { LogOut, ExternalLink, Plus, X, ArrowRight, CreditCard, Lock } from 'lucide-react'
import { ROLE_LABELS, DEFAULT_EQUIPMENT, type UserRole } from '@/lib/constants'
import { SitesSettings } from './sites-settings'
import { MembersRoles } from './members-roles'
import { NotificationsSettings } from './notifications-settings'

const PRICE_PER_SITE = 24.99
const VAT_RATE = 0.2
const DEMO_THRESHOLD = 4
const gbp = (n: number) => `£${n.toFixed(2)}`
const initialsOf = (n: string) => { const p = n.split(' ').filter(Boolean); return (p.length >= 2 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase() }

const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)' }
const H1: React.CSSProperties = { margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: '#16181d' }
const SUB: React.CSSProperties = { color: '#6b7280', fontSize: 14, marginTop: 5 }
const LABEL: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#41464d', display: 'block', marginBottom: 8 }
const CARD_TITLE: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#16181d' }
const MICRO: React.CSSProperties = { font: "600 11px 'Geist'", letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a9099' }
const INPUT: React.CSSProperties = { width: '100%', background: '#fff', border: '1px solid #e2e4e8', borderRadius: 10, padding: '11px 13px', fontSize: 14, color: '#1c1f24', outline: 'none' }
const GREEN_BTN: React.CSSProperties = { background: '#1f9d63', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, padding: '11px 18px', borderRadius: 10, cursor: 'pointer' }
const focusRing = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.13)' }
const blurRing = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }

type Tab = 'Profile' | 'Sites' | 'Team' | 'Billing' | 'Notifications'
const TAB_LABEL: Record<Tab, string> = { Profile: 'Profile', Sites: 'Sites', Team: 'Team', Billing: 'Billing & subscription', Notifications: 'Notifications' }
const TAB_WIDTH: Record<Tab, number> = { Profile: 760, Sites: 860, Team: 860, Billing: 1060, Notifications: 760 }

export default function SettingsPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const reset = useAuthStore((s) => s.reset)
  const isGroupAdmin = profile?.is_group_admin || profile?.role === 'owner' || profile?.role === 'manager'

  const tabs: Tab[] = ['Profile', ...(isGroupAdmin ? (['Sites', 'Team'] as Tab[]) : []), 'Billing', 'Notifications']
  const [tab, setTab] = useState<Tab>('Profile')

  const [groupName, setGroupName] = useState(business?.name ?? '')
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [savingOrg, setSavingOrg] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const [equipmentList, setEquipmentList] = useState<string[]>(business?.equipment ?? [])
  const [customEquipment, setCustomEquipment] = useState('')
  const [savingEquipment, setSavingEquipment] = useState(false)

  // Keep form fields in sync as the persisted profile/business hydrate (avoids
  // a stale empty field that could overwrite the saved value).
  useEffect(() => { setFullName(profile?.full_name ?? '') }, [profile?.full_name])
  useEffect(() => { setGroupName(business?.name ?? '') }, [business?.name])
  useEffect(() => { setEquipmentList(business?.equipment ?? []) }, [business?.equipment])

  async function handleSaveOrg() {
    if (!business?.id) return
    setSavingOrg(true)
    try {
      const { error } = await supabase.from('businesses').update({ name: groupName || null }).eq('id', business.id)
      if (error) throw error
      useAuthStore.getState().setBusiness({ ...business, name: groupName })
      toast.success('Saved')
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to save') } finally { setSavingOrg(false) }
  }

  async function handleSaveName() {
    if (!profile?.id) return
    setSavingName(true)
    try {
      const { error } = await supabase.from('profiles').update({ full_name: fullName || null }).eq('id', profile.id)
      if (error) throw error
      useAuthStore.getState().setProfile({ ...profile, full_name: fullName || null })
      toast.success('Name updated')
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to update name') } finally { setSavingName(false) }
  }

  function toggleEquipment(item: string) { setEquipmentList((prev) => (prev.includes(item) ? prev.filter((e) => e !== item) : [...prev, item])) }
  function addCustomEquipment() {
    const trimmed = customEquipment.trim()
    if (!trimmed || equipmentList.includes(trimmed)) return
    setEquipmentList((prev) => [...prev, trimmed]); setCustomEquipment('')
  }
  async function handleSaveEquipment() {
    if (!business?.id) return
    setSavingEquipment(true)
    try {
      const { error } = await supabase.from('businesses').update({ equipment: equipmentList }).eq('id', business.id)
      if (error) throw error
      useAuthStore.getState().setBusiness({ ...business, equipment: equipmentList })
      toast.success('Equipment saved')
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to save equipment') } finally { setSavingEquipment(false) }
  }
  const equipmentChanged = JSON.stringify(equipmentList.slice().sort()) !== JSON.stringify((business?.equipment ?? []).slice().sort())
  const allEquipmentOptions = [...DEFAULT_EQUIPMENT, ...equipmentList.filter((e) => !(DEFAULT_EQUIPMENT as readonly string[]).includes(e))]

  async function handleSignOut() { await supabase.auth.signOut(); reset(); window.location.href = '/onboarding' }

  const manageSubscriptionMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      if (!business?.stripe_customer_id) throw new Error('No Stripe customer yet — subscription is managed once billing is set up.')
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

  const displayName = profile?.full_name || profile?.email?.split('@')[0] || 'You'
  const roleLabel = ROLE_LABELS[(profile?.role ?? '') as UserRole] ?? profile?.role ?? '—'

  return (
    <div style={{ margin: '0 auto', maxWidth: TAB_WIDTH[tab], fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d', transition: 'max-width .2s' }}>
      <h1 style={{ ...H1, marginBottom: 16 }}>Settings</h1>

      {/* horizontal tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #eceef0', marginBottom: 24, overflowX: 'auto' }}>
        {tabs.map((t) => {
          const on = tab === t
          return (
            <button key={t} onClick={() => setTab(t)}
              style={{ position: 'relative', border: 'none', background: 'none', cursor: 'pointer', padding: '10px 12px 13px', font: `${on ? 600 : 500} 14px 'Geist'`, color: on ? '#16181d' : '#6b7280', whiteSpace: 'nowrap' }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = '#16181d' }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = '#6b7280' }}>
              {TAB_LABEL[t]}
              {on && <span style={{ position: 'absolute', left: 8, right: 8, bottom: -1, height: 2, background: '#1f9d63', borderRadius: 2 }} />}
            </button>
          )
        })}
      </div>

      {tab === 'Sites' && <SitesSettings />}
      {tab === 'Team' && <MembersRoles />}
      {tab === 'Notifications' && <NotificationsSettings />}

      {/* ── Profile ── */}
      {tab === 'Profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Personal details */}
          <div style={{ ...CARD, padding: 22, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#e9f6ef', color: '#1f7a52', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 18px 'Geist'", flex: 'none' }}>{initialsOf(displayName)}</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{displayName}</div>
                <div style={{ fontSize: 13, color: '#8a9099', marginTop: 2 }}>{roleLabel}{business?.name ? ` · ${business.name}` : ''}</div>
              </div>
            </div>
            <div>
              <label style={LABEL}>Full name</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: 460 }}>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} style={{ ...INPUT, flex: 1 }} onFocus={focusRing} onBlur={blurRing} />
                <button onClick={handleSaveName} disabled={savingName || fullName === (profile?.full_name ?? '')} style={{ ...GREEN_BTN, padding: '11px 16px', opacity: savingName || fullName === (profile?.full_name ?? '') ? 0.55 : 1 }}>{savingName ? '…' : 'Save'}</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
              <div><div style={{ ...MICRO, marginBottom: 6 }}>Email</div><div style={{ fontSize: 14, color: '#1c1f24' }}>{profile?.email ?? '—'}</div></div>
              <div><div style={{ ...MICRO, marginBottom: 6 }}>Role</div><div style={{ fontSize: 14, color: '#1c1f24' }}>{roleLabel}</div></div>
            </div>
          </div>

          {/* Organisation */}
          {isGroupAdmin && (
            <div style={{ ...CARD, padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={CARD_TITLE}>Organisation</div>
              <div>
                <label style={LABEL}>Group name</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: 460 }}>
                  <input value={groupName} onChange={(e) => setGroupName(e.target.value)} style={{ ...INPUT, flex: 1 }} onFocus={focusRing} onBlur={blurRing} />
                  <button onClick={handleSaveOrg} disabled={savingOrg || groupName === (business?.name ?? '')} style={{ ...GREEN_BTN, padding: '11px 16px', opacity: savingOrg || groupName === (business?.name ?? '') ? 0.55 : 1 }}>{savingOrg ? '…' : 'Save'}</button>
                </div>
              </div>
              <div>
                <label style={LABEL}>Registered address</label>
                <div style={{ ...INPUT, maxWidth: 460, color: business?.address ? '#1c1f24' : '#9aa0a8', background: '#fafbfb' }}>{business?.address ?? 'Not set'}</div>
              </div>
            </div>
          )}

          {/* Kitchen equipment */}
          {isGroupAdmin && (
            <div style={{ ...CARD, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <div style={CARD_TITLE}>Kitchen equipment</div>
                  <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 3 }}>Used for AI checklist generation.</div>
                </div>
                <button onClick={handleSaveEquipment} disabled={savingEquipment || !equipmentChanged} style={{ ...GREEN_BTN, padding: '9px 14px', opacity: savingEquipment || !equipmentChanged ? 0.55 : 1 }}>{savingEquipment ? 'Saving…' : 'Save'}</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {allEquipmentOptions.map((item) => {
                  const selected = equipmentList.includes(item)
                  const isCustom = !(DEFAULT_EQUIPMENT as readonly string[]).includes(item)
                  return (
                    <button key={item} type="button" onClick={() => toggleEquipment(item)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 20, padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: selected ? '1px solid #bfe0cd' : '1px solid #e7e9ec', background: selected ? '#eaf4ee' : '#f7f8f9', color: selected ? '#1a6e49' : '#5c626b' }}>
                      {item}{isCustom && selected && <X className="h-3 w-3" />}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, maxWidth: 460 }}>
                <input value={customEquipment} onChange={(e) => setCustomEquipment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomEquipment() } }} placeholder="Add custom equipment…" style={{ ...INPUT, flex: 1, padding: '9px 12px', fontSize: 13 }} onFocus={focusRing} onBlur={blurRing} />
                <button onClick={addCustomEquipment} disabled={!customEquipment.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #e2e4e8', background: '#fff', color: '#5c626b', fontSize: 13, fontWeight: 600, padding: '9px 13px', borderRadius: 9, cursor: 'pointer', opacity: customEquipment.trim() ? 1 : 0.55 }}><Plus className="h-3.5 w-3.5" /> Add</button>
              </div>
            </div>
          )}

          {/* Security */}
          <div style={{ ...CARD, padding: 22, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ ...CARD_TITLE, marginBottom: 6 }}>Security</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderTop: '1px solid #f4f5f6' }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1c1f24' }}>Active sessions</div>
                <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 2 }}>Sign out of BlueRoll on this device.</div>
              </div>
              <button onClick={handleSignOut} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid #f0cfcb', background: '#fff', color: '#c0392b', fontSize: 13.5, fontWeight: 600, padding: '9px 14px', borderRadius: 10, cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#fdf3f2')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
                <LogOut className="h-4 w-4" strokeWidth={1.8} /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Billing & subscription ── */}
      {tab === 'Billing' && (() => {
        const siteCount = Math.max(sites.length, 1)
        const subtotal = siteCount * PRICE_PER_SITE
        const vat = subtotal * VAT_RATE
        const total = subtotal + vat
        const now = new Date(); const nextInvoice = new Date(now.getFullYear(), now.getMonth() + 1, 1)
        const nextInvoiceStr = nextInvoice.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
            {/* main */}
            <div style={{ flex: '1 1 520px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h1 style={H1}>Billing &amp; subscription</h1>
                <div style={SUB}>One simple price — <strong style={{ color: '#16181d', fontWeight: 700 }}>£24.99 per site, per month</strong>. Every site gets everything.</div>
              </div>

              {/* Your sites */}
              <div style={CARD}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '15px 20px 13px' }}>
                  <span style={CARD_TITLE}>Your sites</span>
                  <span style={{ font: "600 12px 'Geist'", color: '#8a9099', background: '#f1f2f4', borderRadius: 14, padding: '1px 8px' }}>{siteCount}</span>
                  {isGroupAdmin && <button onClick={() => setTab('Sites')} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: '#1f7a52', font: "600 13px 'Geist'", cursor: 'pointer' }}>Manage sites <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} /></button>}
                </div>
                <div style={{ padding: '0 20px 4px', fontSize: 12.5, color: '#9aa0a8', lineHeight: 1.5 }}>Adding or removing sites happens in Sites — billing follows automatically, prorated to the day.</div>
                {(sites.length ? sites : [{ id: 'x', name: business?.name ?? 'Your site', postcode: '' } as { id: string; name: string; postcode?: string }]).map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 20px', borderTop: '1px solid #f4f5f6' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 9, background: '#eef7f2', color: '#1f7a52', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 12px 'Geist'", flex: 'none' }}>{initialsOf(s.name)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ font: "600 14px 'Geist'", color: '#1c1f24' }}>{s.name}</div>
                      <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 1 }}>{(s as { postcode?: string }).postcode || 'Active site'}</div>
                    </div>
                    <span style={{ font: "600 11.5px 'Geist'", color: '#1a6e49', background: '#e9f6ef', padding: '3px 9px', borderRadius: 20 }}>Active</span>
                    <span style={{ font: "600 13.5px 'Geist'", color: '#41464d', fontVariantNumeric: 'tabular-nums', width: 84, textAlign: 'right' }}>{gbp(PRICE_PER_SITE)}/mo</span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px', background: '#fafbfb', borderTop: '1px solid #eef0f2' }}>
                  <span style={{ fontSize: 13, color: '#6b7280' }}>{siteCount} site{siteCount === 1 ? '' : 's'} × {gbp(PRICE_PER_SITE)}</span>
                  <span style={{ font: "700 15px 'Geist'", fontVariantNumeric: 'tabular-nums' }}>{gbp(subtotal)}<span style={{ font: "500 13px 'Geist'", color: '#8a9099' }}>/mo</span></span>
                </div>
              </div>

              {/* payment + contact */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ ...CARD, flex: '1 1 240px', padding: 18 }}>
                  <div style={MICRO}>Payment method</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 12 }}>
                    <span style={{ width: 42, height: 28, borderRadius: 6, background: '#14161b', color: '#fff', font: "700 10px 'Geist'", display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '.05em', flex: 'none' }}>VISA</span>
                    <div style={{ fontSize: 13.5, color: '#41464d' }}>•••• 4242</div>
                    <button onClick={() => manageSubscriptionMutation.mutate()} title="Opens the Stripe customer portal" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: '#1f7a52', font: "600 12.5px 'Geist'", cursor: 'pointer' }}>Change <ExternalLink className="h-3 w-3" /></button>
                  </div>
                </div>
                <div style={{ ...CARD, flex: '1 1 240px', padding: 18 }}>
                  <div style={MICRO}>Billing contact</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 12 }}>
                    <div style={{ fontSize: 13.5, color: '#41464d', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.email ?? '—'}</div>
                    <button onClick={() => manageSubscriptionMutation.mutate()} title="Opens the Stripe customer portal" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: '#1f7a52', font: "600 12.5px 'Geist'", cursor: 'pointer', flex: 'none' }}>Edit <ExternalLink className="h-3 w-3" /></button>
                  </div>
                </div>
              </div>

              {/* invoices */}
              <div style={{ ...CARD, padding: 20 }}>
                <div style={CARD_TITLE}>Invoices</div>
                <div style={{ fontSize: 12.5, color: '#9aa0a8', marginTop: 4 }}>Billed monthly on the 1st · issued by Stripe.</div>
                <button onClick={() => manageSubscriptionMutation.mutate()} disabled={manageSubscriptionMutation.isPending}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 15, border: '1px solid #e2e4e8', background: '#fff', color: '#41464d', font: "600 13.5px 'Geist'", padding: '10px 15px', borderRadius: 10, cursor: 'pointer' }}>
                  <CreditCard className="h-4 w-4" strokeWidth={1.8} /> {manageSubscriptionMutation.isPending ? 'Opening…' : 'View & download invoices'} <ExternalLink className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* rail */}
            <div style={{ flex: '1 1 260px', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 0 }}>
              <div style={{ ...CARD, padding: 18 }}>
                <div style={MICRO}>Next invoice</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#16181d', marginTop: 9 }}>{nextInvoiceStr}</div>
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <Row l={`${siteCount} site${siteCount === 1 ? '' : 's'} × ${gbp(PRICE_PER_SITE)}`} r={gbp(subtotal)} />
                  <Row l="VAT (20%)" r={gbp(vat)} muted />
                  <div style={{ height: 1, background: '#eef0f2', margin: '3px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>Total</span>
                    <span style={{ font: "700 17px 'Geist'", fontVariantNumeric: 'tabular-nums' }}>{gbp(total)}</span>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: '#9aa0a8', marginTop: 12, lineHeight: 1.5 }}>No tiers, no per-user fees. Sites added mid-month are prorated.</div>
              </div>

              {siteCount >= DEMO_THRESHOLD && (
                <div style={{ background: '#0f3524', borderRadius: 16, padding: 18, color: '#fff' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>Managing {siteCount} sites?</div>
                  <div style={{ fontSize: 12.5, color: '#9fc7b3', marginTop: 4, lineHeight: 1.5 }}>Get a walkthrough of estate-wide reporting and rollout.</div>
                  <a href="mailto:hello@blueroll.app?subject=BlueRoll%20demo" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, background: '#1f9d63', color: '#fff', font: "600 13px 'Geist'", padding: '8px 14px', borderRadius: 9, textDecoration: 'none' }}>Book a demo</a>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '2px 4px' }}>
                <button onClick={() => manageSubscriptionMutation.mutate()} style={{ border: 'none', background: 'none', color: '#8a9099', font: "500 12.5px 'Geist'", cursor: 'pointer', textAlign: 'left', padding: 0 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#c0392b')} onMouseLeave={(e) => (e.currentTarget.style.color = '#8a9099')}>Cancel subscription</button>
                <span style={{ fontSize: 11.5, color: '#b3b8bf' }}>Prices exclude VAT.</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#9aa0a8' }}><Lock className="h-3 w-3" strokeWidth={2} /> Payments handled securely by Stripe.</span>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function Row({ l, r, muted }: { l: string; r: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: muted ? '#8a9099' : '#41464d' }}>{l}</span>
      <span style={{ color: muted ? '#8a9099' : '#41464d', fontVariantNumeric: 'tabular-nums' }}>{r}</span>
    </div>
  )
}
