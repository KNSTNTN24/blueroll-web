'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Plus, Copy, CheckCircle2, X, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROLE_LABELS, ROLE_COLORS, USER_ROLES, type UserRole } from '@/lib/constants'
import { format } from 'date-fns'

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(' ').filter(Boolean)
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : (parts[0]?.[0] ?? '').toUpperCase()
  }
  return email[0]?.toUpperCase() ?? '?'
}
const AVATAR = ['#1f7a52', '#5b6472', '#8a6d52', '#3f6d8a', '#7a5b6f']
const hasCore = (certs: string[]) => certs.some((c) => /food hygiene/i.test(c)) && certs.some((c) => /allergen/i.test(c))

export default function TeamPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const multiSite = sites.length > 1
  const siteName = (id: string | null) => (id ? (sites.find((s) => s.id === id)?.name ?? 'Site') : 'All sites')

  const [showInvite, setShowInvite] = useState(false)
  const [inviteShown, setInviteShown] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('kitchen_staff')
  const [inviteSite, setInviteSite] = useState<string>('')
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<string>('all') // 'all' or a site id (only used in the all-sites view)

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase.from('profiles').select('*').eq('business_id', business.id).order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const { data: checkins = [] } = useQuery({
    queryKey: ['staff-checkins', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const { data, error } = await supabase.from('staff_checkins').select('*').eq('business_id', business.id).gte('checked_in_at', today.toISOString()).is('checked_out_at', null)
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })
  const checkinMap = new Map(checkins.map((c: any) => [c.user_id, c]))

  // Scope: a specific site (topbar switcher) shows just that site; "All sites" shows everyone with in-page tabs.
  const visible = (members as any[]).filter((m) => {
    if (currentSiteId) return m.site_id === currentSiteId || m.is_group_admin
    if (tab === 'all') return true
    return m.site_id === tab
  })

  const onShiftCount = visible.filter((m) => checkinMap.has(m.id)).length
  const trained = visible.filter((m) => hasCore(m.certifications ?? [])).length
  const gaps = visible.length - trained

  // sites that actually have members (for the tab bar)
  const siteCounts = sites.map((s) => ({ site: s, n: (members as any[]).filter((m) => m.site_id === s.id).length })).filter((x) => x.n > 0)

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_invite', { p_email: inviteEmail, p_role: inviteRole })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.token) throw new Error('Invite created but no token returned')
      // Scope the invite to the chosen site (owner/manager may leave it group-wide)
      if (inviteSite) await supabase.from('invites').update({ site_id: inviteSite }).eq('token', row.token)
      // Email the invite (best-effort — the code still works if delivery fails)
      try {
        await supabase.functions.invoke('send-invite', {
          body: {
            to: inviteEmail.trim(),
            code: row.token,
            groupName: business?.name,
            siteName: sites.find((s) => s.id === inviteSite)?.name,
            inviterName: profile?.full_name,
            appUrl: window.location.origin,
          },
        })
      } catch { /* email is best-effort; code is shown regardless */ }
      return row.token as string
    },
    onSuccess: (token) => { setGeneratedToken(token); queryClient.invalidateQueries({ queryKey: ['team'] }); toast.success('Invite created') },
    onError: (err: Error) => toast.error(err.message || 'Failed to create invite'),
  })
  function openInvite() {
    setInviteEmail(''); setInviteRole('kitchen_staff'); setInviteSite(sites[0]?.id ?? ''); setGeneratedToken(null); setCopied(false)
    setShowInvite(true); requestAnimationFrame(() => setInviteShown(true))
  }
  function resetInvite() { setInviteShown(false); setTimeout(() => setShowInvite(false), 300) }

  const ROLE_OPTS = [
    { label: 'Owner', value: 'owner' },
    { label: 'Site manager', value: 'manager' },
    { label: 'Kitchen staff', value: 'kitchen_staff' },
    { label: 'Front of house', value: 'front_of_house' },
  ]

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[25px] font-bold leading-tight tracking-[-0.02em] text-foreground">Team</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {multiSite ? `People across ${business?.name ?? 'the group'} · ${sites.length} sites` : 'Manage your team members'}
          </p>
        </div>
        {isManager && (
          <button onClick={openInvite}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1f9d63', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, padding: '11px 17px', borderRadius: 11, cursor: 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#1c8e5a')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#1f9d63')}>
            <Plus className="h-4 w-4" strokeWidth={2} /> Invite member
          </button>
        )}
      </div>

      {/* Metric strip */}
      <div className="grid grid-cols-2 divide-y divide-[#eef0f2] overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,.04)] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <Metric label="Members" value={String(visible.length)} />
        <Metric label="On shift now" value={String(onShiftCount)} />
        <Metric label="Training up to date" value={`${trained}/${visible.length}`} />
        <Metric label="Training gaps" value={String(gaps)} amber={gaps > 0} />
      </div>

      {/* Site filter tabs — only in the all-sites view */}
      {multiSite && !currentSiteId && siteCounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <TabPill active={tab === 'all'} onClick={() => setTab('all')}>All {members.length}</TabPill>
          {siteCounts.map(({ site, n }) => (
            <TabPill key={site.id} active={tab === site.id} onClick={() => setTab(site.id)}>{site.name} {n}</TabPill>
          ))}
        </div>
      )}

      {/* Invite slide-over */}
      {showInvite && (
        <div onClick={resetInvite} style={{ position: 'fixed', inset: 0, background: 'rgba(20,22,27,.36)', zIndex: 60, display: 'flex', justifyContent: 'flex-end', opacity: inviteShown ? 1 : 0, transition: 'opacity .3s ease-out' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 440, maxWidth: '92vw', height: '100%', background: '#fff', boxShadow: '-24px 0 64px -32px rgba(16,24,40,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: inviteShown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .3s cubic-bezier(0.32,0.72,0,1)' }}>
            {/* header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #eef0f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#16181d' }}>Invite a team member</h2>
                <div style={{ fontSize: 13, color: '#8a9099', marginTop: 2 }}>{generatedToken ? 'Share this code so they can join' : "They'll get an email with a sign-in link"}</div>
              </div>
              <button onClick={resetInvite} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: '#f1f2f4', color: '#5c626b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X className="h-[17px] w-[17px]" strokeWidth={2} />
              </button>
            </div>

            {/* body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {generatedToken ? (
                <div style={{ border: '1px solid #e7e9ec', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa0a8', marginBottom: 8 }}>Invite code</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{ flex: 1, border: '1px solid #e2e4e8', borderRadius: 8, padding: '10px 12px', fontFamily: 'monospace', fontSize: 15, fontWeight: 600, letterSpacing: '.05em', color: '#1c1f24' }}>{generatedToken}</code>
                    <button onClick={() => { navigator.clipboard.writeText(generatedToken); setCopied(true); toast.success('Copied'); setTimeout(() => setCopied(false), 2000) }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #e2e4e8', background: '#fff', color: '#41464d', fontSize: 13, fontWeight: 600, padding: '10px 12px', borderRadius: 9, cursor: 'pointer' }}>
                      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#41464d', display: 'block', marginBottom: 8 }}>Email <span style={{ color: '#d2453f' }}>*</span></label>
                    <input autoFocus type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@example.com"
                      style={{ width: '100%', background: '#fff', border: '1px solid #e2e4e8', borderRadius: 10, padding: '11px 13px', fontSize: 14, color: '#1c1f24', outline: 'none' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
                  </div>

                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#41464d', display: 'block', marginBottom: 8 }}>Role</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {ROLE_OPTS.map((o) => {
                        const on = inviteRole === o.value
                        return (
                          <button key={o.value} onClick={() => setInviteRole(o.value)}
                            style={{ border: on ? '1.5px solid #1f9d63' : '1px solid #e2e4e8', background: on ? '#f5faf7' : '#fff', color: on ? '#1a6e49' : '#5c626b', fontSize: 13, fontWeight: 600, padding: 10, borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            {o.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#41464d', display: 'block', marginBottom: 8 }}>Site</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {sites.map((s) => {
                        const on = inviteSite === s.id
                        return (
                          <button key={s.id} onClick={() => setInviteSite(s.id)}
                            style={{ border: on ? '1.5px solid #1f9d63' : '1px solid #e2e4e8', background: on ? '#f5faf7' : '#fff', color: on ? '#1a6e49' : '#5c626b', fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            {s.name}
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ fontSize: 12, color: '#9aa0a8', marginTop: 8 }}>Site managers and staff see only their site. Owners see the whole estate.</div>
                  </div>
                </>
              )}
            </div>

            {/* footer */}
            <div style={{ display: 'flex', gap: 10, padding: '16px 24px', borderTop: '1px solid #eef0f2' }}>
              {generatedToken ? (
                <button onClick={resetInvite} style={{ flex: 1, background: '#1f9d63', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, padding: 11, borderRadius: 11, cursor: 'pointer' }}>Done</button>
              ) : (
                <>
                  <button onClick={resetInvite} style={{ flex: 1, background: '#fff', border: '1px solid #e2e4e8', color: '#5c626b', fontSize: 14, fontWeight: 600, padding: 11, borderRadius: 11, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={() => inviteMutation.mutate()} disabled={!inviteEmail.includes('@') || inviteMutation.isPending}
                    style={{ flex: 1.4, background: inviteEmail.includes('@') ? '#1f9d63' : '#cfe6da', border: 'none', color: inviteEmail.includes('@') ? '#fff' : '#8fb9a4', fontSize: 14, fontWeight: 600, padding: 11, borderRadius: 11, cursor: inviteEmail.includes('@') ? 'pointer' : 'not-allowed' }}>
                    {inviteMutation.isPending ? 'Sending…' : 'Send invite'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Members table */}
      <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        {isLoading ? (
          <div className="p-12 text-center text-[14px] text-muted-foreground">Loading team…</div>
        ) : visible.length === 0 ? (
          <div className="p-[50px] text-center text-[14px] text-[#9aa0a8]">No team members in this view.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  <th className="px-4 py-2.5">Member</th>
                  {multiSite && <th className="px-3 py-2.5">Site</th>}
                  <th className="px-3 py-2.5">Food-safety training</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Last active</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m: any, i: number) => {
                  const ci = checkinMap.get(m.id) as any
                  const onShift = !!ci
                  const you = m.id === profile?.id
                  return (
                    <tr key={m.id} className="border-b border-[#f2f3f5] transition-colors last:border-0 hover:bg-[#fafbfb]">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: AVATAR[i % AVATAR.length] }}>{getInitials(m.full_name, m.email)}</span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate font-semibold text-foreground">{m.full_name || 'Unnamed'}</span>
                              {you && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">YOU</span>}
                            </span>
                            <span className="block text-[11.5px] text-muted-foreground">{ROLE_LABELS[m.role as UserRole] ?? m.role}</span>
                          </span>
                        </span>
                      </td>
                      {multiSite && (
                        <td className="px-3 py-3">
                          <span className={cn('text-[13px]', m.site_id ? 'text-[#41464d]' : 'font-medium text-brand-deep')}>{siteName(m.site_id)}</span>
                        </td>
                      )}
                      <td className="px-3 py-3">
                        <span className="flex flex-wrap gap-1">
                          {(m.certifications ?? []).length === 0 ? <span className="text-[12px] text-[#b0b5bc]">—</span> : (m.certifications as string[]).map((c) => (
                            <span key={c} className="inline-flex items-center gap-1 rounded-md bg-brand-tint px-1.5 py-0.5 text-[11px] font-medium text-brand-deep">
                              <ShieldCheck className="h-3 w-3" strokeWidth={2} />{c}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {onShift ? (
                          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-deep"><span className="h-1.5 w-1.5 rounded-full bg-brand" /> On shift</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-[#c2c6cc]" /> Off</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12.5px] text-muted-foreground">
                        {onShift ? `Since ${format(new Date(ci.checked_in_at), 'HH:mm')}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-[22px] font-bold tabular-nums leading-none', amber ? 'text-amber' : 'text-foreground')}>{value}</p>
    </div>
  )
}

function TabPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium transition-colors',
      active ? 'bg-foreground text-white' : 'border border-input bg-card text-[#5c626b] hover:bg-accent')}>{children}</button>
  )
}
