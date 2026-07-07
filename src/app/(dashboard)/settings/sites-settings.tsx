'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useAuth } from '@/hooks/use-auth'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Plus, Building2, Trash2, Check, X } from 'lucide-react'

const AVATAR = ['#1f7a52', '#5b6472', '#8a6d52', '#4e6e81']
const initials = (n: string) => { const p = n.split(' ').filter(Boolean); return (p.length >= 2 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase() }

export function SitesSettings() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const { refreshProfile } = useAuth()
  const bid = business?.id

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [postcode, setPostcode] = useState('')
  const [rating, setRating] = useState('5')
  const [kitchen, setKitchen] = useState<'copy' | 'own' | 'shared'>('shared')
  const [copyFrom, setCopyFrom] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const { data: members = [] } = useQuery({
    queryKey: ['sites-members', bid],
    enabled: !!bid,
    queryFn: async () => (await supabase.from('profiles').select('id, full_name, site_id').eq('business_id', bid!)).data ?? [],
  })
  const memberCount = (siteId: string) => (members as any[]).filter((m) => m.site_id === siteId).length
  const managerName = (id: string | null) => (members as any[]).find((m) => m.id === id)?.full_name ?? null

  async function addSite(e: React.FormEvent) {
    e.preventDefault()
    if (!bid || !name.trim()) return
    setBusy(true)
    try {
      const { data: site, error } = await supabase.from('sites').insert({
        business_id: bid, name: name.trim(), postcode: postcode.trim() || null, fsa_rating: rating, status: 'onboarding',
      }).select('id').single()
      if (error) throw error
      if (kitchen === 'copy' && copyFrom && site?.id) {
        const { error: cerr } = await supabase.rpc('copy_kitchen', { from_site: copyFrom, to_site: site.id })
        if (cerr) throw cerr
      }
      toast.success('Site added')
      setAdding(false); setName(''); setPostcode(''); setRating('5'); setKitchen('shared'); setCopyFrom('')
      await refreshProfile()
    } catch (err: any) {
      toast.error(err.message || 'Failed to add site')
    } finally { setBusy(false) }
  }

  async function removeSite(id: string, siteName: string) {
    if (sites.length <= 1) { toast.error('A group must keep at least one site.'); return }
    if (!confirm(`Delete ${siteName}? Its checklists, incidents and other site data will be removed. This cannot be undone.`)) return
    const { error } = await supabase.from('sites').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Site deleted')
    await refreshProfile()
  }

  return (
    <div className="rounded-[14px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold text-foreground">Sites</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Kitchens in {business?.name ?? 'your group'} · {sites.length} {sites.length === 1 ? 'site' : 'sites'}</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90">
            <Plus className="h-4 w-4" strokeWidth={2} /> Add site
          </button>
        )}
      </div>

      {/* Add-site form */}
      {adding && (
        <form onSubmit={addSite} className="mt-4 rounded-[12px] border border-border bg-[#fafbfb] p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-foreground">Add a site</h3>
            <button type="button" onClick={() => setAdding(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Site name">
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Camden" className={inputCls} />
            </Field>
            <Field label="Postcode">
              <input value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="e.g. NW1 8QP" className={inputCls} />
            </Field>
            <Field label="FSA rating">
              <select value={rating} onChange={(e) => setRating(e.target.value)} className={inputCls}>
                {['5', '4', '3', '2', '1', '0', 'Exempt', 'Awaiting'].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Kitchen for this site</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <KitchenOpt active={kitchen === 'shared'} onClick={() => setKitchen('shared')} title="Use shared" body="Reads the group's recipes & suppliers." />
            <KitchenOpt active={kitchen === 'copy'} onClick={() => setKitchen('copy')} title="Copy" body="Start with an editable copy of another site." />
            <KitchenOpt active={kitchen === 'own'} onClick={() => setKitchen('own')} title="Start own" body="Empty — define its own from scratch." />
          </div>
          {kitchen === 'copy' && (
            <div className="mt-2">
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} required className={inputCls}>
                <option value="">Copy kitchen from…</option>
                <option value="">The group (shared recipes)</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-[10px] border border-input bg-card px-3.5 py-2 text-[13px] font-semibold text-[#5c626b] hover:bg-accent">Cancel</button>
            <button type="submit" disabled={busy || !name.trim()} className="rounded-[10px] bg-brand px-3.5 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {busy ? 'Adding…' : 'Add site'}
            </button>
          </div>
        </form>
      )}

      {/* Sites list */}
      <div className="mt-4 divide-y divide-[#f2f3f5]">
        {sites.map((s, i) => (
          <div key={s.id} className="group flex items-center gap-3 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[12px] font-bold text-white" style={{ background: AVATAR[i % AVATAR.length] }}>
              {s.name ? initials(s.name) : <Building2 className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[14px] font-semibold text-foreground">{s.name}</span>
                {s.status === 'onboarding' && <span className="rounded-md bg-[#fbf1e1] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#b07d1e]">Onboarding</span>}
              </div>
              <p className="text-[12px] text-muted-foreground">
                {[s.postcode, managerName(s.manager_id) && `Manager: ${managerName(s.manager_id)}`, `${memberCount(s.id)} member${memberCount(s.id) === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
              </p>
            </div>
            {s.fsa_rating && (
              <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-bold', s.fsa_rating === '5' ? 'bg-brand-tint text-brand-deep' : 'bg-secondary text-[#5c626b]')}>
                {s.fsa_rating === 'Exempt' || s.fsa_rating === 'Awaiting' ? '—' : s.fsa_rating}
              </span>
            )}
            <button onClick={() => removeSite(s.id, s.name)} aria-label="Delete site"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#c2c6cc] opacity-0 transition hover:bg-warn-tint hover:text-warn group-hover:opacity-100">
              <Trash2 className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-[10px] border border-input bg-card px-3 py-2 text-[14px] text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-brand focus:ring-[3px] focus:ring-[rgba(31,157,99,.12)]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[13px] font-semibold text-[#41464d]">{label}</span>{children}</label>
}

function KitchenOpt({ active, onClick, title, body }: { active: boolean; onClick: () => void; title: string; body: string }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-[10px] border p-3 text-left transition-colors', active ? 'border-[1.5px] border-brand bg-[#f5faf7]' : 'border-input bg-card hover:border-[#cdd1d6]')}>
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">{active && <Check className="h-3.5 w-3.5 text-brand" strokeWidth={2.4} />}{title}</span>
      <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{body}</span>
    </button>
  )
}
