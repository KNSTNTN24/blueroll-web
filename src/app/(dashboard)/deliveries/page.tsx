'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Plus, Camera, ChevronRight, X, Image as ImageIcon } from 'lucide-react'
import { format, subDays, parseISO } from 'date-fns'
import { InspectionEmpty, EmptyPrimary, DeliveriesArt } from '@/components/shared/inspection-empty'
import { HeaderButton } from '@/components/shared/header-button'

interface Delivery {
  id: string
  supplier_id: string
  product_temperature: number | null
  notes: string | null
  photos: string[] | null
  received_at: string
  site_id: string | null
  supplier?: { name: string } | null
  receiver?: { full_name: string | null; email: string } | null
}

const TILE = ['#1f7a52', '#5b6472', '#8a6d52', '#4e6e81']
const initials = (n: string) => { const p = n.split(' ').filter(Boolean); return (p.length >= 2 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase() }
const tempMeta = (t: number | null) =>
  t === null ? null
    : t <= 5 ? { bg: '#eaf4ee', fg: '#1a6e49', dot: '#1f9d63' }
      : t <= 8 ? { bg: '#fbf1e1', fg: '#b07d1e', dot: '#d98a1a' }
        : { bg: '#fbecec', fg: '#c0403a', dot: '#d2453f' }

export default function DeliveriesPage() {
  const business = useAuthStore((s) => s.business)
  const profile = useAuthStore((s) => s.profile)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  const sites = useAuthStore((s) => s.sites)
  const qc = useQueryClient()
  const bid = business?.id
  const allSites = sites.length > 1 && !currentSiteId
  const siteName = (id: string | null) => (id ? (sites.find((s) => s.id === id)?.name ?? 'Site') : '—')

  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)
  const [fSite, setFSite] = useState<string>('')
  const [fSupplier, setFSupplier] = useState<string>('')
  const [fTemp, setFTemp] = useState('')
  const [fNotes, setFNotes] = useState('')
  const [fWhen] = useState(new Date())

  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ['deliveries', bid, currentSiteId],
    enabled: !!bid,
    queryFn: async () => {
      let q = supabase.from('deliveries').select('id, supplier_id, product_temperature, notes, received_at, site_id, supplier:suppliers(name), receiver:profiles!deliveries_received_by_fkey(full_name, email)').eq('business_id', bid!)
      if (currentSiteId) q = q.eq('site_id', currentSiteId)
      return (await q.order('received_at', { ascending: false })).data as unknown as Delivery[] ?? []
    },
  })

  const { data: suppliers = [] } = useQuery({
    queryKey: ['delivery-suppliers', bid],
    enabled: !!bid,
    queryFn: async () => (await supabase.from('suppliers').select('id, name').eq('business_id', bid!).order('name')).data as { id: string; name: string }[] ?? [],
  })

  const supplierColor = (id: string) => TILE[(suppliers.findIndex((s) => s.id === id) + 4) % TILE.length]

  // summary
  const weekAgo = subDays(new Date(), 7)
  const thisWeek = deliveries.filter((d) => new Date(d.received_at) >= weekAgo).length
  const breaches = deliveries.filter((d) => d.product_temperature !== null && d.product_temperature > 5).length
  const missingPhoto = deliveries.filter((d) => !d.photos || d.photos.length === 0).length
  const last = deliveries[0]

  function openPanel() { setFSite(currentSiteId ?? ''); setFSupplier(''); setFTemp(''); setFNotes(''); setOpen(true); requestAnimationFrame(() => setShown(true)) }
  function closePanel() { setShown(false); setTimeout(() => setOpen(false), 300) }

  const save = useMutation({
    mutationFn: async () => {
      if (!bid || !profile?.id) throw new Error('No business')
      const site = currentSiteId ?? (fSite || null)
      const { error } = await supabase.from('deliveries').insert({
        business_id: bid, site_id: site, supplier_id: fSupplier, received_by: profile.id,
        received_at: fWhen.toISOString(), product_temperature: fTemp ? parseFloat(fTemp) : null, notes: fNotes.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deliveries'] }); toast.success('Delivery recorded'); closePanel() },
    onError: (e: Error) => toast.error(e.message),
  })

  const tempNum = fTemp ? parseFloat(fTemp) : null
  const tempWarn = tempNum !== null && !Number.isNaN(tempNum) && tempNum > 5
  const canSave = !!fSupplier && (!allSites || !!fSite)
  const GRID = allSites ? 'minmax(140px,1.4fr) 100px 130px minmax(80px,1fr) 96px 84px' : 'minmax(150px,1.5fr) 140px minmax(90px,1fr) 100px 84px'

  const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e7e9ec', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 10px 28px -24px rgba(16,24,40,.14)' }
  const EYE: React.CSSProperties = { font: "600 11px 'Geist'", letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa0a8', whiteSpace: 'nowrap' }
  const HEAD = allSites ? ['Supplier', 'Site', 'Received', 'By', 'Temp', 'Photo'] : ['Supplier', 'Received', 'By', 'Temp', 'Photo']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.02em' }}>Deliveries</h1>
          <div style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>Goods-in temperature checks — your delivery due-diligence record</div>
        </div>
        <HeaderButton onClick={openPanel}><Plus className="h-4 w-4" strokeWidth={2} /> New delivery</HeaderButton>
      </div>

      {isLoading ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#9aa0a8', fontSize: 13 }}>Loading…</div>
      ) : deliveries.length === 0 ? (
        <InspectionEmpty illustration={DeliveriesArt} badge="Inspectors ask how you check goods in"
          title="Log every delivery in seconds"
          sentence="A temperature check at the door becomes a timestamped record — proof your food came in safe.">
          <EmptyPrimary onClick={openPanel}><Plus className="h-4 w-4" strokeWidth={2} /> Log your first delivery</EmptyPrimary>
        </InspectionEmpty>
      ) : (
        <>
          {/* summary strip */}
          <div style={{ ...CARD, display: 'flex', overflow: 'hidden' }}>
            <Cell eye={EYE} label="This week" value={String(thisWeek)} />
            <Div />
            <Cell eye={EYE} label="Temp breaches" value={String(breaches)} dot={breaches ? '#d2453f' : undefined} />
            <Div />
            <Cell eye={EYE} label="Missing photo" value={String(missingPhoto)} dot={missingPhoto ? '#d98a1a' : undefined} />
            <Div />
            <Cell eye={EYE} label="Last delivery" value={last ? format(parseISO(last.received_at), 'd MMM') : '—'} valueSize={20}
              sub={last ? `${last.supplier?.name ?? 'Supplier'} · ${format(parseISO(last.received_at), 'HH:mm')}` : undefined} />
          </div>

          {/* list */}
          <div style={{ ...CARD, borderColor: '#e9eaed', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: allSites ? 720 : 640 }}>
                <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '11px 20px', borderBottom: '1px solid #eef0f2', background: '#fbfbfc' }}>
                  {HEAD.map((h, i) => <span key={h} style={{ ...EYE, textAlign: i >= HEAD.length - 2 ? 'right' : 'left' }}>{h}</span>)}
                </div>
                {deliveries.map((d, i) => {
                  const tm = tempMeta(d.product_temperature)
                  const photoCount = d.photos?.length ?? 0
                  return (
                    <div key={d.id} className="del-row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '13px 20px', borderBottom: i === deliveries.length - 1 ? 'none' : '1px solid #f2f3f5', alignItems: 'center', transition: 'background .14s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 9, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 11.5px 'Geist'", flex: 'none', background: supplierColor(d.supplier_id) }}>{initials(d.supplier?.name ?? '?')}</div>
                        <span style={{ font: "600 14px 'Geist'", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.supplier?.name ?? 'Supplier'}</span>
                      </div>
                      {allSites && <span style={{ font: "500 13px 'Geist'", color: '#5c626b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{siteName(d.site_id)}</span>}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ font: "500 13.5px 'Geist'", color: '#41464d', whiteSpace: 'nowrap' }}>{format(parseISO(d.received_at), 'd MMM yyyy')}</div>
                        <div style={{ fontSize: 12, color: '#9aa0a8', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{format(parseISO(d.received_at), 'HH:mm')}</div>
                      </div>
                      <span style={{ font: "500 13px 'Geist'", color: '#5c626b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.receiver?.full_name ?? '—'}</span>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        {tm ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: "600 12.5px 'Geist'", padding: '4px 10px', borderRadius: 20, background: tm.bg, color: tm.fg, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: tm.dot }} />{d.product_temperature}°C</span>
                        ) : <span style={{ font: "500 13px 'Geist'", color: '#b0b5bc' }}>—</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                        {photoCount > 0 ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: "600 12px 'Geist'", padding: '4px 9px', borderRadius: 20, background: '#eaf4ee', color: '#1a6e49' }}><Camera className="h-3 w-3" strokeWidth={2} />{photoCount}</span>
                        ) : <span style={{ font: "500 13px 'Geist'", color: '#b0b5bc' }}>—</span>}
                        <ChevronRight className="del-go h-[15px] w-[15px]" strokeWidth={1.8} style={{ color: '#c2c6cc', opacity: 0, transition: 'opacity .14s' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* slide-over */}
      {open && (
        <>
          <div onClick={closePanel} style={{ position: 'fixed', inset: 0, background: 'rgba(20,22,27,.36)', zIndex: 60, opacity: shown ? 1 : 0, transition: 'opacity .3s ease-out' }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 460, maxWidth: '94vw', background: '#fff', zIndex: 61, boxShadow: '-24px 0 60px -30px rgba(16,24,40,.4)', display: 'flex', flexDirection: 'column', transform: shown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .3s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ flex: 'none', padding: '20px 24px', borderBottom: '1px solid #eef0f2', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-.01em' }}>New delivery</h2>
                <div style={{ fontSize: 13, color: '#8a9099', marginTop: 2 }}>Recording for {currentSiteId ? siteName(currentSiteId) : (fSite ? siteName(fSite) : 'your group')}</div>
              </div>
              <button onClick={closePanel} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: '#f1f2f4', color: '#5c626b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X className="h-[17px] w-[17px]" strokeWidth={2} /></button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              {allSites && (
                <FieldChips label="Site" required options={sites.map((s) => ({ id: s.id, name: s.name }))} value={fSite} onPick={setFSite} />
              )}
              <FieldChips label="Supplier" required options={suppliers} value={fSupplier} onPick={setFSupplier} empty="No approved suppliers yet — add one in Suppliers." />
              <div>
                <Label>Date &amp; time</Label>
                <div style={{ border: '1px solid #e2e4e8', borderRadius: 10, padding: '11px 13px', font: "500 14px 'Geist'", color: '#41464d' }}>{format(fWhen, 'd MMM yyyy, HH:mm')} <span style={{ color: '#9aa0a8' }}>· now</span></div>
              </div>
              <div>
                <Label>Temperature (°C)</Label>
                <input value={fTemp} onChange={(e) => setFTemp(e.target.value)} inputMode="decimal" placeholder="e.g. 3.5"
                  style={{ width: '100%', border: `1px solid ${tempWarn ? '#e2b87e' : '#e2e4e8'}`, borderRadius: 10, padding: '11px 13px', font: "500 14px 'Geist'", color: '#16181d', outline: 'none' }}
                  onFocus={(e) => { if (!tempWarn) { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' } }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = tempWarn ? '#e2b87e' : '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
                <div style={{ fontSize: 12, color: tempWarn ? '#b07d1e' : '#9aa0a8', marginTop: 7, lineHeight: 1.5 }}>{tempWarn ? 'Above 5°C for chilled goods — check and consider rejecting.' : 'Leave empty if not applicable (e.g. ambient goods).'}</div>
              </div>
              <div>
                <Label>Photo</Label>
                <div style={{ border: '1.5px dashed #d0d5d9', borderRadius: 12, padding: '20px', textAlign: 'center', color: '#8a9099', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <ImageIcon className="h-5 w-5" strokeWidth={1.7} style={{ color: '#c2c6cc' }} />
                  <span style={{ fontSize: 12.5 }}>Add a photo of the delivery or label</span>
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={3} placeholder="Anything worth recording…"
                  style={{ width: '100%', border: '1px solid #e2e4e8', borderRadius: 10, padding: '11px 13px', font: "500 14px 'Geist'", color: '#16181d', outline: 'none', resize: 'vertical' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
              </div>
            </div>
            <div style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #eef0f2' }}>
              <button onClick={closePanel} style={{ background: '#fff', border: '1px solid #e2e4e8', color: '#41464d', font: "600 14px 'Geist'", padding: '11px 18px', borderRadius: 11, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => save.mutate()} disabled={!canSave || save.isPending}
                style={{ background: canSave ? '#1f9d63' : '#a9d8c0', border: 'none', color: '#fff', font: "600 14px 'Geist'", padding: '11px 20px', borderRadius: 11, cursor: canSave ? 'pointer' : 'not-allowed', boxShadow: canSave ? '0 1px 2px rgba(16,24,40,.1)' : 'none' }}>
                {save.isPending ? 'Recording…' : 'Record delivery'}
              </button>
            </div>
          </div>
        </>
      )}

      <style>{`.del-row:hover .del-go{opacity:1 !important}`}</style>
    </div>
  )
}

function Div() { return <div style={{ width: 1, background: '#eef0f2', margin: '15px 0' }} /> }
function Label({ children }: { children: React.ReactNode }) { return <label style={{ font: "600 13px 'Geist'", color: '#41464d', display: 'block', marginBottom: 8 }}>{children}</label> }

function Cell({ eye, label, value, sub, dot, valueSize }: { eye: React.CSSProperties; label: string; value: string; sub?: string; dot?: string; valueSize?: number }) {
  return (
    <div style={{ flex: 1, padding: '16px 20px', minWidth: 0 }}>
      <div style={eye}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
        {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flex: 'none' }} />}
        <span style={{ fontWeight: 700, fontSize: valueSize ?? 24, lineHeight: 1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
      </div>
      {sub && <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  )
}

function FieldChips({ label, required, options, value, onPick, empty }: { label: string; required?: boolean; options: { id: string; name: string }[]; value: string; onPick: (id: string) => void; empty?: string }) {
  return (
    <div>
      <Label>{label}{required && <span style={{ color: '#c0403a' }}> *</span>}</Label>
      {options.length === 0 ? (
        <div style={{ fontSize: 12.5, color: '#9aa0a8' }}>{empty ?? 'None available.'}</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {options.map((o) => {
            const on = value === o.id
            return (
              <button key={o.id} onClick={() => onPick(o.id)}
                style={{ border: on ? '1.5px solid #1f9d63' : '1px solid #e2e4e8', background: on ? '#f5faf7' : '#fff', color: on ? '#1a6e49' : '#5c626b', font: "600 13px 'Geist'", padding: '8px 13px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>{o.name}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}
