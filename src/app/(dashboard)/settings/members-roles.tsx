'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Plus, X, Copy, CheckCircle2 } from 'lucide-react'
import { USER_ROLES, ROLE_LABELS, type UserRole } from '@/lib/constants'

interface Member {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole | null
  site_id: string | null
  is_group_admin: boolean | null
}

const AVATARS: [string, string][] = [['#e9f6ef', '#1f7a52'], ['#e4edfb', '#3f6bc4'], ['#fbf3e6', '#b07d1e'], ['#f1f0f4', '#6b6580'], ['#eef2f6', '#4e6e81']]
const initials = (n: string | null, e: string | null) => { const s = n || e || '?'; const p = s.split(' ').filter(Boolean); return (p.length >= 2 ? p[0][0] + p[1][0] : s.slice(0, 2)).toUpperCase() }
function rolePill(role: UserRole | null): { bg: string; ink: string } {
  if (role === 'owner') return { bg: '#e9f6ef', ink: '#1f7a52' }
  if (role && /manager/.test(role)) return { bg: '#e4edfb', ink: '#3f6bc4' }
  return { bg: '#eef0f2', ink: '#6b7280' }
}

export function MembersRoles() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const me = useAuthStore((s) => s.profile)
  const qc = useQueryClient()
  const bid = business?.id
  const [savingId, setSavingId] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)

  const { data: members = [] } = useQuery({
    queryKey: ['members-roles', bid],
    enabled: !!bid,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, email, role, site_id, is_group_admin').eq('business_id', bid!).order('full_name')
      return (data ?? []) as Member[]
    },
  })

  async function patch(id: string, p: Record<string, unknown>) {
    setSavingId(id)
    const { error } = await supabase.from('profiles').update(p).eq('id', id)
    setSavingId(null)
    if (error) { toast.error(error.message); return }
    toast.success('Updated')
    qc.invalidateQueries({ queryKey: ['members-roles', bid] })
    qc.invalidateQueries({ queryKey: ['sites-members', bid] })
  }

  const pillSelect: React.CSSProperties = { appearance: 'none', WebkitAppearance: 'none', border: 'none', cursor: 'pointer', font: "600 12px 'Geist'", padding: '4px 12px', borderRadius: 14, textAlign: 'center', textAlignLast: 'center', flex: 'none' }
  const siteSelect: React.CSSProperties = { appearance: 'none', WebkitAppearance: 'none', border: 'none', background: 'none', cursor: 'pointer', font: "500 12.5px 'Geist'", color: '#6b7280', textAlign: 'right', width: 130, direction: 'rtl' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: '#16181d' }}>Team</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: '#6b7280' }}>Unlimited team members on every plan — invite your whole kitchen.</p>
        </div>
        <button onClick={() => setInviteOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: '#1f9d63', color: '#fff', borderRadius: 10, padding: '9px 16px', cursor: 'pointer', font: "600 13.5px 'Geist'", whiteSpace: 'nowrap' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#1a8a56')} onMouseLeave={(e) => (e.currentTarget.style.background = '#1f9d63')}>
          <Plus className="h-[13px] w-[13px]" strokeWidth={2.4} /> Invite member
        </button>
      </div>

      {/* members */}
      <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)', overflow: 'hidden', marginTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 20px 13px' }}>
          <span style={{ font: "700 15px 'Geist'", letterSpacing: '-.01em' }}>Members</span>
          <span style={{ font: "600 12px 'Geist'", color: '#8a9099', background: '#f1f2f4', padding: '3px 9px', borderRadius: 14 }}>{members.length}</span>
          <span style={{ marginLeft: 'auto', font: "500 12px 'Geist'", color: '#9aa0a8' }}>roles control what each member can see and sign off</span>
        </div>
        {members.map((m, i) => {
          const busy = savingId === m.id
          const rp = rolePill(m.role)
          const [abg, aink] = AVATARS[i % AVATARS.length]
          return (
            <div key={m.id} className="tm-row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 20px', borderTop: '1px solid #f4f5f6', transition: 'background .14s' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ width: 34, height: 34, flex: 'none', borderRadius: '50%', background: abg, color: aink, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 12.5px 'Geist'" }}>{initials(m.full_name, m.email)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: "600 13.5px 'Geist'", color: '#16181d', whiteSpace: 'nowrap' }}>
                  {m.full_name || m.email || 'Unknown'}
                  {m.id === me?.id && <span style={{ font: "600 10.5px 'Geist'", color: '#8a9099', background: '#f1f2f4', padding: '2px 7px', borderRadius: 10 }}>YOU</span>}
                </span>
                <span style={{ display: 'block', font: "400 12px 'Geist'", color: '#9aa0a8', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</span>
              </span>
              <select value={m.is_group_admin ? '__all' : (m.site_id ?? '')} disabled={busy}
                onChange={(e) => { const v = e.target.value; if (v === '__all') patch(m.id, { is_group_admin: true }); else patch(m.id, { is_group_admin: false, site_id: v || null }) }}
                style={{ ...siteSelect, opacity: busy ? 0.5 : 1 }} title="Site access">
                <option value="__all" style={{ direction: 'ltr' }}>All sites</option>
                {sites.map((s) => <option key={s.id} value={s.id} style={{ direction: 'ltr' }}>{s.name}</option>)}
              </select>
              <select value={m.role ?? ''} disabled={busy} onChange={(e) => patch(m.id, { role: e.target.value })}
                style={{ ...pillSelect, background: rp.bg, color: rp.ink, opacity: busy ? 0.5 : 1 }} title="Role">
                {USER_ROLES.map((r) => <option key={r} value={r} style={{ color: '#16181d', background: '#fff' }}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
          )
        })}
        {members.length === 0 && <p style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#8a9099' }}>No members yet.</p>}
      </div>

      {/* roles explainer */}
      <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)', padding: 20, marginTop: 14 }}>
        <div style={{ font: "600 11px 'Geist'", letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a9099', marginBottom: 13 }}>What each role can do</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
          {[
            { label: 'Owner', bg: '#e9f6ef', ink: '#1f7a52', desc: 'Everything, including billing, sites and team management.' },
            { label: 'Manager', bg: '#e4edfb', ink: '#3f6bc4', desc: 'Runs their site: checklists, recipes, reports, sign-offs, team invites.' },
            { label: 'Staff', bg: '#eef0f2', ink: '#6b7280', desc: 'Completes checks and logs temperatures. No settings access.' },
          ].map((r) => (
            <div key={r.label}>
              <span style={{ font: "600 12px 'Geist'", color: r.ink, background: r.bg, padding: '4px 11px', borderRadius: 14 }}>{r.label}</span>
              <p style={{ margin: '9px 0 0', font: "400 12.5px/1.55 'Geist'", color: '#6b7280' }}>{r.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {inviteOpen && <InviteSlideOver sites={sites} onClose={() => setInviteOpen(false)} />}

      <style>{`.tm-row select:hover{filter:brightness(0.97)}`}</style>
    </div>
  )
}

// ── Invite slide-over (mirrors the main Team page) ──────────────────
const ROLE_OPTS = [
  { label: 'Site manager', value: 'manager' },
  { label: 'Kitchen staff', value: 'kitchen_staff' },
  { label: 'Front of house', value: 'front_of_house' },
]

function InviteSlideOver({ sites, onClose }: { sites: { id: string; name: string }[]; onClose: () => void }) {
  const business = useAuthStore((s) => s.business)
  const profile = useAuthStore((s) => s.profile)
  const qc = useQueryClient()
  const bid = business?.id
  const [shown, setShown] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('kitchen_staff')
  const [siteId, setSiteId] = useState<string>(sites[0]?.id ?? '')
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t) }, [])
  function close() { setShown(false); setTimeout(onClose, 300) }

  const invite = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_invite', { p_email: email, p_role: role })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.token) throw new Error('Invite created but no token returned')
      if (siteId) await supabase.from('invites').update({ site_id: siteId }).eq('token', row.token)
      try {
        await supabase.functions.invoke('send-invite', {
          body: { to: email.trim(), code: row.token, groupName: business?.name, siteName: sites.find((s) => s.id === siteId)?.name, inviterName: profile?.full_name, appUrl: window.location.origin },
        })
      } catch { /* email is best-effort; code is shown regardless */ }
      return row.token as string
    },
    onSuccess: (tok) => { setToken(tok); qc.invalidateQueries({ queryKey: ['members-roles', bid] }); toast.success('Invite created') },
    onError: (err: Error) => toast.error(err.message || 'Failed to create invite'),
  })

  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#41464d', display: 'block', marginBottom: 8 }

  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(20,22,27,.36)', zIndex: 60, display: 'flex', justifyContent: 'flex-end', opacity: shown ? 1 : 0, transition: 'opacity .3s ease-out' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '92vw', height: '100%', background: '#fff', boxShadow: '-24px 0 64px -32px rgba(16,24,40,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: shown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .3s cubic-bezier(0.32,0.72,0,1)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #eef0f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#16181d' }}>Invite a team member</h2>
            <div style={{ fontSize: 13, color: '#8a9099', marginTop: 2 }}>{token ? 'Share this code so they can join' : "They'll get an email with a sign-in link"}</div>
          </div>
          <button onClick={close} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: '#f1f2f4', color: '#5c626b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X className="h-[17px] w-[17px]" strokeWidth={2} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {token ? (
            <div style={{ border: '1px solid #e7e9ec', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa0a8', marginBottom: 8 }}>Invite code</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ flex: 1, border: '1px solid #e2e4e8', borderRadius: 8, padding: '10px 12px', fontFamily: 'monospace', fontSize: 15, fontWeight: 600, letterSpacing: '.05em', color: '#1c1f24' }}>{token}</code>
                <button onClick={() => { navigator.clipboard.writeText(token); setCopied(true); toast.success('Copied'); setTimeout(() => setCopied(false), 2000) }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #e2e4e8', background: '#fff', color: '#41464d', fontSize: 13, fontWeight: 600, padding: '10px 12px', borderRadius: 9, cursor: 'pointer' }}>
                  {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label style={label}>Email <span style={{ color: '#d2453f' }}>*</span></label>
                <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com"
                  style={{ width: '100%', background: '#fff', border: '1px solid #e2e4e8', borderRadius: 10, padding: '11px 13px', fontSize: 14, color: '#1c1f24', outline: 'none' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
              </div>
              <div>
                <label style={label}>Role</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {ROLE_OPTS.map((o) => {
                    const on = role === o.value
                    return (
                      <button key={o.value} onClick={() => setRole(o.value)}
                        style={{ flex: 1, border: on ? '1.5px solid #1f9d63' : '1px solid #e2e4e8', background: on ? '#f5faf7' : '#fff', color: on ? '#1a6e49' : '#5c626b', fontSize: 13, fontWeight: 600, padding: 10, borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>{o.label}</button>
                    )
                  })}
                </div>
              </div>
              {sites.length > 0 && (
                <div>
                  <label style={label}>Site</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {sites.map((s) => {
                      const on = siteId === s.id
                      return (
                        <button key={s.id} onClick={() => setSiteId(s.id)}
                          style={{ border: on ? '1.5px solid #1f9d63' : '1px solid #e2e4e8', background: on ? '#f5faf7' : '#fff', color: on ? '#1a6e49' : '#5c626b', fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>{s.name}</button>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: 12, color: '#9aa0a8', marginTop: 8 }}>Site managers and staff see only their site. Owners see the whole estate.</div>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '16px 24px', borderTop: '1px solid #eef0f2' }}>
          {token ? (
            <button onClick={close} style={{ flex: 1, background: '#1f9d63', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, padding: 11, borderRadius: 11, cursor: 'pointer' }}>Done</button>
          ) : (
            <>
              <button onClick={close} style={{ flex: 1, background: '#fff', border: '1px solid #e2e4e8', color: '#5c626b', fontSize: 14, fontWeight: 600, padding: 11, borderRadius: 11, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => invite.mutate()} disabled={!email.includes('@') || invite.isPending}
                style={{ flex: 1.4, background: email.includes('@') ? '#1f9d63' : '#cfe6da', border: 'none', color: email.includes('@') ? '#fff' : '#8fb9a4', fontSize: 14, fontWeight: 600, padding: 11, borderRadius: 11, cursor: email.includes('@') ? 'pointer' : 'not-allowed' }}>
                {invite.isPending ? 'Sending…' : 'Send invite'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
