'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { USER_ROLES, ROLE_LABELS, type UserRole } from '@/lib/constants'

interface Member {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole | null
  site_id: string | null
  is_group_admin: boolean | null
}

const TILE = ['#1f7a52', '#5b6472', '#8a6d52', '#4e6e81']
const initials = (n: string | null, e: string | null) => {
  const s = n || e || '?'
  const p = s.split(' ').filter(Boolean)
  return (p.length >= 2 ? p[0][0] + p[1][0] : s.slice(0, 2)).toUpperCase()
}

export function MembersRoles() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const me = useAuthStore((s) => s.profile)
  const qc = useQueryClient()
  const bid = business?.id
  const [savingId, setSavingId] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('kitchen_staff')

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

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    const { data, error } = await supabase.rpc('create_invite', { p_email: inviteEmail.trim(), p_role: inviteRole })
    if (error) { toast.error(error.message); return }
    toast.success(`Invite created${data ? ` · code ${data}` : ''}`)
    setInviteEmail(''); setInviting(false)
  }

  const pillSelect: React.CSSProperties = { appearance: 'none', WebkitAppearance: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 20, background: '#f1f2f4', color: '#41464d', flex: 'none' }
  const accessSelect: React.CSSProperties = { appearance: 'none', WebkitAppearance: 'none', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 500, color: '#5c626b', textAlign: 'right', flex: 'none', minWidth: 110, direction: 'rtl' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-.01em', color: '#16181d' }}>Members &amp; roles</h1>
          <div style={{ color: '#6b7280', fontSize: 13.5, marginTop: 4 }}>Who can see what — access is per site, roles are per person</div>
        </div>
        <button onClick={() => setInviting((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', background: '#1f9d63', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, padding: '11px 17px', borderRadius: 11, cursor: 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#1c8e5a')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#1f9d63')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Invite member
        </button>
      </div>

      {inviting && (
        <div style={{ display: 'flex', gap: 8, background: '#fff', border: '1px solid #e9eaed', borderRadius: 12, padding: 12 }}>
          <input autoFocus value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendInvite()}
            placeholder="colleague@email.com" style={{ flex: 1, border: '1px solid #e2e4e8', borderRadius: 9, padding: '9px 12px', fontSize: 13.5, outline: 'none' }} />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)} style={{ border: '1px solid #e2e4e8', borderRadius: 9, padding: '9px 10px', fontSize: 13.5 }}>
            {USER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <button onClick={sendInvite} disabled={!inviteEmail.trim()} style={{ background: '#1f9d63', border: 'none', color: '#fff', fontSize: 13.5, fontWeight: 600, padding: '9px 15px', borderRadius: 9, cursor: 'pointer', opacity: inviteEmail.trim() ? 1 : 0.5 }}>Send</button>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)', overflow: 'hidden' }}>
        {members.map((m, i) => {
          const busy = savingId === m.id
          const isOwner = m.role === 'owner'
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 20px', borderBottom: i === members.length - 1 ? 'none' : '1px solid #f2f3f5' }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flex: 'none', background: TILE[i % TILE.length] }}>{initials(m.full_name, m.email)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.full_name || m.email || 'Unknown'}{m.id === me?.id && <span style={{ color: '#9aa0a8', fontWeight: 500 }}> (you)</span>}
                </div>
                <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</div>
              </div>
              <select value={m.role ?? ''} disabled={busy} onChange={(e) => patch(m.id, { role: e.target.value })}
                style={{ ...pillSelect, background: isOwner ? '#16181d' : '#f1f2f4', color: isOwner ? '#fff' : '#41464d', opacity: busy ? 0.5 : 1 }}>
                {USER_ROLES.map((r) => <option key={r} value={r} style={{ color: '#16181d', background: '#fff' }}>{ROLE_LABELS[r]}</option>)}
              </select>
              <select value={m.is_group_admin ? '__all' : (m.site_id ?? '')} disabled={busy}
                onChange={(e) => { const v = e.target.value; if (v === '__all') patch(m.id, { is_group_admin: true }); else patch(m.id, { is_group_admin: false, site_id: v || null }) }}
                style={{ ...accessSelect, opacity: busy ? 0.5 : 1 }}>
                <option value="__all" style={{ direction: 'ltr' }}>All sites</option>
                {sites.map((s) => <option key={s.id} value={s.id} style={{ direction: 'ltr' }}>{s.name}</option>)}
              </select>
            </div>
          )
        })}
        {members.length === 0 && <p style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#8a9099' }}>No members yet.</p>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f5f6f7', border: '1px solid #eceef0', borderRadius: 12, padding: '12px 15px' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa0a8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><circle cx="12" cy="8" r="0.8" fill="#9aa0a8" /></svg>
        <span style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.5 }}>Owners and estate managers see every site. Site managers and staff see only the sites they&apos;re assigned to — the site switcher shows just those.</span>
      </div>
    </div>
  )
}
