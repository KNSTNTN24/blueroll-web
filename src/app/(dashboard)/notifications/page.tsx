'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { CheckCheck, ChevronRight, CircleCheck } from 'lucide-react'
import { formatDistanceToNow, isToday, isThisWeek, parseISO } from 'date-fns'
import { notifMeta, type NotifRow } from '@/lib/notification-meta'

type Filter = 'all' | 'unread' | 'incidents' | 'team'

const shortAgo = (d: string) => formatDistanceToNow(parseISO(d)).replace('about ', '').replace('less than a minute', 'just now').replace(/ minutes?/, 'm').replace(/ hours?/, 'h').replace(/ days?/, 'd').replace(/ months?/, 'mo')

export default function NotificationsPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const uid = profile?.id
  const [filter, setFilter] = useState<Filter>('all')

  const { data: items = [] } = useQuery({
    queryKey: ['notifications', uid],
    enabled: !!uid,
    queryFn: async () => (await supabase.from('notifications').select('id, type, title, message, read, link, created_at').eq('user_id', uid!).order('created_at', { ascending: false }).limit(500)).data as NotifRow[] ?? [],
  })

  const unread = items.filter((n) => !n.read).length

  const filtered = items.filter((n) => {
    if (filter === 'unread') return !n.read
    const g = notifMeta(n.type, n.title).group
    if (filter === 'incidents') return g === 'incident'
    if (filter === 'team') return g === 'team'
    return true
  })

  const groups = useMemo(() => {
    const g: { label: string; rows: NotifRow[] }[] = [
      { label: 'Today', rows: [] }, { label: 'This week', rows: [] }, { label: 'Earlier', rows: [] },
    ]
    filtered.forEach((n) => {
      const d = parseISO(n.created_at)
      if (isToday(d)) g[0].rows.push(n)
      else if (isThisWeek(d, { weekStartsOn: 1 })) g[1].rows.push(n)
      else g[2].rows.push(n)
    })
    return g.filter((x) => x.rows.length)
  }, [filtered])

  async function markRead(n: NotifRow) {
    if (!n.read) {
      qc.setQueryData(['notifications', uid], (old: NotifRow[]) => (old ?? []).map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      qc.setQueryData(['notif-unread', uid], (c: number) => Math.max(0, (c ?? 1) - 1))
      await supabase.from('notifications').update({ read: true }).eq('id', n.id)
    }
    if (n.link) router.push(n.link)
  }
  async function markAll() {
    qc.setQueryData(['notifications', uid], (old: NotifRow[]) => (old ?? []).map((x) => ({ ...x, read: true })))
    qc.setQueryData(['notif-unread', uid], 0)
    await supabase.from('notifications').update({ read: true }).eq('user_id', uid!).eq('read', false)
  }

  const seg = (on: boolean): React.CSSProperties => ({ border: 'none', cursor: 'pointer', font: `${on ? 600 : 500} 13px 'Geist'`, padding: '6px 13px', borderRadius: 8, background: on ? '#16181d' : 'transparent', color: on ? '#fff' : '#6b7280' })

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d', display: 'flex', flexDirection: 'column' }}>
      {/* head */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.025em' }}>Notifications</h1>
          <div style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>{unread} unread · {business?.name ?? 'your group'}, all sites</div>
        </div>
        {unread > 0 && (
          <button onClick={markAll} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #e2e4e8', color: '#41464d', font: "600 13.5px 'Geist'", padding: '9px 14px', borderRadius: 10, cursor: 'pointer' }}>
            <CheckCheck className="h-4 w-4" strokeWidth={1.8} /> Mark all as read
          </button>
        )}
      </div>

      {/* filters */}
      <div style={{ display: 'flex', gap: 0, background: '#fff', border: '1px solid #e5e7ea', borderRadius: 11, padding: 4, alignSelf: 'flex-start', marginTop: 14 }}>
        {([['all', 'All'], ['unread', 'Unread'], ['incidents', 'Incidents'], ['team', 'Team']] as [Filter, string][]).map(([k, label]) => {
          const on = filter === k
          return (
            <button key={k} onClick={() => setFilter(k)} style={{ ...seg(on), display: 'flex', alignItems: 'center', gap: 6 }}>
              {label}
              {k === 'unread' && unread > 0 && <span style={{ font: "700 10.5px 'Geist'", padding: '1px 6px', borderRadius: 20, background: on ? '#3c414a' : '#eef0f2', color: on ? '#fff' : '#6b7280' }}>{unread}</span>}
            </button>
          )
        })}
      </div>

      {/* groups */}
      {groups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: '#e9f2ec', color: '#1f7a52', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><CircleCheck className="h-6 w-6" strokeWidth={1.9} /></div>
          <div style={{ font: "700 15.5px 'Geist'", color: '#3c414a', marginTop: 14 }}>All caught up</div>
          <div style={{ fontSize: 13.5, color: '#9aa0a8', marginTop: 4 }}>{filter === 'unread' ? 'No unread notifications.' : 'Nothing here yet.'}</div>
        </div>
      ) : groups.map((g) => (
        <div key={g.label}>
          <div style={{ font: "600 11.5px 'Geist'", letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a9099', margin: '22px 2px 9px' }}>{g.label}</div>
          <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 15, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)', overflow: 'hidden' }}>
            {g.rows.map((n, i) => {
              const m = notifMeta(n.type, n.title)
              return (
                <div key={n.id} onClick={() => markRead(n)} style={{ display: 'flex', gap: 13, padding: '13px 18px', borderTop: i === 0 ? 'none' : '1px solid #f5f6f7', cursor: 'pointer', background: n.read ? '#fff' : '#fbfdfc', transition: 'background .14s', alignItems: 'flex-start' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8f9fa')} onMouseLeave={(e) => (e.currentTarget.style.background = n.read ? '#fff' : '#fbfdfc')}>
                  <span style={{ width: 38, height: 38, borderRadius: 11, background: m.bg, color: m.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><m.Icon className="h-[18px] w-[18px]" strokeWidth={1.8} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "600 13.5px 'Geist'", color: '#1c1f24', lineHeight: 1.35 }}>{n.title}</div>
                    {n.message && <div style={{ font: "400 12.5px 'Geist'", color: '#8a9099', marginTop: 2 }}>{n.message}</div>}
                    {m.action && n.link && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, font: "600 12px 'Geist'", color: '#1f7a52', marginTop: 6 }}>{m.action}<ChevronRight className="h-3.5 w-3.5" strokeWidth={2} /></div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
                    <span style={{ font: "500 12px 'Geist'", color: '#9aa0a8', whiteSpace: 'nowrap' }}>{shortAgo(n.created_at)}</span>
                    {!n.read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1f9d63', flex: 'none' }} />}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
