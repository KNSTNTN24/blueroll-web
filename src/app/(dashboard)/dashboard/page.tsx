'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Check, ChevronRight, ClipboardCheck, Truck, AlertTriangle, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { notifyCheckIn, notifyCheckOut } from '@/lib/notifications'
import { format, formatDistanceToNow, startOfDay, startOfWeek, startOfMonth } from 'date-fns'
import { EstateDashboard } from './estate-dashboard'

const MOODS = ['Smooth', 'Busy', 'Rough'] as const
const AVATAR_COLORS = ['#1f7a52', '#5b6472', '#8a6d52']

function getInitials(name: string | null, email?: string): string {
  if (name) { const p = name.split(' ').filter(Boolean); return p.length >= 2 ? (p[0][0] + p[p.length-1][0]).toUpperCase() : (p[0]?.[0] ?? '').toUpperCase() }
  return (email?.[0] ?? '?').toUpperCase()
}
function getPeriodStart(f: string): Date {
  const n = new Date()
  if (f === 'weekly') return startOfWeek(n, { weekStartsOn: 1 })
  if (f === 'monthly') return startOfMonth(n)
  if (f === 'four_weekly') { const d = startOfWeek(n, { weekStartsOn: 1 }); d.setDate(d.getDate()-21); return d }
  return startOfDay(n)
}

function shortAgo(d: string) { return formatDistanceToNow(new Date(d)).replace('about ', '').replace(/ minutes?/, 'm').replace(/ hours?/, 'h').replace(/ days?/, 'd').replace('less than am', '1m') }
const QUICK = [
  { key: 'check', label: 'Start a check', sub: 'Opening / temps', bg: '#eef4f0', fg: '#1f7a52', icon: ClipboardCheck, to: '/checklists' },
  { key: 'delivery', label: 'Log delivery', sub: 'Goods-in temp', bg: '#eef2f6', fg: '#4e6e81', icon: Truck, to: '/deliveries' },
  { key: 'incident', label: 'Report incident', sub: 'Flag an issue', bg: '#fbf1e1', fg: '#c8861a', icon: AlertTriangle, to: '/incidents' },
  { key: 'doc', label: 'Upload doc', sub: 'Certificate', bg: '#f1f0f4', fg: '#6b6580', icon: Upload, to: '/documents' },
] as const

/** Green progress ring with the count centred inside. */
function Ring({ done, total, size = 62, stroke = 5 }: { done: number; total: number; size?: number; stroke?: number }) {
  const pct = total > 0 ? done / total : 0
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - pct)
  const mid = size / 2
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="#eef0f2" strokeWidth={stroke} />
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="#1f9d63" strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset .4s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[15px] font-bold tabular-nums text-foreground">{done}<span className="text-[#bcc0c6]">/{total}</span></span>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const profile = useAuthStore((s) => s.profile)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  // Group admins on "All sites" get the estate overview; everyone else sees one site.
  if (profile?.is_group_admin && currentSiteId === null) return <EstateDashboard />
  return <SiteDashboard />
}

