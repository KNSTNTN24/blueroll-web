'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { InspectionEmpty, EmptyPrimary, SuppliersArt } from '@/components/shared/inspection-empty'
import { HeaderButton } from '@/components/shared/header-button'

interface Supplier {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  address: string | null
  goods_supplied: string | null
  notes: string | null
  delivery_days: string[] | null
  business_id: string
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const DAY_SHORT: Record<string, string> = { Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'T', Fri: 'F', Sat: 'S', Sun: 'S' }
const TILE = ['#1f7a52', '#5b6472', '#8a6d52', '#4e6e81']
const initials = (n: string) => { const p = n.split(' ').filter(Boolean); return (p.length >= 2 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase() }
const GRID = 'minmax(140px,1.5fr) minmax(90px,1fr) 158px 112px'

interface Form { name: string; goods: string; contact: string; phone: string; address: string; notes: string; days: string[] }
const BLANK: Form = { name: '', goods: '', contact: '', phone: '', address: '', notes: '', days: [] }

export default function SuppliersPage() {
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const qc = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const bid = business?.id

  const [panelOpen, setPanelOpen] = useState(false)
  const [shown, setShown] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(BLANK)

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['suppliers', bid],
    enabled: !!bid,
    queryFn: async () => (await supabase.from('suppliers').select('*').eq('business_id', bid!).order('name')).data as Supplier[] ?? [],
  })

  function openAdd() { setEditId(null); setForm(BLANK); setPanelOpen(true); requestAnimationFrame(() => setShown(true)) }
  function openEdit(s: Supplier) {
    setEditId(s.id)
    setForm({ name: s.name, goods: s.goods_supplied ?? '', contact: s.contact_name ?? '', phone: s.phone ?? '', address: s.address ?? '', notes: s.notes ?? '', days: s.delivery_days ?? [] })
    setPanelOpen(true); requestAnimationFrame(() => setShown(true))
  }
  function closePanel() { setShown(false); setTimeout(() => setPanelOpen(false), 300) }

