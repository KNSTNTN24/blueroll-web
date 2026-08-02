'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Plus, X, Copy, CheckCircle2, ChevronRight, ChevronDown, UserPlus, Info } from 'lucide-react'
import { ROLE_LABELS, type UserRole } from '@/lib/constants'
import { CAPS, CAP_LABEL, CAP_DESC, CAP_GROUPS, PRESET_CAPS, PRESET_ORDER, roleTint, monogram, capSummary, type Cap } from '@/lib/permissions'

interface Member {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole | null
  role_id: string | null
  site_id: string | null
  is_group_admin: boolean | null
}

interface Role {
  id: string
  name: string
  base_tier: string
  capabilities: string[]
  is_system: boolean
}

const MEMBER_COLORS = ['#2b8f86', '#b07d1e', '#5c6472', '#3f6bc4', '#8a6d52', '#1f7a52']
const initials = (n: string | null, e: string | null) => { const s = n || e || '?'; const p = s.split(' ').filter(Boolean); return (p.length >= 2 ? p[0][0] + p[1][0] : s.slice(0, 2)).toUpperCase() }

export function MembersRoles() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const me = useAuthStore((s) => s.profile)
  const qc = useQueryClient()
  const bid = business?.id
  const [tab, setTab] = useState<'members' | 'roles'>('members')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'edit'; role: Role } | null>(null)

  const { data: members = [] } = useQuery({
    queryKey: ['members-roles', bid],
    enabled: !!bid,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, email, role, role_id, site_id, is_group_admin').eq('business_id', bid!).order('full_name')
      return (data ?? []) as Member[]
    },
  })

  const { data: roles = [] } = useQuery({
    queryKey: ['roles', bid],
    enabled: !!bid,
    queryFn: async () => {
      const { data } = await supabase.from('roles').select('id, name, base_tier, capabilities, is_system').eq('business_id', bid!)
      return (data ?? []) as Role[]
    },
  })

  // Presets first, in canonical order; custom roles after, oldest first.
  const roleList = useMemo(() => {
    const rank = (r: Role) => (r.is_system ? PRESET_ORDER.indexOf(r.base_tier as UserRole) : 99)
    return [...roles].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [roles])

  // Assignment still rides on profiles.role; role_id wins once it is set.
  const memberCount = (r: Role) => members.filter((m) => (m.role_id ? m.role_id === r.id : r.is_system && m.role === r.base_tier)).length
  const roleFor = (m: Member) => roleList.find((r) => (m.role_id ? r.id === m.role_id : r.is_system && r.base_tier === m.role))

  async function patch(id: string, p: Record<string, unknown>) {
    setSavingId(id)
    const { error } = await supabase.from('profiles').update(p).eq('id', id)
    setSavingId(null)
    if (error) { toast.error(error.message); return }
    toast.success('Updated')
    qc.invalidateQueries({ queryKey: ['members-roles', bid] })
    qc.invalidateQueries({ queryKey: ['sites-members', bid] })
  }

  const onRoles = tab === 'roles'
  const segActive: React.CSSProperties = { font: "600 13px 'Geist'", color: '#1c1f24', background: '#fff', padding: '8px 16px', borderRadius: 8, boxShadow: '0 1px 2px rgba(16,24,40,.08)', border: 'none' }
  const segIdle: React.CSSProperties = { font: "600 13px 'Geist'", color: '#5c626b', background: 'none', padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer' }
  const siteSelect: React.CSSProperties = { appearance: 'none', WebkitAppearance: 'none', border: 'none', background: 'none', cursor: 'pointer', font: "500 12.5px 'Geist'", color: '#6b7280', textAlign: 'right', width: 120, direction: 'rtl' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: '#16181d' }}>Team</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: '#6b7280' }}>Members and the roles that control what each of them can see and sign off.</p>
        </div>
        {onRoles ? (
          <button onClick={() => setDrawer({ mode: 'new' })}
            style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', background: '#1f9d63', border: 'none', color: '#fff', font: "600 13.5px 'Geist'", padding: '11px 16px', borderRadius: 11, cursor: 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#1c8e5a')} onMouseLeave={(e) => (e.currentTarget.style.background = '#1f9d63')}>
            <Plus className="h-[15px] w-[15px]" strokeWidth={2.4} />New role
          </button>
        ) : (
          <button onClick={() => setInviteOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', background: '#1f9d63', border: 'none', color: '#fff', font: "600 13.5px 'Geist'", padding: '11px 16px', borderRadius: 11, cursor: 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#1c8e5a')} onMouseLeave={(e) => (e.currentTarget.style.background = '#1f9d63')}>
            <UserPlus className="h-[16px] w-[16px]" strokeWidth={2} />Invite member
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 3, background: '#eceef1', padding: 4, borderRadius: 11, marginTop: 20, width: 'max-content' }}>
        <button onClick={() => setTab('members')} style={onRoles ? segIdle : segActive}>
          Members <span style={{ color: onRoles ? '#b8bdc4' : '#9aa0a8' }}>{members.length}</span>
        </button>
        <button onClick={() => setTab('roles')} style={onRoles ? segActive : segIdle}>
          Roles <span style={{ color: onRoles ? '#9aa0a8' : '#b8bdc4' }}>{roles.length}</span>
        </button>
      </div>

      {/* ── MEMBERS ── */}
      {!onRoles && (
        <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)', overflow: 'hidden', marginTop: 18 }}>
          {members.map((m, i) => {
            const busy = savingId === m.id
            const r = roleFor(m)
            const tint = r ? roleTint(r, roleList.filter((x) => !x.is_system).indexOf(r)) : { ink: '#6b7280', bg: '#eef0f2' }
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 20px', borderBottom: '1px solid #f4f5f6', transition: 'background .14s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ width: 36, height: 36, borderRadius: '50%', flex: 'none', background: MEMBER_COLORS[i % MEMBER_COLORS.length], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 12.5px 'Geist'" }}>{initials(m.full_name, m.email)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: "600 14px 'Geist'", color: '#16181d', whiteSpace: 'nowrap' }}>
                    {m.full_name || m.email || 'Unknown'}
                    {m.id === me?.id && <span style={{ font: "600 10px 'Geist'", letterSpacing: '.04em', textTransform: 'uppercase', color: '#1a6e49', background: '#eaf4ee', padding: '2px 6px', borderRadius: 5 }}>You</span>}
                  </span>
                  <span style={{ display: 'block', font: "400 12.5px 'Geist'", color: '#9aa0a8', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</span>
                </span>
                <select value={m.is_group_admin ? '__all' : (m.site_id ?? '')} disabled={busy}
                  onChange={(e) => { const v = e.target.value; if (v === '__all') patch(m.id, { is_group_admin: true }); else patch(m.id, { is_group_admin: false, site_id: v || null }) }}
                  style={{ ...siteSelect, opacity: busy ? 0.5 : 1 }} title="Site access">
                  <option value="__all" style={{ direction: 'ltr' }}>All sites</option>
                  {sites.map((s) => <option key={s.id} value={s.id} style={{ direction: 'ltr' }}>{s.name}</option>)}
                </select>
                <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flex: 'none', opacity: busy ? 0.5 : 1 }}>
                  {/* Assign by role_id: that is what has_capability() reads. A trigger
                      syncs profiles.role from the role's base_tier, so writing the
                      text here instead would relabel without changing any access. */}
                  <select value={r?.id ?? ''} disabled={busy} onChange={(e) => patch(m.id, { role_id: e.target.value })} title="Role"
                    style={{ appearance: 'none', WebkitAppearance: 'none', border: 'none', cursor: 'pointer', font: "600 12px 'Geist'", padding: '5px 27px 5px 11px', borderRadius: 14, minWidth: 118, textAlign: 'center', textAlignLast: 'center', color: tint.ink, background: tint.bg }}>
                    {!r && <option value="">No role</option>}
                    {roleList.map((ro) => <option key={ro.id} value={ro.id} style={{ color: '#16181d', background: '#fff' }}>{ro.name}</option>)}
                  </select>
                  <ChevronDown className="h-3 w-3" strokeWidth={2} style={{ position: 'absolute', right: 10, pointerEvents: 'none', color: tint.ink }} />
                </span>
              </div>
            )
          })}
          {members.length === 0 && <p style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#8a9099' }}>No members yet.</p>}
        </div>
      )}

      {/* ── ROLES ── */}
      {onRoles && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
          {roleList.map((r) => {
            const tint = roleTint(r, roleList.filter((x) => !x.is_system).indexOf(r))
            const count = CAPS.filter((c) => r.capabilities.includes(c)).length
            return (
              <div key={r.id} onClick={() => setDrawer({ mode: 'edit', role: r })}
                style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 14, boxShadow: '0 1px 2px rgba(16,24,40,.03)', padding: '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 15, transition: 'border-color .14s, box-shadow .14s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#dfe1e5'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(16,24,40,.03),0 12px 28px -22px rgba(16,24,40,.22)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e9eaed'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(16,24,40,.03)' }}>
                <span style={{ width: 40, height: 40, borderRadius: 11, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: tint.bg, color: tint.ink, font: "700 14px 'Geist'" }}>{monogram(r.name)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ font: "700 15px 'Geist'", color: '#1c1f24' }}>{r.name}</span>
                    {r.is_system && <span style={{ font: "600 9px 'Geist'", letterSpacing: '.05em', color: '#a3a8b0', background: '#f1f2f4', padding: '3px 6px', borderRadius: 5 }}>PRESET</span>}
                  </div>
                  <div style={{ font: "500 12.5px 'Geist'", color: '#9aa0a8', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 520 }}>{capSummary(r.capabilities)}</div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div style={{ font: "600 13px 'Geist'", color: '#41464d', fontVariantNumeric: 'tabular-nums' }}>{count}<span style={{ color: '#c2c6cc' }}>/14</span></div>
                  <div style={{ font: "500 11.5px 'Geist'", color: '#a3a8b0', marginTop: 2 }}>{memberCount(r)} members</div>
                </div>
                <span style={{ display: 'flex', color: '#c2c6cc', flex: 'none' }}><ChevronRight className="h-[18px] w-[18px]" strokeWidth={1.8} /></span>
              </div>
            )
          })}
          {roleList.length === 0 && <p style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#8a9099' }}>No roles yet.</p>}
        </div>
      )}

      {inviteOpen && <InviteSlideOver sites={sites} roles={roleList} onClose={() => setInviteOpen(false)} />}
      {drawer && <RoleDrawer key={drawer.mode === 'edit' ? drawer.role.id : 'new'} state={drawer} roles={roleList} onClose={() => setDrawer(null)} />}
    </div>
  )
}