function SiteDashboard() {
  const router = useRouter()
  const qc = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  const [mood, setMood] = useState<string|null>(null)
  const [taskFilter, setTaskFilter] = useState<'all'|'mine'|'overdue'>('all')
  const [feed, setFeed] = useState<'incidents'|'overdue'>('incidents')
  const today = new Date()
  const ds = startOfDay(today).toISOString()
  const firstName = profile?.full_name?.split(' ')[0] ?? ''
  const hour = today.getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const { data: checkin } = useQuery({ queryKey: ['my-checkin', profile?.id], enabled: !!profile?.id && !!business?.id, queryFn: async () => { if (!profile?.id||!business?.id) return null; const { data } = await supabase.from('staff_checkins').select('*').eq('user_id',profile.id).eq('business_id',business.id).gte('checked_in_at',ds).is('checked_out_at',null).order('checked_in_at',{ascending:false}).limit(1).maybeSingle(); return data } })
  const { data: templates = [] } = useQuery({ queryKey: ['dash-templates', business?.id, currentSiteId], enabled: !!business?.id, queryFn: async () => { if (!business?.id) return []; let q = supabase.from('checklist_templates').select('*, checklist_template_items(id)').eq('business_id',business.id).eq('active',true); if (currentSiteId) q = q.eq('site_id',currentSiteId); const { data, error } = await q.order('name'); if (error) throw error; return data ?? [] } })
  const { data: completions = [] } = useQuery({ queryKey: ['my-completions', business?.id, currentSiteId], enabled: !!business?.id, queryFn: async () => { if (!business?.id) return []; let q = supabase.from('checklist_completions').select('template_id, completed_at, signed_off_by').eq('business_id',business.id).gte('completed_at',ds); if (currentSiteId) q = q.eq('site_id',currentSiteId); const { data, error } = await q; if (error) throw error; return data ?? [] } })
  const { data: incidents = [] } = useQuery({ queryKey: ['open-incidents', business?.id, currentSiteId], enabled: !!business?.id, queryFn: async () => { if (!business?.id) return []; let q = supabase.from('incidents').select('*').eq('business_id',business.id).eq('status','open'); if (currentSiteId) q = q.eq('site_id',currentSiteId); const { data, error } = await q.order('created_at',{ascending:false}).limit(6); if (error) throw error; return data ?? [] } })
  const { data: staff = [] } = useQuery({ queryKey: ['on-site-staff', business?.id, currentSiteId], enabled: !!business?.id, queryFn: async () => { if (!business?.id) return []; let q = supabase.from('staff_checkins').select('*, profile:profiles(full_name, email, role)').eq('business_id',business.id).gte('checked_in_at',ds).is('checked_out_at',null); if (currentSiteId) q = q.eq('site_id',currentSiteId); const { data, error } = await q; if (error) throw error; return data ?? [] } })

  function status(t: any): string { const ps=getPeriodStart(t.frequency); const c=completions.find((c:any)=>c.template_id===t.id&&new Date(c.completed_at)>=ps); if(!c)return'Pending';if(c.signed_off_by)return'Done';if(t.supervisor_role)return'Review';return'Done' }
  const isPending = (t: any) => status(t) === 'Pending'
  const nowMin = today.getHours() * 60 + today.getMinutes()
  const dueMin = (t: any): number | null => { if (!t.deadline_time) return null; const [h, m] = String(t.deadline_time).split(':').map(Number); return h * 60 + (m || 0) }
  const isOverdue = (t: any) => { const dm = dueMin(t); return isPending(t) && dm !== null && nowMin > dm }
  const shiftOf = (t: any): 'Opening' | 'Service' | 'Closing' => {
    const n = (t.name || '').toLowerCase()
    if (/open|morning/.test(n)) return 'Opening'
    if (/clos|end of day|shut/.test(n)) return 'Closing'
    const dm = dueMin(t)
    if (dm !== null) return dm < 660 ? 'Opening' : dm < 1020 ? 'Service' : 'Closing'
    return 'Service'
  }
  const total = templates.length
  const done = templates.filter((t: any) => !isPending(t)).length
  const remaining = total - done
  const overdueChecks = (templates as any[]).filter(isOverdue)
  const groups = (['Opening', 'Service', 'Closing'] as const)
    .map((name) => {
      const items = (templates as any[]).filter((t) => shiftOf(t) === name)
        .sort((a, b) => (dueMin(a) ?? 9999) - (dueMin(b) ?? 9999))
      return { name, items, gdone: items.filter((t) => !isPending(t)).length, god: items.filter(isOverdue).length }
    })
    .filter((g) => g.items.length > 0)
  const openIncidents = incidents.length
  const toFix = openIncidents + overdueChecks.length
  const clear = toFix === 0
  const attention = [
    ...(incidents as any[]).map((i) => ({ key: 'inc-' + i.id, title: i.description, tag: 'Incident', tagBg: '#fbf1e1', tagColor: '#b07d1e', dot: '#d98a1a', meta: `${i.type ?? 'incident'} · Open`, time: shortAgo(i.created_at), go: () => router.push('/incidents') })),
    ...overdueChecks.map((t) => ({ key: 'task-' + t.id, title: `${t.name} overdue`, tag: 'Task', tagBg: '#f1f2f4', tagColor: '#6b7280', dot: '#9aa0a8', meta: 'Compliance', time: t.deadline_time ?? 'due', go: () => router.push(`/checklists/${t.id}`) })),
  ].slice(0, 6)

  const ciMut = useMutation({ mutationFn: async (m: string) => { if(!profile?.id||!business?.id) throw new Error(''); const{error}=await supabase.from('staff_checkins').insert({user_id:profile.id,business_id:business.id,site_id:currentSiteId,mood:m,checked_in_at:new Date().toISOString()}); if(error)throw error; await notifyCheckIn(business.id,profile.full_name??profile.email) }, onSuccess:()=>{toast.success('Checked in');setMood(null);qc.invalidateQueries({queryKey:['my-checkin']});qc.invalidateQueries({queryKey:['on-site-staff']})}, onError:()=>toast.error('Failed') })
  const coMut = useMutation({ mutationFn: async () => { if(!checkin?.id||!business?.id||!profile) throw new Error(''); const{error}=await supabase.from('staff_checkins').update({checked_out_at:new Date().toISOString()}).eq('id',checkin.id); if(error)throw error; await notifyCheckOut(business.id,profile.full_name??profile.email) }, onSuccess:()=>{toast.success('Checked out');qc.invalidateQueries({queryKey:['my-checkin']});qc.invalidateQueries({queryKey:['on-site-staff']})}, onError:()=>toast.error('Failed') })
  const moodMut = useMutation({ mutationFn: async (m: string) => { if(!checkin?.id) throw new Error(''); const{error}=await supabase.from('staff_checkins').update({mood:m}).eq('id',checkin.id); if(error)throw error }, onSuccess:()=>qc.invalidateQueries({queryKey:['my-checkin']}) })

  const activeMood = checkin?.mood ?? mood
  function pickMood(m: string) {
    if (!checkin) ciMut.mutate(m)
    else if (checkin.mood === m) coMut.mutate()   // tapping the current mood checks you out
    else moodMut.mutate(m)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      {/* greeting row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.025em' }}>{greet}, {firstName}</h1>
            {clear ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: "600 12px 'Geist'", color: '#1a6e49', background: '#e7f0ea', padding: '5px 11px', borderRadius: 20, whiteSpace: 'nowrap' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1f9d63' }} />Inspection-ready</span>
            ) : (
              <a href="#needs-attention" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: "600 12px 'Geist'", color: '#8a6a1f', background: '#f9eed7', padding: '5px 11px', borderRadius: 20, textDecoration: 'none', whiteSpace: 'nowrap' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d98a1a' }} />{toFix} to fix</a>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 5, color: '#6b7280', fontSize: 14 }}>
            <span>{format(today, 'EEEE, d MMMM yyyy')}</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#c2c6cc' }} />
            <span>{staff.length} on shift</span>
            {business?.fsa_rating && <><span style={{ width: 3, height: 3, borderRadius: '50%', background: '#c2c6cc' }} /><span>FSA {business.fsa_rating}/5</span></>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #ecedf0', borderRadius: 11, padding: '6px 7px 6px 12px' }}>
          <span style={{ font: "500 12.5px 'Geist'", color: '#8a9099', whiteSpace: 'nowrap' }} title={checkin ? 'Tap your current mood to check out' : 'Pick a mood to check in'}>Shift check-in</span>
          <div style={{ display: 'flex', gap: 3 }}>
            {MOODS.map((m) => {
              const on = activeMood === m
              return <button key={m} onClick={() => pickMood(m)} style={{ border: 'none', cursor: 'pointer', font: "600 12px 'Geist'", padding: '5px 11px', borderRadius: 8, background: on ? '#e4efe9' : 'transparent', color: on ? '#1a6e49' : '#8a9099' }}>{m}</button>
            })}
          </div>
        </div>
      </div>

      {/* quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {QUICK.map((q) => {
          const Icon = q.icon
          return (
            <button key={q.key} onClick={() => router.push(q.to)}
              style={{ display: 'flex', alignItems: 'center', gap: 13, border: '1px solid #e9eaed', background: '#fff', borderRadius: 15, padding: '15px 17px', cursor: 'pointer', textAlign: 'left', boxShadow: '0 1px 2px rgba(16,24,40,.04),0 8px 22px -18px rgba(16,24,40,.18)', transition: 'border-color .14s, box-shadow .14s, transform .12s' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#cfe0d6'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(16,24,40,.05),0 14px 30px -18px rgba(16,24,40,.24)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e9eaed'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(16,24,40,.04),0 8px 22px -18px rgba(16,24,40,.18)' }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: q.bg, color: q.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon className="h-[19px] w-[19px]" strokeWidth={1.7} /></span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', font: "600 14px 'Geist'", color: '#16181d', letterSpacing: '-.01em' }}>{q.label}</span>
                <span style={{ display: 'block', font: "400 12px 'Geist'", color: '#9aa0a8', marginTop: 2 }}>{q.sub}</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 16, alignItems: 'start' }} className="dash-grid">
        {/* today's checks */}
        <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <div style={{ position: 'relative', width: 52, height: 52, flex: 'none' }}>
                <svg width="52" height="52" viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none" stroke="#eef0f2" strokeWidth="5" /><circle cx="26" cy="26" r="22" fill="none" stroke="#1f9d63" strokeWidth="5" strokeLinecap="round" strokeDasharray="138.2" strokeDashoffset={(138.2 * (1 - (total ? done / total : 0))).toFixed(1)} transform="rotate(-90 26 26)" style={{ transition: 'stroke-dashoffset .4s ease' }} /></svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 12.5px 'Geist'", fontVariantNumeric: 'tabular-nums' }}>{total ? Math.round(done / total * 100) : 0}%</div>
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-.015em' }}>Today&apos;s checks</h2>
                <div style={{ fontSize: 13, color: '#8a9099', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{done} of {total} done · {remaining} before close</div>
              </div>
            </div>
            <button onClick={() => router.push('/checklists')} style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#5c626b', fontWeight: 600, fontSize: 13, border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none', marginLeft: 14 }}>View all<ChevronRight className="h-[15px] w-[15px]" strokeWidth={1.8} /></button>
          </div>

          {total === 0 ? (
            <div style={{ padding: '28px 20px', textAlign: 'center', color: '#8a9099', fontSize: 13, borderTop: '1px solid #f2f3f5' }}>No checks scheduled today.</div>
          ) : groups.map((g) => (
            <div key={g.name}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 20px 7px', background: '#fafbfb', borderTop: '1px solid #f2f3f5' }}>
                <span style={{ font: "600 11px 'Geist'", letterSpacing: '.07em', textTransform: 'uppercase', color: '#6f7580' }}>{g.name}</span>
                <span style={{ font: "600 11px 'Geist'", color: '#8a9099', background: '#eef0f2', padding: '2px 9px', borderRadius: 20, fontVariantNumeric: 'tabular-nums' }}>{g.gdone}/{g.items.length}</span>
                {g.god > 0 && <span style={{ font: "600 10.5px 'Geist'", color: '#b07d1e', background: '#fbf1e1', padding: '2px 8px', borderRadius: 20 }}>{g.god} overdue</span>}
              </div>
              {g.items.map((t: any) => {
                const d = !isPending(t); const ov = isOverdue(t)
                return (
                  <div key={t.id} className="tk-row" onClick={() => router.push(`/checklists/${t.id}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 20px', borderTop: '1px solid #f5f6f7', cursor: 'pointer', transition: 'background .14s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: d ? '#1f9d63' : '#fff', border: d ? 'none' : `1.8px solid ${ov ? '#e6c98f' : '#cdd1d6'}`, color: '#fff' }}>{d && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ font: `${d ? 500 : 600} 14px 'Geist'`, color: d ? '#a9aeb5' : '#1c1f24', textDecoration: d ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                    </div>
                    {ov && <span style={{ font: "600 11.5px 'Geist'", color: '#b07d1e', background: '#fbf1e1', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>Overdue</span>}
                    <span style={{ font: "500 12.5px 'Geist'", color: '#9aa0a8', whiteSpace: 'nowrap' }}>{t.deadline_time ?? ''}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* right rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div id="needs-attention" style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)', padding: 18, scrollMarginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>Needs attention</h3>
              <button onClick={() => router.push('/incidents')} style={{ color: '#9aa0a8', fontWeight: 600, fontSize: 12.5, border: 'none', background: 'none', cursor: 'pointer' }}>All →</button>
            </div>
            {attention.length === 0 ? (
              <div style={{ padding: '14px 2px', color: '#8a9099', fontSize: 12.5 }}>All clear — no open incidents or overdue checks.</div>
            ) : attention.map((a) => (
              <div key={a.key} onClick={a.go} style={{ display: 'flex', gap: 11, padding: '10px 2px', borderTop: '1px solid #f5f6f7', alignItems: 'flex-start', cursor: 'pointer' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', marginTop: 5, background: a.dot }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "600 13.5px 'Geist'", lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
                    <span style={{ font: "600 10.5px 'Geist'", padding: '2px 7px', borderRadius: 5, background: a.tagBg, color: a.tagColor }}>{a.tag}</span>
                    <span style={{ font: "400 12px 'Geist'", color: '#8a9099' }}>{a.meta}</span>
                  </div>
                </div>
                <span style={{ font: "500 12px 'Geist'", color: '#9aa0a8', flex: 'none' }}>{a.time}</span>
              </div>
            ))}
          </div>

          <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)', padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>On shift · {staff.length}</h3>
              <button onClick={() => router.push('/team')} style={{ color: '#9aa0a8', fontWeight: 600, fontSize: 12.5, border: 'none', background: 'none', cursor: 'pointer' }}>Team →</button>
            </div>
            {staff.length === 0 ? (
              <button onClick={() => router.push('/team')} style={{ width: '100%', textAlign: 'left', padding: '10px 2px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12.5, color: '#8a9099' }}>No one checked in yet — invite your team from Team.</button>
            ) : staff.map((s: any, i: number) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 2px' }}>
                <div style={{ position: 'relative', flex: 'none' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 11px 'Geist'", background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>{getInitials(s.profile?.full_name, s.profile?.email)}</div>
                  <span style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: '50%', background: '#1f9d63', border: '2px solid #fff' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.profile?.full_name ?? 'Unnamed'}</div>
                  <div style={{ fontSize: 12, color: '#8a9099', textTransform: 'capitalize' }}>{(s.profile?.role ?? 'staff').replace('_', ' ')}</div>
                </div>
                <span style={{ font: "500 12px 'Geist'", color: '#9aa0a8' }}>{format(new Date(s.checked_in_at), 'HH:mm')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@media (max-width:980px){.dash-grid{grid-template-columns:1fr !important}}`}</style>
    </div>
  )
}
