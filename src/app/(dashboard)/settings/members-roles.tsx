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

const initials = (n: string | null, e: string | null) => {
  const s = n || e || '?'
  const p = s.split(' ').filter(Boolean)
  return (p.length >= 2 ? p[0][0] + p[1][0] : s.slice(0, 2)).toUpperCase()
}

/**
 * Members & roles. Role + site assignment control what each person sees —
 * a member's site_id scopes their data and switcher; group admins see all sites.
 */
export function MembersRoles() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const me = useAuthStore((s) => s.profile)
  const qc = useQueryClient()
  const bid = business?.id
  const [savingId, setSavingId] = useState<string | null>(null)

  const { data: members = [] } = useQuery({
    queryKey: ['members-roles', bid],
    enabled: !!bid,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, site_id, is_group_admin')
        .eq('business_id', bid!)
        .order('full_name')
      return (data ?? []) as Member[]
    },
  })

  async function patch(id: string, patch: Record<string, unknown>) {
    setSavingId(id)
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    setSavingId(null)
    if (error) { toast.error(error.message); return }
    toast.success('Updated')
    qc.invalidateQueries({ queryKey: ['members-roles', bid] })
    qc.invalidateQueries({ queryKey: ['sites-members', bid] })
  }

  return (
    <div className="rounded-[14px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <h2 className="text-[16px] font-bold text-foreground">Members &amp; roles</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Role and site access decide what each person sees. Assign a site to scope someone to one kitchen, or leave on the whole group.
      </p>

      <div className="mt-4 divide-y divide-[#f2f3f5]">
        {members.map((m) => {
          const isMe = m.id === me?.id
          const busy = savingId === m.id
          return (
            <div key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#5b6472] text-[11px] font-bold text-white">
                {initials(m.full_name, m.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-foreground">
                  {m.full_name || m.email || 'Unknown'}
                  {isMe && <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">(you)</span>}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">{m.email}</div>
              </div>

              {/* Role */}
              <select
                value={m.role ?? ''}
                disabled={busy}
                onChange={(e) => patch(m.id, { role: e.target.value })}
                className="rounded-[9px] border border-input bg-card px-2.5 py-1.5 text-[13px] font-medium text-foreground outline-none focus:border-brand disabled:opacity-50"
              >
                {USER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>

              {/* Site access */}
              <select
                value={m.is_group_admin ? '__all' : (m.site_id ?? '')}
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '__all') patch(m.id, { is_group_admin: true })
                  else patch(m.id, { is_group_admin: false, site_id: v || null })
                }}
                className="rounded-[9px] border border-input bg-card px-2.5 py-1.5 text-[13px] font-medium text-foreground outline-none focus:border-brand disabled:opacity-50"
              >
                <option value="__all">All sites (group)</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )
        })}
        {members.length === 0 && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">No members yet.</p>
        )}
      </div>
    </div>
  )
}
