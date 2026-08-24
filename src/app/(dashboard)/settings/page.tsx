'use client'

import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { ExternalLink, ArrowRight, CreditCard, Lock } from 'lucide-react'
import { ROLE_LABELS, type UserRole } from '@/lib/constants'
import { Switch } from '@/components/ui/switch'
import { setDemoModeAndReload } from '@/lib/demo'
import { SitesSettings } from './sites-settings'
import { MembersRoles } from './members-roles'
import { NotificationsSettings } from './notifications-settings'

const CONTENT_WIDTH = 860
const PRICE_PER_SITE = 24.99
const VAT_RATE = 0.2
const DEMO_THRESHOLD = 4
const gbp = (n: number) => `£${n.toFixed(2)}`
const initialsOf = (n: string) => { const p = n.split(' ').filter(Boolean); return (p.length >= 2 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase() }

const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)' }
const PAGE_H1: React.CSSProperties = { margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: '#16181d' }
const PAGE_SUB: React.CSSProperties = { margin: '6px 0 0', fontSize: 14, color: '#6b7280' }
const FIELD_LABEL: React.CSSProperties = { font: "600 12.5px 'Geist'", color: '#41464d' }
const MICRO: React.CSSProperties = { font: "600 11px 'Geist'", letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a9099' }
const FIELD: React.CSSProperties = { border: '1px solid #e2e4e8', borderRadius: 10, padding: '9px 12px', font: "500 13.5px 'Geist'", color: '#16181d', background: '#fff', outline: 'none', width: '100%' }
const GREEN_BTN: React.CSSProperties = { border: 'none', background: '#1f9d63', color: '#fff', borderRadius: 10, padding: '9px 18px', cursor: 'pointer', font: "600 13.5px 'Geist'" }
const focusRing = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.13)' }
const blurRing = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }

type Tab = 'Profile' | 'Sites' | 'Team' | 'Billing' | 'Notifications'
const TAB_LABEL: Record<Tab, string> = { Profile: 'Profile', Sites: 'Sites', Team: 'Team', Billing: 'Billing & subscription', Notifications: 'Notifications' }