  const save = useMutation({
    mutationFn: async () => {
      if (!bid) throw new Error('No business')
      const payload = {
        name: form.name.trim(), contact_name: form.contact.trim() || null, phone: form.phone.trim() || null,
        address: form.address.trim() || null, goods_supplied: form.goods.trim() || null, notes: form.notes.trim() || null,
        delivery_days: form.days.length ? DAYS.filter((d) => form.days.includes(d)) : null, business_id: bid,
      }
      if (editId) { const { error } = await supabase.from('suppliers').update(payload).eq('id', editId); if (error) throw error }
      else { const { error } = await supabase.from('suppliers').insert(payload); if (error) throw error }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); toast.success(editId ? 'Supplier updated' : 'Supplier added'); closePanel() },
    onError: (e: Error) => toast.error(e.message),
  })

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('suppliers').delete().eq('id', id); if (error) throw error },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); toast.success('Supplier removed') },
    onError: (e: Error) => toast.error(e.message),
  })

  const canSave = form.name.trim().length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.02em' }}>Suppliers</h1>
          <div style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>{suppliers.length} supplier{suppliers.length === 1 ? '' : 's'} · your approved list, shared across all sites</div>
        </div>
        {isManager && <HeaderButton onClick={openAdd}><Plus className="h-4 w-4" strokeWidth={2} /> Add supplier</HeaderButton>}
      </div>

      {isLoading ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#9aa0a8', fontSize: 13 }}>Loading…</div>
      ) : suppliers.length === 0 ? (
        <InspectionEmpty illustration={SuppliersArt} badge="Inspectors ask where your food comes from"
          title="Build your approved supplier list"
          sentence="Add suppliers once — late deliveries, rejections and expiring documents track themselves across every site.">
          {isManager && <EmptyPrimary onClick={openAdd}><Plus className="h-4 w-4" strokeWidth={2} /> Add your first supplier</EmptyPrimary>}
        </InspectionEmpty>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 10, padding: '11px 20px', borderBottom: '1px solid #eef0f2', background: '#fbfbfc' }}>
            {['Supplier', 'Contact', 'Delivery days', ''].map((h, i) => (
              <span key={i} style={{ font: "600 11px 'Geist'", letterSpacing: '.06em', textTransform: 'uppercase', color: '#9aa0a8' }}>{h}</span>
            ))}
          </div>
          {suppliers.map((s, i) => {
            const goods = s.goods_supplied?.trim() || 'Goods not set'
            const subline = [goods, s.notes?.trim()].filter(Boolean).join(' · ')
            return (
              <div key={s.id} className="sup-row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 10, padding: '13px 20px', borderBottom: i === suppliers.length - 1 ? 'none' : '1px solid #f2f3f5', alignItems: 'center', transition: 'background .14s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 12px 'Geist'", flex: 'none', background: TILE[i % TILE.length] }}>{initials(s.name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ font: "600 14px 'Geist'", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subline}</div>
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ font: "500 13.5px 'Geist'", color: '#41464d', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.contact_name?.trim() || '—'}</div>
                  <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{s.phone?.trim() || '—'}</div>
                </div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {DAYS.map((d) => {
                    const on = (s.delivery_days ?? []).includes(d)
                    return <span key={d} style={{ width: 20, height: 20, borderRadius: 5, background: on ? '#e7f0ea' : '#f5f6f7', color: on ? '#1a6e49' : '#c2c6cc', font: `${on ? 600 : 500} 10px 'Geist'`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{DAY_SHORT[d]}</span>
                  })}
                </div>
                {isManager ? (
                  <div className="sup-actions" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', opacity: 0, transition: 'opacity .14s' }}>
                    <button onClick={() => openEdit(s)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #e2e4e8', background: '#fff', color: '#41464d', font: "600 12.5px 'Geist'", padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#cdd1d6'; e.currentTarget.style.color = '#1c1f24' }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.color = '#41464d' }}>
                      <Pencil className="h-[13px] w-[13px]" strokeWidth={1.8} /> Edit
                    </button>
                    <button onClick={() => { if (confirm(`Remove ${s.name}?`)) del.mutate(s.id) }} title="Delete" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, border: '1px solid #e2e4e8', background: '#fff', color: '#9aa0a8', borderRadius: 8, cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#eec7c5'; e.currentTarget.style.color = '#c0403a'; e.currentTarget.style.background = '#fdf6f6' }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.color = '#9aa0a8'; e.currentTarget.style.background = '#fff' }}>
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </div>
                ) : <span />}
              </div>
            )
          })}
        </div>
      )}

      {/* slide-over */}
      {panelOpen && (
        <>
          <div onClick={closePanel} style={{ position: 'fixed', inset: 0, background: 'rgba(20,22,27,.36)', zIndex: 60, opacity: shown ? 1 : 0, transition: 'opacity .3s ease-out' }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 460, maxWidth: '94vw', background: '#fff', zIndex: 61, boxShadow: '-24px 0 60px -30px rgba(16,24,40,.4)', display: 'flex', flexDirection: 'column', transform: shown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .3s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #eef0f2' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-.01em' }}>{editId ? 'Edit supplier' : 'Add supplier'}</h2>
              <button onClick={closePanel} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: '#f1f2f4', color: '#5c626b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X className="h-[17px] w-[17px]" strokeWidth={2} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              <Field label="Supplier name" required><Input value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="e.g. Brindisa" autoFocus /></Field>
              <Field label="Goods supplied"><Input value={form.goods} onChange={(v) => setForm((f) => ({ ...f, goods: v }))} placeholder="e.g. Fresh produce, dairy" /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Contact name"><Input value={form.contact} onChange={(v) => setForm((f) => ({ ...f, contact: v }))} placeholder="Contact person" /></Field>
                <Field label="Phone"><Input value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="Phone number" /></Field>
              </div>
              <Field label="Address"><Input value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} placeholder="Full address" /></Field>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <label style={{ font: "600 13px 'Geist'", color: '#41464d' }}>Delivery days</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {DAYS.map((d) => {
                    const on = form.days.includes(d)
                    return (
                      <button key={d} onClick={() => setForm((f) => ({ ...f, days: on ? f.days.filter((x) => x !== d) : [...f.days, d] }))}
                        style={{ flex: 1, border: on ? '1px solid #1f9d63' : '1px solid #e2e4e8', background: on ? '#e7f0ea' : '#fff', color: on ? '#1a6e49' : '#8a9099', font: `${on ? 600 : 500} 12.5px 'Geist'`, padding: '9px 0', borderRadius: 9, cursor: 'pointer' }}>{DAY_SHORT[d]}</button>
                    )
                  })}
                </div>
              </div>
              <Field label="Notes"><Input value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} placeholder="e.g. min order £150" /></Field>
            </div>
            <div style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #eef0f2' }}>
              <button onClick={closePanel} style={{ background: '#fff', border: '1px solid #e2e4e8', color: '#41464d', font: "600 14px 'Geist'", padding: '11px 18px', borderRadius: 11, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => save.mutate()} disabled={!canSave || save.isPending}
                style={{ background: canSave ? '#1f9d63' : '#a9d8c0', border: 'none', color: '#fff', font: "600 14px 'Geist'", padding: '11px 20px', borderRadius: 11, cursor: canSave ? 'pointer' : 'not-allowed', boxShadow: canSave ? '0 1px 2px rgba(16,24,40,.1)' : 'none' }}>
                {save.isPending ? 'Saving…' : editId ? 'Save changes' : 'Add supplier'}
              </button>
            </div>
          </div>
        </>
      )}

      <style>{`.sup-row:hover .sup-actions{opacity:1 !important}`}</style>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <label style={{ font: "600 13px 'Geist'", color: '#41464d' }}>{label}{required && <span style={{ color: '#c0403a' }}> *</span>}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <input value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      style={{ border: '1px solid #e2e4e8', borderRadius: 10, padding: '11px 13px', font: "500 14px 'Geist'", color: '#16181d', outline: 'none', width: '100%' }}
      onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' }}
      onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
  )
}
