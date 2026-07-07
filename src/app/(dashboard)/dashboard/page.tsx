'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Check, ChevronRight } from 'lucide-react'
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
  const total = templates.length
  const done = templates.filter((t:any)=>status(t)!=='Pending').length
  const pct = total > 0 ? Math.round((done/total)*100) : 0
  const remaining = total - done
  const overdueTasks = templates.filter((t:any)=>status(t)==='Pending')
  const myTemplates = templates.filter((t:any)=> profile?.role && Array.isArray(t.assigned_roles) && t.assigned_roles.includes(profile.role))
  const shownTasks = taskFilter === 'mine' ? myTemplates : taskFilter === 'overdue' ? overdueTasks : templates

  const ciMut = useMutation({ mutationFn: async (m: string) => { if(!profile?.id||!business?.id) throw new Error(''); const{error}=await supabase.from('staff_checkins').insert({user_id:profile.id,business_id:business.id,mood:m,checked_in_at:new Date().toISOString()}); if(error)throw error; await notifyCheckIn(business.id,profile.full_name??profile.email) }, onSuccess:()=>{toast.success('Checked in');setMood(null);qc.invalidateQueries({queryKey:['my-checkin']});qc.invalidateQueries({queryKey:['on-site-staff']})}, onError:()=>toast.error('Failed') })
  const coMut = useMutation({ mutationFn: async () => { if(!checkin?.id||!business?.id||!profile) throw new Error(''); const{error}=await supabase.from('staff_checkins').update({checked_out_at:new Date().toISOString()}).eq('id',checkin.id); if(error)throw error; await notifyCheckOut(business.id,profile.full_name??profile.email) }, onSuccess:()=>{toast.success('Checked out');qc.invalidateQueries({queryKey:['my-checkin']});qc.invalidateQueries({queryKey:['on-site-staff']})}, onError:()=>toast.error('Failed') })
  const moodMut = useMutation({ mutationFn: async (m: string) => { if(!checkin?.id) throw new Error(''); const{error}=await supabase.from('staff_checkins').update({mood:m}).eq('id',checkin.id); if(error)throw error }, onSuccess:()=>qc.invalidateQueries({queryKey:['my-checkin']}) })

  const activeMood = checkin?.mood ?? mood
  function pickMood(m: string) {
    if (!checkin) ciMut.mutate(m)
    else if (checkin.mood === m) coMut.mutate()   // tapping the current mood checks you out
    else moodMut.mutate(m)
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {/* greeting + subtle check-in */}
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-foreground">{greet}, {firstName}</h1>
          <div className="mt-1.5 flex items-center gap-2.5 text-[14px] text-muted-foreground">
            <span>{format(today, 'EEEE, d MMMM yyyy')}</span>
            <span className="h-[3px] w-[3px] rounded-full bg-[#c2c6cc]" />
            <span>{staff.length} on shift</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-[11px] border border-[#eceef0] bg-secondary py-1.5 pl-3.5 pr-1.5">
          <span className="whitespace-nowrap text-[12.5px] font-medium text-[#8a9099]" title={checkin ? 'Tap your current mood to check out' : 'Pick a mood to check in'}>Shift check-in</span>
          <div className="flex gap-[3px]">
            {MOODS.map((m) => (
              <button key={m} onClick={() => pickMood(m)} className={cn(
                'rounded-[8px] px-[11px] py-[5px] text-[12.5px] font-semibold transition-colors',
                activeMood === m ? 'bg-[#e4efe9] text-[#1a6e49]' : 'text-[#8a9099] hover:bg-card hover:text-[#5c626b]',
              )}>{m}</button>
            ))}
          </div>
        </div>
      </div>

      {/* main grid */}
      <div className="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[1fr_358px]">
        {/* tasks panel */}
        <section className="rounded-2xl border border-border bg-card px-5 pb-2 pt-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-bold text-foreground">Today&apos;s tasks</h2>
              <p className="mt-0.5 text-[13px] text-[#8a9099]">{remaining} remaining · updated {format(today, 'HH:mm')}</p>
            </div>
            <button onClick={() => router.push('/checklists')} className="flex items-center gap-1 text-[13px] font-semibold text-[#5c626b] transition-colors hover:text-foreground">
              View all <ChevronRight className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
          </div>

          {/* progress row */}
          <div className="my-4 flex items-center gap-[15px] px-0.5">
            <Ring done={done} total={total} />
            <div className="flex-1">
              <p className="text-[14px] font-semibold text-foreground">{pct}% of the shift done</p>
              <p className="mt-0.5 text-[13px] text-[#8a9099]">
                {remaining === 0 ? 'All tasks wrapped for the shift.' : `${remaining} still to sign off before close.`}
              </p>
            </div>
            <div className="flex gap-1.5">
              {(['all','mine','overdue'] as const).map((f) => (
                <button key={f} onClick={() => setTaskFilter(f)} className={cn(
                  'rounded-[9px] px-[13px] py-[7px] text-[13px] font-semibold capitalize transition-colors',
                  taskFilter === f ? 'bg-foreground text-white' : 'bg-secondary text-[#5c626b] hover:bg-[#e8e9ec]',
                )}>{f}</button>
              ))}
            </div>
          </div>

          {/* task rows */}
          <div className="flex flex-col">
            {shownTasks.length === 0 ? (
              <p className="border-t border-[#f1f2f4] py-10 text-center text-[13px] text-muted-foreground">
                {taskFilter === 'overdue' ? 'Nothing overdue — nice.' : taskFilter === 'mine' ? 'Nothing assigned to your role.' : 'No tasks today.'}
              </p>
            ) : shownTasks.map((t: any) => {
              const d = status(t) !== 'Pending'
              return (
                <button key={t.id} onClick={() => router.push(`/checklists/${t.id}`)}
                  className="flex items-center gap-[13px] rounded-[11px] border-t border-[#f1f2f4] px-2 py-3 text-left transition-colors hover:bg-[#f7f8f9]">
                  <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-colors',
                    d ? 'bg-brand text-white' : 'border-[1.8px] border-[#cdd1d6] bg-card')}>
                    {d && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[14.5px]', d ? 'font-medium text-[#a9aeb5] line-through' : 'font-semibold text-[#1c1f24]')}>{t.name}</span>
                    <span className="mt-0.5 block text-[12.5px] capitalize text-[#8a9099]">{t.frequency} checklist</span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px] capitalize text-[#9aa0a8]">{t.frequency}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* right rail */}
        <div className="flex flex-col gap-4">
          {/* Needs attention */}
          <section className="rounded-2xl border border-border bg-card p-[18px] shadow-[0_1px_2px_rgba(16,24,40,.04)]">
            <div className="flex items-center justify-between">
              <h3 className="text-[15.5px] font-bold text-foreground">Needs attention</h3>
              <button onClick={() => router.push('/incidents')} className="text-[12.5px] font-semibold text-[#9aa0a8] transition-colors hover:text-foreground">All →</button>
            </div>

            <div className="my-[13px] flex gap-1 rounded-[11px] bg-secondary p-1">
              <button onClick={() => setFeed('incidents')} className={cn('flex-1 rounded-[8px] py-[7px] text-[13px] font-semibold transition-colors', feed === 'incidents' ? 'bg-card text-[#1c1f24] shadow-[0_1px_2px_rgba(16,24,40,.06)]' : 'text-[#8a9099]')}>
                Incidents {incidents.length}
              </button>
              <button onClick={() => setFeed('overdue')} className={cn('flex-1 rounded-[8px] py-[7px] text-[13px] font-semibold transition-colors', feed === 'overdue' ? 'bg-card text-[#1c1f24] shadow-[0_1px_2px_rgba(16,24,40,.06)]' : 'text-[#8a9099]')}>
                Overdue {overdueTasks.length}
              </button>
            </div>

            <div className="flex flex-col">
              {feed === 'incidents' ? (
                incidents.length === 0
                  ? <p className="py-6 text-center text-[12.5px] text-muted-foreground">No open incidents.</p>
                  : incidents.map((i: any) => {
                    const isOpen = i.status !== 'resolved'
                    const dot = isOpen ? '#d98a1a' : '#1f9d63'
                    return (
                      <button key={i.id} onClick={() => router.push('/incidents')} className="flex w-full items-start gap-[11px] rounded-[10px] px-1.5 py-[11px] text-left transition-colors hover:bg-[#f7f8f9]">
                        <span className="mt-[6px] h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold leading-snug text-foreground">{i.description}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                              isOpen ? 'bg-[#fbf1e1] text-[#b07d1e]' : 'bg-brand-tint text-brand-deep')}>
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
                              {isOpen ? 'Open' : 'Resolved'}
                            </span>
                            <span className="text-[12px] capitalize text-[#8a9099]">{i.type ?? 'incident'}</span>
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-[12px] text-[#9aa0a8]">{formatDistanceToNow(new Date(i.created_at)).replace('about ','').replace(' minutes','m').replace(' minute','m').replace(' hours','h').replace(' hour','h').replace(' days','d').replace(' day','d')}</span>
                      </button>
                    )
                  })
              ) : (
                overdueTasks.length === 0
                  ? <p className="py-6 text-center text-[12.5px] text-muted-foreground">Nothing overdue.</p>
                  : overdueTasks.map((t: any) => (
                    <button key={t.id} onClick={() => router.push(`/checklists/${t.id}`)} className="flex items-start gap-[11px] rounded-[10px] px-1.5 py-[11px] text-left transition-colors hover:bg-[#f7f8f9]">
                      <span className="mt-[6px] h-2 w-2 shrink-0 rounded-full bg-[#d98a1a]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold leading-snug text-foreground">{t.name}</p>
                        <p className="mt-0.5 text-[12px] capitalize text-[#8a9099]">{t.frequency} checklist</p>
                      </div>
                      <span className="shrink-0 font-mono text-[12px] text-[#c8861a]">due</span>
                    </button>
                  ))
              )}
            </div>
          </section>

          {/* On shift */}
          <section className="rounded-2xl border border-border bg-card p-[18px] shadow-[0_1px_2px_rgba(16,24,40,.04)]">
            <h3 className="mb-1.5 text-[15.5px] font-bold text-foreground">On shift · {staff.length}</h3>
            {staff.length === 0 ? (
              <p className="py-3 text-center text-[12.5px] text-muted-foreground">Nobody on shift right now.</p>
            ) : staff.map((s: any, i: number) => (
              <div key={s.id} className="flex items-center gap-[11px] px-0.5 py-2">
                <div className="relative shrink-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                    {getInitials(s.profile?.full_name, s.profile?.email)}
                  </div>
                  <span className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-card" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-foreground">{s.profile?.full_name ?? 'Unnamed'}</p>
                  <p className="text-[12px] capitalize text-[#8a9099]">{s.profile?.role ?? 'staff'}</p>
                </div>
                <span className="font-mono text-[12px] text-[#9aa0a8]">{format(new Date(s.checked_in_at), 'HH:mm')}</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}
