'use client'

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { ROLE_LABELS, type UserRole } from '@/lib/constants'

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(' ').filter(Boolean)
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : (parts[0]?.[0] ?? '').toUpperCase()
  }
  return email[0]?.toUpperCase() ?? '?'
}
const AVATAR = ['#1f7a52', '#5b6472', '#8a6d52', '#3f6d8a', '#7a5b6f']

export default function TeamPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  const multiSite = sites.length > 1
  const siteName = (id: string | null) => (id ? (sites.find((s) => s.id === id)?.name ?? 'Site') : 'All sites')

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

  // Read-only roster, scoped to the current site (topbar switcher). Group admins
  // belong to the whole estate, so they show on every site's list.
  const visible = (members as any[]).filter((m) => !currentSiteId || m.site_id === currentSiteId || m.is_group_admin)

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Header */}
      <div>
        <h1 className="text-[25px] font-bold leading-tight tracking-[-0.02em] text-foreground">Team</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {multiSite
            ? (currentSiteId ? `People at ${siteName(currentSiteId)}` : `People across ${business?.name ?? 'the group'} · ${sites.length} sites`)
            : 'Your team members'}
        </p>
      </div>

      {/* Members list (read-only) */}
      <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        {isLoading ? (
          <div className="p-12 text-center text-[14px] text-muted-foreground">Loading team…</div>
        ) : visible.length === 0 ? (
          <div className="p-[50px] text-center text-[14px] text-[#9aa0a8]">No team members in this view.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  <th className="px-4 py-2.5">Member</th>
                  <th className="px-3 py-2.5">Role</th>
                  {multiSite && <th className="px-4 py-2.5">Site</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((m: any, i: number) => {
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
                            <span className="block truncate text-[11.5px] text-muted-foreground">{m.email}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-[13px] text-[#41464d]">{ROLE_LABELS[m.role as UserRole] ?? m.role}</span>
                      </td>
                      {multiSite && (
                        <td className="px-4 py-3">
                          <span className={cn('text-[13px]', m.is_group_admin ? 'font-medium text-brand-deep' : m.site_id ? 'text-[#41464d]' : 'text-[#9aa0a8]')}>
                            {m.is_group_admin ? 'All sites' : siteName(m.site_id)}
                          </span>
                        </td>
                      )}
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
