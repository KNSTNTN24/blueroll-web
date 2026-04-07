'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { CheckSquare, AlertTriangle, Users, Bell, Clock, ChevronRight, LogIn, Shield } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { MOOD_EMOJIS } from '@/lib/constants'
import { notifyCheckIn, notifyCheckOut } from '@/lib/notifications'
import { format, formatDistanceToNow, startOfDay, endOfDay, startOfWeek, startOfMonth } from 'date-fns'

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

export default function DashboardPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const [mood, setMood] = useState<string|null>(null)
  const today = new Date()
  const ds = startOfDay(today).toISOString()
  const firstName = profile?.full_name?.split(' ')[0] ?? ''
  const hour = today.getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const { data: checkin } = useQuery({ queryKey: ['my-checkin', profile?.id], enabled: !!profile?.id && !!business?.id, queryFn: async () => { if (!profile?.id||!business?.id) return null; const { data } = await supabase.from('staff_checkins').select('*').eq('user_id',profile.id).eq('business_id',business.id).gte('checked_in_at',ds).is('checked_out_at',null).order('checked_in_at',{ascending:false}).limit(1).maybeSingle(); return data } })
  const { data: templates = [] } = useQuery({ queryKey: ['my-templates', business?.id, profile?.role], enabled: !!business?.id && !!profile?.role, queryFn: async () => { if (!business?.id||!profile?.role) return []; const { data, error } = await supabase.from('checklist_templates').select('*, checklist_template_items(id)').eq('business_id',business.id).eq('active',true).contains('assigned_roles',[profile.role]).order('name'); if (error) throw error; return data ?? [] } })
  const { data: completions = [] } = useQuery({ queryKey: ['my-completions', business?.id], enabled: !!business?.id, queryFn: async () => { if (!business?.id) return []; const { data, error } = await supabase.from('checklist_completions').select('template_id, completed_at, signed_off_by').eq('business_id',business.id).gte('completed_at',ds); if (error) throw error; return data ?? [] } })
  const { data: incidents = [] } = useQuery({ queryKey: ['open-incidents', business?.id], enabled: !!business?.id, queryFn: async () => { if (!business?.id) return []; const { data, error } = await supabase.from('incidents').select('*').eq('business_id',business.id).eq('status','open').order('created_at',{ascending:false}).limit(5); if (error) throw error; return data ?? [] } })
  const { data: staff = [] } = useQuery({ queryKey: ['on-site-staff', business?.id], enabled: !!business?.id, queryFn: async () => { if (!business?.id) return []; const { data, error } = await supabase.from('staff_checkins').select('*, profile:profiles(full_name, email)').eq('business_id',business.id).gte('checked_in_at',ds).is('checked_out_at',null); if (error) throw error; return data ?? [] } })
  const { data: notifs = [] } = useQuery({ queryKey: ['notifications', profile?.id], enabled: !!profile?.id, queryFn: async () => { if (!profile?.id) return []; const { data, error } = await supabase.from('notifications').select('*').eq('user_id',profile.id).order('created_at',{ascending:false}).limit(5); if (error) throw error; return data ?? [] } })

  function status(t: any): string { const ps=getPeriodStart(t.frequency); const c=completions.find((c:any)=>c.template_id===t.id&&new Date(c.completed_at)>=ps); if(!c)return'Pending';if(c.signed_off_by)return'Done';if(t.supervisor_role)return'Review';return'Done' }
  const total = templates.length, done = templates.filter((t:any)=>status(t)!=='Pending').length

  const ciMut = useMutation({ mutationFn: async () => { if(!profile?.id||!business?.id) throw new Error(''); const m = mood || MOOD_EMOJIS[0]; const{error}=await supabase.from('staff_checkins').insert({user_id:profile.id,business_id:business.id,mood:m,checked_in_at:new Date().toISOString()}); if(error)throw error; await notifyCheckIn(business.id,profile.full_name??profile.email) }, onSuccess:()=>{toast.success('Checked in');setMood(null);qc.invalidateQueries({queryKey:['my-checkin']});qc.invalidateQueries({queryKey:['on-site-staff']})}, onError:()=>toast.error('Failed') })
  const coMut = useMutation({ mutationFn: async () => { if(!checkin?.id||!business?.id||!profile) throw new Error(''); const{error}=await supabase.from('staff_checkins').update({checked_out_at:new Date().toISOString()}).eq('id',checkin.id); if(error)throw error; await notifyCheckOut(business.id,profile.full_name??profile.email) }, onSuccess:()=>{toast.success('Checked out');qc.invalidateQueries({queryKey:['my-checkin']});qc.invalidateQueries({queryKey:['on-site-staff']})}, onError:()=>toast.error('Failed') })

  return (
    <div className="space-y-6">
      {/* Greeting + Check-in widget */}
      <div className="flex items-center justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{greet}, {firstName}</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{format(today, 'EEEE, d MMMM yyyy')}</p>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3">
          {checkin ? (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[13px] font-medium text-foreground">On-site</span>
              <span className="text-[13px] text-muted-foreground">since {format(new Date(checkin.checked_in_at), 'HH:mm')}</span>
              {checkin.mood && <span className="text-lg">{checkin.mood}</span>}
              <button onClick={() => coMut.mutate()} disabled={coMut.isPending} className="ml-2 rounded-lg bg-muted px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent">
                Check out
              </button>
            </>
          ) : (
            <>
              {MOOD_EMOJIS.map((e) => (
                <button key={e} onClick={() => setMood(e)} className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-all',
                  mood === e ? 'bg-primary/15 scale-110 ring-1 ring-primary/30' : 'hover:bg-muted',
                )}>
                  {e}
                </button>
              ))}
              <button onClick={() => ciMut.mutate()} disabled={ciMut.isPending}
                className="ml-2 rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground hover:opacity-90">
                Check in
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Tasks" value={`${done}/${total}`} sub={total > 0 ? `${Math.round((done/total)*100)}% complete` : 'None assigned'} icon={CheckSquare} color="emerald" />
        <StatCard label="Incidents" value={String(incidents.length)} sub={incidents.length === 0 ? 'All clear' : 'Need attention'} alert={incidents.length > 0} icon={AlertTriangle} color="amber" />
        <StatCard label="On-site" value={String(staff.length)} sub="Checked in" icon={Users} color="blue" />
        <StatCard label="FSA Rating" value={business?.fsa_rating ? `${business.fsa_rating}/5` : '—'} sub="Hygiene score" icon={Shield} color="violet" />
      </div>

      {/* Content grid — 4 columns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {/* Tasks — 2 cols */}
        <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-foreground">Today&apos;s tasks</h3>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-muted-foreground" onClick={() => router.push('/checklists')}>All <ChevronRight className="ml-0.5 h-3.5 w-3.5" /></Button>
          </div>
          {templates.length === 0
            ? <p className="py-8 text-center text-[13px] text-muted-foreground">No tasks for your role</p>
            : <div className="space-y-1">{templates.map((t: any) => {
              const s = status(t), d = s !== 'Pending'
              return (
                <button key={t.id} onClick={() => router.push(`/checklists/${t.id}`)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent/50">
                  <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', d ? 'bg-emerald-100 text-emerald-600' : 'bg-muted text-muted-foreground')}>
                    <CheckSquare className="h-4 w-4" strokeWidth={1.7} />
                  </div>
                  <span className={cn('flex-1 truncate text-[13px] font-medium', d ? 'text-muted-foreground line-through' : 'text-foreground')}>{t.name}</span>
                  <Badge variant={d ? 'default' : 'outline'} className="text-[10px]">{s}</Badge>
                </button>
              )
            })}</div>
          }
        </div>

        {/* Incidents — 1 col */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-foreground">Incidents</h3>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-muted-foreground" onClick={() => router.push('/incidents')}>All <ChevronRight className="ml-0.5 h-3.5 w-3.5" /></Button>
          </div>
          {incidents.length === 0
            ? <div className="flex flex-col items-center py-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                  <Shield className="h-5 w-5 text-emerald-600" strokeWidth={1.7} />
                </div>
                <p className="mt-3 text-[13px] font-medium text-foreground">All clear</p>
                <p className="text-[12px] text-muted-foreground">No open incidents</p>
              </div>
            : <div className="space-y-3">{incidents.map((i: any) => (
              <div key={i.id} className="flex gap-3 items-start">
                <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', i.type==='complaint'?'bg-amber-100 text-amber-600':'bg-red-100 text-red-600')}>
                  <AlertTriangle className="h-4 w-4" strokeWidth={1.7} />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-foreground line-clamp-2">{i.description}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{formatDistanceToNow(new Date(i.created_at), {addSuffix:true})}</p>
                </div>
              </div>
            ))}</div>
          }
        </div>

        {/* Notifications — 1 col */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-foreground">Notifications</h3>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-muted-foreground" onClick={() => router.push('/notifications')}>All <ChevronRight className="ml-0.5 h-3.5 w-3.5" /></Button>
          </div>
          {notifs.length === 0
            ? <p className="py-8 text-center text-[13px] text-muted-foreground">No notifications</p>
            : <div className="space-y-1">{notifs.map((n: any) => (
              <div key={n.id} className={cn('rounded-xl px-3 py-2.5', !n.read_at && 'bg-accent/50')}>
                <div className="flex items-start justify-between gap-2">
                  <p className={cn('text-[13px] leading-snug', !n.read_at ? 'font-semibold text-foreground' : 'text-foreground')}>{n.title}</p>
                  {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{formatDistanceToNow(new Date(n.created_at), {addSuffix:true})}</p>
              </div>
            ))}</div>
          }
        </div>

        {/* Staff — full width if manager */}
        {isManager && (
          <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-4">
            <h3 className="mb-4 text-[15px] font-semibold text-foreground">On-site staff</h3>
            {staff.length === 0
              ? <p className="py-6 text-center text-[13px] text-muted-foreground">Nobody on-site right now</p>
              : <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{staff.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl bg-accent/30 px-4 py-3">
                  <Avatar className="h-8 w-8"><AvatarFallback className="bg-blue-100 text-[10px] font-semibold text-blue-700">{getInitials(s.profile?.full_name, s.profile?.email)}</AvatarFallback></Avatar>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{s.profile?.full_name ?? 'Unnamed'}</p>
                    <p className="text-[11px] text-muted-foreground">Since {format(new Date(s.checked_in_at), 'HH:mm')}</p>
                  </div>
                  {s.mood && <span className="ml-auto text-base">{s.mood}</span>}
                </div>
              ))}</div>
            }
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, alert, icon: Icon, color }: { label: string; value: string; sub: string; alert?: boolean; icon: any; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    violet: 'bg-violet-100 text-violet-700',
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-4">
        <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', colors[color] ?? colors.emerald)}>
          <Icon className="h-5 w-5" strokeWidth={1.7} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-muted-foreground">{label}</p>
          <p className={cn('text-[24px] font-bold tabular-nums leading-tight tracking-tight', alert && 'text-amber-600')}>{value}</p>
          <p className="text-[12px] text-muted-foreground">{sub}</p>
        </div>
      </div>
    </div>
  )
}