// ── Role drawer (new / edit) ────────────────────────────────────────
function RoleDrawer({ state, roles, onClose }: { state: { mode: 'new' } | { mode: 'edit'; role: Role }; roles: Role[]; onClose: () => void }) {
  const business = useAuthStore((s) => s.business)
  const qc = useQueryClient()
  const bid = business?.id
  const isEdit = state.mode === 'edit'
  const editing = isEdit ? state.role : null

  const [shown, setShown] = useState(false)
  const [name, setName] = useState(editing?.name ?? '')
  const [perms, setPerms] = useState<Set<string>>(new Set(editing?.capabilities ?? []))
  const [base, setBase] = useState<UserRole | ''>('')

  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t) }, [])
  function close() { setShown(false); setTimeout(onClose, 260) }

  const nameTaken = roles.some((r) => r.name.toLowerCase() === name.trim().toLowerCase() && r.id !== editing?.id)
  const canSave = name.trim().length > 0 && !nameTaken
  const count = CAPS.filter((c) => perms.has(c)).length

  const toggle = (c: Cap) => setPerms((p) => { const n = new Set(p); if (n.has(c)) n.delete(c); else n.add(c); return n })
  const pickBase = (t: UserRole) => { setBase(t); setPerms(new Set(PRESET_CAPS[t])) }

  const save = useMutation({
    mutationFn: async () => {
      const capabilities = CAPS.filter((c) => perms.has(c))
      if (isEdit) {
        const { error } = await supabase.from('roles').update({ name: name.trim(), capabilities }).eq('id', editing!.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('roles').insert({ business_id: bid, name: name.trim(), base_tier: base || 'kitchen_staff', capabilities, is_system: false })
        if (error) throw error
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles', bid] }); toast.success(isEdit ? 'Role updated' : 'Role created'); close() },
    onError: (e: Error) => toast.error(e.message),
  })

  const del = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('roles').delete().eq('id', editing!.id); if (error) throw error },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles', bid] }); toast.success('Role deleted'); close() },
    onError: (e: Error) => toast.error(e.message),
  })

  const busy = save.isPending || del.isPending

  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(20,22,27,.4)', zIndex: 60, display: 'flex', justifyContent: 'flex-end', opacity: shown ? 1 : 0, transition: 'opacity .26s ease-out' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 468, maxWidth: '94vw', height: '100%', background: '#fff', boxShadow: '-24px 0 64px -32px rgba(16,24,40,.45)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: shown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .26s cubic-bezier(.22,.61,.36,1)' }}>
        <div style={{ padding: '22px 24px 18px', borderBottom: '1px solid #eef0f2', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-.01em', color: '#16181d' }}>{isEdit ? `Edit ${editing!.name}` : 'New role'}</h2>
            <div style={{ fontSize: 13, color: '#8a9099', marginTop: 3 }}>{isEdit ? 'Rename or change what this role can do' : 'Start from a preset and adjust capabilities'}</div>
          </div>
          <button onClick={close} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: '#f1f2f4', color: '#5c626b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#e7e9ec')} onMouseLeave={(e) => (e.currentTarget.style.background = '#f1f2f4')}>
            <X className="h-[17px] w-[17px]" strokeWidth={2} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 8px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label style={{ font: "600 12.5px 'Geist'", color: '#41464d', display: 'block', marginBottom: 8 }}>Name <span style={{ color: '#d2453f' }}>*</span></label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Head Chef"
              style={{ width: '100%', border: '1px solid #e2e4e8', borderRadius: 10, padding: '11px 13px', font: "500 14px 'Geist'", color: '#16181d', outline: 'none' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
            {nameTaken && <div style={{ font: "500 12px 'Geist'", color: '#c0403a', marginTop: 6 }}>A role with this name already exists.</div>}
          </div>

          {!isEdit && (
            <div>
              <label style={{ font: "600 12.5px 'Geist'", color: '#41464d', display: 'block', marginBottom: 8 }}>Start from a preset</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {PRESET_ORDER.map((t) => {
                  const on = base === t
                  return (
                    <button key={t} onClick={() => pickBase(t)}
                      style={{ border: on ? '1.5px solid #1f9d63' : '1px solid #e2e4e8', background: on ? '#f5faf7' : '#fff', color: on ? '#1a6e49' : '#5c626b', font: "600 12.5px 'Geist'", padding: '8px 13px', borderRadius: 10, cursor: 'pointer' }}>
                      {ROLE_LABELS[t]}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {isEdit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fbf7ee', border: '1px solid #f2e6cf', borderRadius: 11, padding: '11px 14px' }}>
              <Info className="h-4 w-4" strokeWidth={1.9} style={{ flex: 'none', color: '#b07d1e' }} />
              <span style={{ font: "500 12.5px 'Geist'", color: '#8a6a2e' }}>Changes apply to everyone with this role.</span>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ font: "600 12.5px 'Geist'", color: '#41464d' }}>Permissions <span style={{ color: '#9aa0a8', fontWeight: 500 }}>· {count} of 14</span></span>
            <div style={{ display: 'flex', gap: 14 }}>
              <button onClick={() => setPerms(new Set(CAPS))} style={{ border: 'none', background: 'none', color: '#1f7a52', font: "600 12.5px 'Geist'", cursor: 'pointer', padding: 0 }}>Select all</button>
              <button onClick={() => setPerms(new Set())} style={{ border: 'none', background: 'none', color: '#9aa0a8', font: "600 12.5px 'Geist'", cursor: 'pointer', padding: 0 }}>Clear</button>
            </div>
          </div>

          {CAP_GROUPS.map((g) => {
            const Icon = g.icon
            const done = g.caps.filter((c) => perms.has(c)).length
            return (
              <div key={g.name}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
                  <span style={{ display: 'flex', color: '#9aa0a8' }}><Icon className="h-[18px] w-[18px]" strokeWidth={1.6} /></span>
                  <span style={{ font: "600 10.5px 'Geist'", letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a9099' }}>{g.name}</span>
                  <span style={{ flex: 1, height: 1, background: '#eef0f2' }} />
                  <span style={{ font: "600 11px 'Geist'", color: '#b8bdc4', fontVariantNumeric: 'tabular-nums' }}>{done}/{g.caps.length}</span>
                </div>
                <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 13, overflow: 'hidden' }}>
                  {g.caps.map((c, i) => {
                    const on = perms.has(c)
                    return (
                      <div key={c} onClick={() => toggle(c)}
                        style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '12px 14px', cursor: 'pointer', borderTop: `1px solid ${i === 0 ? 'transparent' : '#f2f3f5'}`, background: on ? '#f6fbf8' : '#fff', transition: 'background .12s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f7faf8')} onMouseLeave={(e) => (e.currentTarget.style.background = on ? '#f6fbf8' : '#fff')}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ font: "600 13.5px 'Geist'", color: on ? '#16181d' : '#41464d' }}>{CAP_LABEL[c]}</div>
                          <div style={{ font: "400 12px 'Geist'", color: '#9aa0a8', marginTop: 1 }}>{CAP_DESC[c]}</div>
                        </div>
                        <span style={{ width: 38, height: 22, borderRadius: 20, position: 'relative', flex: 'none', transition: 'background .18s', background: on ? '#1f9d63' : '#d4d7db' }}>
                          <span style={{ position: 'absolute', top: 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.28)', transition: 'left .18s', left: on ? 18 : 2 }} />
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #eef0f2', display: 'flex', alignItems: 'center', gap: 10 }}>
          {isEdit && !editing!.is_system ? (
            <button onClick={() => del.mutate()} disabled={busy}
              style={{ border: 'none', background: 'none', color: '#c0403a', font: "600 13px 'Geist'", padding: '9px 10px', cursor: 'pointer', borderRadius: 9, marginRight: 'auto' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#fbecec')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
              {del.isPending ? 'Deleting…' : 'Delete role'}
            </button>
          ) : <span style={{ marginRight: 'auto' }} />}
          <button onClick={close} style={{ background: '#fff', border: '1px solid #e2e4e8', color: '#5c626b', font: "600 13.5px 'Geist'", padding: '11px 18px', borderRadius: 11, cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f4f5f6')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>Cancel</button>
          <button onClick={() => save.mutate()} disabled={!canSave || busy}
            style={{ background: canSave ? '#1f9d63' : '#cfe6da', border: 'none', color: canSave ? '#fff' : '#8fb9a4', font: "600 13.5px 'Geist'", padding: '11px 20px', borderRadius: 11, cursor: canSave ? 'pointer' : 'not-allowed' }}>
            {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create role'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Invite slide-over (mirrors the main Team page) ──────────────────
function InviteSlideOver({ sites, roles, onClose }: { sites: { id: string; name: string }[]; roles: Role[]; onClose: () => void }) {
  const business = useAuthStore((s) => s.business)
  const profile = useAuthStore((s) => s.profile)
  const qc = useQueryClient()
  const bid = business?.id
  const [shown, setShown] = useState(false)
  const [email, setEmail] = useState('')
  // Pick a role by its id (custom roles included), not a hardcoded preset —
  // this is what `join_with_invite` reads (`invites.role_id`) to set the new
  // member's role. Default to the Kitchen Staff preset, else the first role.
  const [roleId, setRoleId] = useState<string>('')
  useEffect(() => {
    if (roleId || roles.length === 0) return
    const kitchen = roles.find((r) => r.is_system && r.base_tier === 'kitchen_staff')
    setRoleId(kitchen?.id ?? roles[0].id)
  }, [roles, roleId])
  const [siteId, setSiteId] = useState<string>(sites[0]?.id ?? '')
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t) }, [])
  function close() { setShown(false); setTimeout(onClose, 300) }

  const invite = useMutation({
    mutationFn: async () => {
      // create_invite stores the legacy base tier; role_id (below) carries the
      // real role — custom roles included — and wins on join.
      const baseTier = roles.find((r) => r.id === roleId)?.base_tier ?? 'kitchen_staff'
      const { data, error } = await supabase.rpc('create_invite', { p_email: email, p_role: baseTier })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.token) throw new Error('Invite created but no token returned')
      const invitePatch: Record<string, unknown> = { role_id: roleId }
      if (siteId) invitePatch.site_id = siteId
      await supabase.from('invites').update(invitePatch).eq('token', row.token)
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {roles.map((r) => {
                    const on = roleId === r.id
                    return (
                      <button key={r.id} onClick={() => setRoleId(r.id)}
                        style={{ border: on ? '1.5px solid #1f9d63' : '1px solid #e2e4e8', background: on ? '#f5faf7' : '#fff', color: on ? '#1a6e49' : '#5c626b', fontSize: 13, fontWeight: 600, padding: 10, borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>{r.name}</button>
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
              <button onClick={() => invite.mutate()} disabled={!email.includes('@') || !roleId || invite.isPending}
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