export default function SettingsPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const demoMode = useAuthStore((s) => s.demoMode)
  const reset = useAuthStore((s) => s.reset)
  // The Sites/Team admin tabs gate on ROLE, not is_group_admin. is_group_admin
  // is a site-access scope ("sees every site"), not an admin grant — a member
  // given full-estate access must NOT thereby gain team/role management.
  const showAdminTabs = profile?.role === 'owner' || profile?.role === 'manager'

  const tabs: Tab[] = ['Profile', ...(showAdminTabs ? (["Sites", "Team"] as Tab[]) : []), 'Billing', 'Notifications']
  const [tab, setTab] = useState<Tab>('Profile')

  // Profile personal fields
  const nameParts = (profile?.full_name ?? '').split(' ')
  const [firstName, setFirstName] = useState(nameParts[0] ?? '')
  const [lastName, setLastName] = useState(nameParts.slice(1).join(' '))
  const [savingName, setSavingName] = useState(false)

  useEffect(() => { const p = (profile?.full_name ?? '').split(' '); setFirstName(p[0] ?? ''); setLastName(p.slice(1).join(' ')) }, [profile?.full_name])

  // Personal preferences (persisted to profiles.preferences jsonb).
  const savedPrefs = ((profile as unknown as { preferences?: Record<string, string> })?.preferences) ?? {}
  const [prefs, setPrefs] = useState({
    language: savedPrefs.language ?? 'en-GB', timezone: savedPrefs.timezone ?? 'Europe/London',
    temp_unit: savedPrefs.temp_unit ?? 'celsius', date_format: savedPrefs.date_format ?? 'DD/MM/YYYY',
  })
  useEffect(() => {
    const p = ((profile as unknown as { preferences?: Record<string, string> })?.preferences) ?? {}
    setPrefs({ language: p.language ?? 'en-GB', timezone: p.timezone ?? 'Europe/London', temp_unit: p.temp_unit ?? 'celsius', date_format: p.date_format ?? 'DD/MM/YYYY' })
  }, [profile?.id])
  async function savePref(key: keyof typeof prefs, value: string) {
    if (!profile?.id) return
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    const { error } = await supabase.from('profiles').update({ preferences: next }).eq('id', profile.id)
    if (error) { toast.error(error.message); return }
    useAuthStore.getState().setProfile({ ...profile, preferences: next } as typeof profile)
    toast.success('Preference saved')
  }

  const nameChanged = `${firstName} ${lastName}`.trim() !== (profile?.full_name ?? '')
  async function handleSaveName() {
    if (!profile?.id) return
    const full = `${firstName} ${lastName}`.trim()
    setSavingName(true)
    try {
      const { error } = await supabase.from('profiles').update({ full_name: full || null }).eq('id', profile.id)
      if (error) throw error
      useAuthStore.getState().setProfile({ ...profile, full_name: full || null })
      toast.success('Profile updated')
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to update') } finally { setSavingName(false) }
  }

  async function handleSignOut() { await supabase.auth.signOut(); reset(); window.location.href = '/onboarding' }
  async function handleResetPassword() {
    if (!profile?.email) return
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email, { redirectTo: `${window.location.origin}/reset-password` })
    if (error) toast.error(error.message); else toast.success('Password reset link sent to your email')
  }

  const manageSubscriptionMutation = useMutation({
    mutationFn: async () => {
      if (demoMode) throw new Error('Exit demo mode to manage billing — you are browsing the sample business.')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      if (!business?.stripe_customer_id) throw new Error('No Stripe customer yet — subscription is managed once billing is set up.')
      const res = await supabase.functions.invoke('manage-subscription', { headers: { Authorization: `Bearer ${session.access_token}` }, body: { action: 'portal', customerId: business.stripe_customer_id, returnUrl: `${window.location.origin}/settings` } })
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
    <div style={{ maxWidth: CONTENT_WIDTH, margin: '0 auto', fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      {/* horizontal tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #eceef0', marginBottom: 24, overflowX: 'auto' }}>
        {tabs.map((t) => {
          const on = tab === t
          return (
            <button key={t} onClick={() => setTab(t)}
              style={{ position: 'relative', border: 'none', background: 'none', cursor: 'pointer', padding: '11px 13px 13px', font: `600 13.5px 'Geist'`, color: on ? '#16181d' : '#6b7280', whiteSpace: 'nowrap' }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = '#16181d' }} onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = '#6b7280' }}>
              {TAB_LABEL[t]}
              {on && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: '#1f9d63' }} />}
            </button>
          )
        })}
      </div>

      {tab === 'Sites' && <SitesSettings />}
      {tab === 'Team' && <MembersRoles />}
      {tab === 'Notifications' && <NotificationsSettings />}

      {/* ── Profile ── */}
      {tab === 'Profile' && (
        <div>
          <h1 style={PAGE_H1}>Profile</h1>
          <p style={PAGE_SUB}>Your personal details and sign-in settings.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 22 }}>
            {/* Personal details */}
            <div style={{ ...CARD, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 18, borderBottom: '1px solid #f2f3f5', marginBottom: 18 }}>
                <span style={{ width: 52, height: 52, flex: 'none', borderRadius: '50%', background: '#eef7f2', color: '#1f7a52', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 18px 'Geist'" }}>{initialsOf(displayName)}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', font: "700 15px 'Geist'" }}>{displayName}</span>
                  <span style={{ display: 'block', font: "400 12.5px 'Geist'", color: '#9aa0a8', marginTop: 1 }}>{roleLabel}{business?.name ? ` · ${business.name}` : ''}</span>
                </span>
                <button onClick={() => toast('Photo upload is coming soon')} style={{ border: '1px solid #e2e4e8', background: '#fff', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', font: "600 13px 'Geist'", color: '#41464d' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>Change photo</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="First name"><input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={FIELD} onFocus={focusRing} onBlur={blurRing} /></Field>
                <Field label="Last name"><input value={lastName} onChange={(e) => setLastName(e.target.value)} style={FIELD} onFocus={focusRing} onBlur={blurRing} /></Field>
                <Field label="Email"><input value={profile?.email ?? ''} readOnly style={{ ...FIELD, background: '#fafbfb', color: '#6b7280', cursor: 'default' }} /></Field>
                <Field label="Role"><input value={roleLabel} readOnly style={{ ...FIELD, background: '#fafbfb', color: '#6b7280', cursor: 'default' }} /></Field>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button onClick={handleSaveName} disabled={savingName || !nameChanged} style={{ ...GREEN_BTN, opacity: savingName || !nameChanged ? 0.55 : 1 }}
                  onMouseEnter={(e) => { if (!savingName && nameChanged) e.currentTarget.style.background = '#1a8a56' }} onMouseLeave={(e) => (e.currentTarget.style.background = '#1f9d63')}>{savingName ? 'Saving…' : 'Save changes'}</button>
              </div>
            </div>

            {/* Preferences */}
            <div style={{ ...CARD, padding: 20 }}>
              <div style={{ ...MICRO, marginBottom: 14 }}>Preferences</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Language">
                  <select value={prefs.language} onChange={(e) => savePref('language', e.target.value)} style={{ ...FIELD, cursor: 'pointer' }}>
                    <option value="en-GB">English (UK)</option>
                    <option value="en-US">English (US)</option>
                  </select>
                </Field>
                <Field label="Time zone">
                  <select value={prefs.timezone} onChange={(e) => savePref('timezone', e.target.value)} style={{ ...FIELD, cursor: 'pointer' }}>
                    {['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Madrid', 'UTC'].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </Field>
                <Field label="Temperature units">
                  <select value={prefs.temp_unit} onChange={(e) => savePref('temp_unit', e.target.value)} style={{ ...FIELD, cursor: 'pointer' }}>
                    <option value="celsius">Celsius (°C)</option>
                    <option value="fahrenheit">Fahrenheit (°F)</option>
                  </select>
                </Field>
                <Field label="Date format">
                  <select value={prefs.date_format} onChange={(e) => savePref('date_format', e.target.value)} style={{ ...FIELD, cursor: 'pointer' }}>
                    {['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            {/* Demo mode */}
            <div style={{ ...CARD, padding: 20 }}>
              <div style={{ ...MICRO, marginBottom: 6 }}>Demo mode</div>
              <SecurityRow title="Browse sample data" desc="Explore Blueroll as a fully worked sample cafe — checks, temperatures, recipes, the lot. Read-only; your own data stays untouched." last>
                <Switch checked={demoMode} onCheckedChange={(on) => setDemoModeAndReload(on)} />
              </SecurityRow>
            </div>

            {/* Security */}
            <div style={{ ...CARD, padding: 20 }}>
              <div style={{ ...MICRO, marginBottom: 6 }}>Security</div>
              <SecurityRow title="Password" desc="Send yourself a reset link by email">
                <SecBtn onClick={handleResetPassword}>Change password</SecBtn>
              </SecurityRow>
              <SecurityRow title="Two-factor authentication" desc="Adds a code step when signing in">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: "600 11.5px 'Geist'", color: '#6b7280', background: '#eef0f2', padding: '3px 9px', borderRadius: 14 }}>Off</span>
                <SecBtn onClick={() => toast('Two-factor setup is coming soon')}>Manage</SecBtn>
              </SecurityRow>
              <SecurityRow title="Active sessions" desc="Sign out of BlueRoll on this device" last>
                <button onClick={handleSignOut} style={{ border: 'none', background: 'none', font: "600 13px 'Geist'", color: '#c0392b', cursor: 'pointer', padding: '8px 10px', borderRadius: 8 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#fdf3f2')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>Sign out</button>
              </SecurityRow>
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
          <div>
            <h1 style={PAGE_H1}>Billing &amp; subscription</h1>
            <p style={PAGE_SUB}>One simple price — <strong style={{ color: '#16181d', fontWeight: 700 }}>£24.99 per site, per month</strong>. Every site gets everything.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start', marginTop: 22 }}>
              {/* main */}
              <div style={{ flex: '1 1 440px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={CARD}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '15px 20px 13px' }}>
                    <span style={{ font: "700 15px 'Geist'" }}>Your sites</span>
                    <span style={{ font: "600 12px 'Geist'", color: '#8a9099', background: '#f1f2f4', borderRadius: 14, padding: '1px 8px' }}>{siteCount}</span>
                    {showAdminTabs && <button onClick={() => setTab('Sites')} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: '#1f7a52', font: "600 13px 'Geist'", cursor: 'pointer' }}>Manage sites <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} /></button>}
                  </div>
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

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ ...CARD, flex: '1 1 210px', padding: 18 }}>
                    <div style={MICRO}>Payment method</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 12 }}>
                      <span style={{ width: 42, height: 28, borderRadius: 6, background: '#14161b', color: '#fff', font: "700 10px 'Geist'", display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '.05em', flex: 'none' }}>VISA</span>
                      <div style={{ fontSize: 13.5, color: '#41464d' }}>•••• 4242</div>
                      <button onClick={() => manageSubscriptionMutation.mutate()} title="Opens the Stripe customer portal" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: '#1f7a52', font: "600 12.5px 'Geist'", cursor: 'pointer' }}>Change <ExternalLink className="h-3 w-3" /></button>
                    </div>
                  </div>
                  <div style={{ ...CARD, flex: '1 1 210px', padding: 18 }}>
                    <div style={MICRO}>Billing contact</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 12 }}>
                      <div style={{ fontSize: 13.5, color: '#41464d', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.email ?? '—'}</div>
                      <button onClick={() => manageSubscriptionMutation.mutate()} title="Opens the Stripe customer portal" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: '#1f7a52', font: "600 12.5px 'Geist'", cursor: 'pointer', flex: 'none' }}>Edit <ExternalLink className="h-3 w-3" /></button>
                    </div>
                  </div>
                </div>

                <div style={{ ...CARD, padding: 20 }}>
                  <div style={{ font: "700 15px 'Geist'" }}>Invoices</div>
                  <div style={{ fontSize: 12.5, color: '#9aa0a8', marginTop: 4 }}>Billed monthly on the 1st · issued by Stripe.</div>
                  <button onClick={() => manageSubscriptionMutation.mutate()} disabled={manageSubscriptionMutation.isPending} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 15, border: '1px solid #e2e4e8', background: '#fff', color: '#41464d', font: "600 13.5px 'Geist'", padding: '10px 15px', borderRadius: 10, cursor: 'pointer' }}>
                    <CreditCard className="h-4 w-4" strokeWidth={1.8} /> {manageSubscriptionMutation.isPending ? 'Opening…' : 'View & download invoices'} <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {/* rail */}
              <div style={{ flex: '1 1 240px', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 0 }}>
                <div style={{ ...CARD, padding: 18 }}>
                  <div style={MICRO}>Next invoice</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#16181d', marginTop: 9 }}>{nextInvoiceStr}</div>
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <BillRow l={`${siteCount} site${siteCount === 1 ? '' : 's'} × ${gbp(PRICE_PER_SITE)}`} r={gbp(subtotal)} />
                    <BillRow l="VAT (20%)" r={gbp(vat)} muted />
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
          </div>
        )
      })()}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={FIELD_LABEL}>{label}</span>{children}</label>
}
function SecurityRow({ title, desc, children, last }: { title: string; desc: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: last ? '11px 0 2px' : '11px 0', borderBottom: last ? 'none' : '1px solid #f4f5f6' }}>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', font: "600 13.5px 'Geist'" }}>{title}</span>
        <span style={{ display: 'block', font: "400 12.5px 'Geist'", color: '#9aa0a8', marginTop: 1 }}>{desc}</span>
      </span>
      {children}
    </div>
  )
}
function SecBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{ border: '1px solid #e2e4e8', background: '#fff', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', font: "600 13px 'Geist'", color: '#41464d' }}
    onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>{children}</button>
}
function BillRow({ l, r, muted }: { l: string; r: string; muted?: boolean }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: muted ? '#8a9099' : '#41464d' }}>{l}</span><span style={{ color: muted ? '#8a9099' : '#41464d', fontVariantNumeric: 'tabular-nums' }}>{r}</span></div>
}
