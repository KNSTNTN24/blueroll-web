'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { Bell } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { notifMeta, type NotifRow } from '@/lib/notification-meta'

const shortAgo = (d: string) => formatDistanceToNow(parseISO(d)).replace('about ', '').replace('less than a minute', 'now').replace(/ minutes?/, 'm').replace(/ hours?/, 'h').replace(/ days?/, 'd').replace(/ months?/, 'mo')

export function NotifBell() {
  const router = useRouter()
  const qc = useQueryClient()
  const uid = useAuthStore((s) => s.profile?.id)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data: items = [] } = useQuery({
    queryKey: ['notifications', uid],
    enabled: !!uid,
    queryFn: async () => (await supabase.from('notifications').select('id, type, title, message, read, link, created_at').eq('user_id', uid!).order('created_at', { ascending: false }).limit(50)).data as NotifRow[] ?? [],
    refetchInterval: 60_000,
  })
  const { data: unread = 0 } = useQuery({
    queryKey: ['notif-unread', uid],
    enabled: !!uid,
    queryFn: async () => (await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid!).eq('read', false)).count ?? 0,
    refetchInterval: 60_000,
  })
  const recent = items.slice(0, 5)

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
  }, [])

  async function markRead(n: NotifRow) {
    setOpen(false)
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

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((v) => !v)} aria-label="Notifications"
        style={{ position: 'relative', display: 'flex', height: 36, width: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: 'none', cursor: 'pointer', color: '#5c626b', background: open ? '#f1f2f4' : 'transparent', transition: 'background .14s' }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = '#f1f2f4' }} onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent' }}>
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.7} />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: 4, right: 3, minWidth: 15, height: 15, padding: '0 3px', borderRadius: 20, background: '#d2453f', border: '2px solid #fff', color: '#fff', font: "700 9px 'Geist'", display: 'flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 390, maxWidth: '92vw', background: '#fff', border: '1px solid #e5e7ea', borderRadius: 16, boxShadow: '0 4px 8px rgba(16,24,40,.06),0 24px 54px -18px rgba(16,24,40,.3)', zIndex: 60, overflow: 'hidden', fontFamily: "'Geist',system-ui,sans-serif" }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 16px 11px' }}>
            <span style={{ font: "700 14.5px 'Geist'", color: '#16181d' }}>Notifications</span>
            {unread > 0 && <span style={{ font: "600 11px 'Geist'", color: '#1a6e49', background: '#e9f2ec', padding: '2px 8px', borderRadius: 20 }}>{unread} new</span>}
            <button onClick={markAll} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: '#6b7280', font: "600 12px 'Geist'", padding: '4px 7px', borderRadius: 7, cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f2f4')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>Mark all read</button>
          </div>
          <div style={{ maxHeight: 398, overflowY: 'auto', borderTop: '1px solid #f2f3f5' }}>
            {recent.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: '#9aa0a8', fontSize: 13 }}>You&apos;re all caught up.</div>
            ) : recent.map((n, i) => {
              const m = notifMeta(n.type, n.title)
              return (
                <div key={n.id} onClick={() => markRead(n)} style={{ display: 'flex', gap: 11, padding: '11px 16px', borderTop: i === 0 ? 'none' : '1px solid #f5f6f7', cursor: 'pointer', background: n.read ? '#fff' : '#fbfdfc', transition: 'background .14s', alignItems: 'flex-start' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8f9fa')} onMouseLeave={(e) => (e.currentTarget.style.background = n.read ? '#fff' : '#fbfdfc')}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, background: m.bg, color: m.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><m.Icon className="h-4 w-4" strokeWidth={1.8} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "600 13px 'Geist'", color: '#1c1f24', lineHeight: 1.35 }}>{n.title}</div>
                    {n.message && <div style={{ font: "400 12px 'Geist'", color: '#8a9099', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.message}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flex: 'none' }}>
                    <span style={{ font: "500 11.5px 'Geist'", color: '#9aa0a8', whiteSpace: 'nowrap' }}>{shortAgo(n.created_at)}</span>
                    {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f9d63' }} />}
                  </div>
                </div>
              )
            })}
          </div>
          <button onClick={() => { setOpen(false); router.push('/notifications') }} style={{ width: '100%', border: 'none', borderTop: '1px solid #f2f3f5', background: '#fafbfb', color: '#3c414a', font: "600 12.5px 'Geist'", padding: '11px', cursor: 'pointer', transition: 'background .14s' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f2f4')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fafbfb')}>All notifications →</button>
        </div>
      )}
    </div>
  )
}
