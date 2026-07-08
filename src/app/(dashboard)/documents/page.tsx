'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Plus, Eye, Download, Trash2, X, FileText, AlertTriangle, Clock, FolderCheck } from 'lucide-react'
import { format, differenceInDays } from 'date-fns'
import { InspectionEmpty, EmptyPrimary, DocumentsArt } from '@/components/shared/inspection-empty'
import { HeaderButton } from '@/components/shared/header-button'
import { DOCUMENT_CATEGORIES } from '@/lib/constants'

interface Doc {
  id: string; title: string; category: string; file_url: string; file_name: string
  file_size: number | null; file_type: string | null; access_level: string
  expires_at: string | null; site_id: string | null; created_at: string
  uploader?: { full_name: string | null; email: string } | null
}

const fmtSize = (b: number | null) => (!b ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`)

function expiry(d: Doc) {
  if (!d.expires_at) return { kind: 'none' as const, days: Infinity, bg: '#f1f2f4', fg: '#8a9099', label: 'No expiry' }
  const days = differenceInDays(new Date(d.expires_at), new Date())
  if (days < 0) return { kind: 'expired' as const, days, bg: '#fbecec', fg: '#c0403a', label: 'Expired' }
  if (days <= 30) return { kind: 'soon' as const, days, bg: '#fbf1e1', fg: '#b07d1e', label: `${days}d left` }
  return { kind: 'valid' as const, days, bg: '#eaf4ee', fg: '#1a6e49', label: format(new Date(d.expires_at), 'd MMM yyyy') }
}
const rank = { expired: 0, soon: 1, valid: 2, none: 3 }

export default function DocumentsPage() {
  const business = useAuthStore((s) => s.business)
  const profile = useAuthStore((s) => s.profile)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  const sites = useAuthStore((s) => s.sites)
  const qc = useQueryClient()
  const bid = business?.id
  const allSites = sites.length > 1 && !currentSiteId
  const siteName = (id: string | null) => (id ? (sites.find((s) => s.id === id)?.name ?? 'Site') : 'All sites')

  const [category, setCategory] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'expired' | 'soon' | null>(null)
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fTitle, setFTitle] = useState('')
  const [fCat, setFCat] = useState('other')
  const [fSite, setFSite] = useState('')
  const [fExpiry, setFExpiry] = useState('')
  const [fAccess, setFAccess] = useState('all')

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', bid, currentSiteId],
    enabled: !!bid,
    queryFn: async () => {
      let q = supabase.from('documents').select('id, title, category, file_url, file_name, file_size, file_type, access_level, expires_at, site_id, created_at, uploader:profiles!documents_uploaded_by_fkey(full_name, email)').eq('business_id', bid!)
      if (currentSiteId) q = q.eq('site_id', currentSiteId)
      return (await q.order('created_at', { ascending: false })).data as unknown as Doc[] ?? []
    },
  })

  const counts = useMemo(() => {
    let expired = 0, soon = 0
    documents.forEach((d) => { const e = expiry(d); if (e.kind === 'expired') expired++; else if (e.kind === 'soon') soon++ })
    return { expired, soon, total: documents.length }
  }, [documents])

  const rows = useMemo(() => documents
    .filter((d) => category === 'all' || d.category === category)
    .filter((d) => { if (!statusFilter) return true; return expiry(d).kind === statusFilter })
    .map((d) => ({ d, e: expiry(d) }))
    .sort((a, b) => rank[a.e.kind] - rank[b.e.kind] || a.e.days - b.e.days),
  [documents, category, statusFilter])

  function openPanel() { setFile(null); setFTitle(''); setFCat('other'); setFSite(currentSiteId ?? ''); setFExpiry(''); setFAccess('all'); setOpen(true); requestAnimationFrame(() => setShown(true)) }
  function closePanel() { setShown(false); setTimeout(() => setOpen(false), 300) }

  async function preview(d: Doc) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(d.file_url, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  async function download(d: Doc) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(d.file_url, 120, { download: d.file_name })
    if (data?.signedUrl) { const a = document.createElement('a'); a.href = data.signedUrl; a.download = d.file_name; a.click() }
  }
  const del = useMutation({
    mutationFn: async (d: Doc) => {
      await supabase.storage.from('documents').remove([d.file_url])
      const { error } = await supabase.from('documents').delete().eq('id', d.id); if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); toast.success('Document deleted') },
    onError: (e: Error) => toast.error(e.message),
  })

  const upload = useMutation({
    mutationFn: async () => {
      if (!bid || !profile?.id || !file) throw new Error('Missing data')
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${bid}/${Date.now()}_${safe}`
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file); if (upErr) throw upErr
      const { error } = await supabase.from('documents').insert({
        business_id: bid, site_id: currentSiteId ?? (fSite || null), title: fTitle.trim() || file.name, category: fCat,
        file_url: path, file_name: file.name, file_size: file.size, file_type: file.type || null,
        access_level: fAccess, expires_at: fExpiry ? new Date(fExpiry).toISOString() : null, uploaded_by: profile.id,
      })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); toast.success('Document uploaded'); closePanel() },
    onError: (e: Error) => toast.error(e.message),
  })

  const canUpload = !!file && !!fTitle.trim() && (!allSites || !!fSite)
  const GRID = allSites ? 'minmax(160px,1.7fr) 110px 116px 130px 110px' : 'minmax(180px,2fr) 116px 130px 110px'
  const HEAD = allSites ? ['Document', 'Site', 'Category', 'Expiry', ''] : ['Document', 'Category', 'Expiry', '']
  const EYE: React.CSSProperties = { font: "600 11px 'Geist'", letterSpacing: '.06em', textTransform: 'uppercase', color: '#9aa0a8' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.02em' }}>Documents</h1>
          <div style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>Certificates, policies and inspection paperwork — organised by expiry</div>
        </div>
        <HeaderButton onClick={openPanel}><Plus className="h-4 w-4" strokeWidth={2} /> Upload</HeaderButton>
      </div>

      {isLoading ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#9aa0a8', fontSize: 13 }}>Loading…</div>
      ) : documents.length === 0 ? (
        <InspectionEmpty illustration={DocumentsArt} badge="Inspectors ask for these on the spot"
          title="Keep your paperwork inspection-ready"
          sentence="Certificates and reports for every site in one place — with expiry reminders.">
          <EmptyPrimary onClick={openPanel}><Plus className="h-4 w-4" strokeWidth={2} /> Upload your first document</EmptyPrimary>
        </InspectionEmpty>
      ) : (
        <>
          {/* summary cards (clickable filters) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            <SummaryCard icon={<AlertTriangle className="h-[18px] w-[18px]" strokeWidth={1.9} />} tint="#fbecec" fg="#c0403a" label="Expired" value={counts.expired}
              active={statusFilter === 'expired'} onClick={() => setStatusFilter((s) => s === 'expired' ? null : 'expired')} />
            <SummaryCard icon={<Clock className="h-[18px] w-[18px]" strokeWidth={1.9} />} tint="#fbf1e1" fg="#b07d1e" label="Expiring in 30 days" value={counts.soon}
              active={statusFilter === 'soon'} onClick={() => setStatusFilter((s) => s === 'soon' ? null : 'soon')} />
            <SummaryCard icon={<FolderCheck className="h-[18px] w-[18px]" strokeWidth={1.9} />} tint="#eaf4ee" fg="#1a6e49" label="Documents on file" value={counts.total} />
          </div>

          {/* category pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(['all', ...DOCUMENT_CATEGORIES] as string[]).map((c) => {
              const on = category === c
              return (
                <button key={c} onClick={() => setCategory(c)}
                  style={{ border: on ? '1px solid #bfe0cd' : '1px solid #e7e9ec', background: on ? '#eaf4ee' : '#fff', color: on ? '#1a6e49' : '#5c626b', font: "600 12.5px 'Geist'", padding: '6px 13px', borderRadius: 20, cursor: 'pointer', textTransform: 'capitalize' }}>{c}</button>
              )
            })}
          </div>

          {/* list */}
          <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '11px 20px', borderBottom: '1px solid #eef0f2', background: '#fbfbfc' }}>
              {HEAD.map((h, i) => <span key={i} style={{ ...EYE, textAlign: i === HEAD.length - 1 ? 'right' : 'left' }}>{h}</span>)}
            </div>
            {rows.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: '#8a9099', fontSize: 13.5 }}>No documents match this filter.</div>
            ) : rows.map(({ d, e }, i) => (
              <div key={d.id} className="doc-row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '13px 20px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid #f2f3f5', alignItems: 'center', transition: 'background .14s' }}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = '#fafbfb')} onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: '#f1f2f4', color: '#8a9099', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><FileText className="h-4 w-4" strokeWidth={1.7} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ font: "600 14px 'Geist'", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</div>
                    <div style={{ fontSize: 12, color: '#9aa0a8', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[fmtSize(d.file_size), d.uploader?.full_name].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
                {allSites && <span style={{ font: "500 13px 'Geist'", color: '#5c626b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{siteName(d.site_id)}</span>}
                <span><span style={{ font: "500 11.5px 'Geist'", color: '#5c626b', background: '#f1f2f4', padding: '3px 9px', borderRadius: 20, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{d.category}</span></span>
                <span><span style={{ display: 'inline-flex', alignItems: 'center', font: "600 12px 'Geist'", padding: '4px 10px', borderRadius: 20, background: e.bg, color: e.fg, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{e.label}</span></span>
                <div className="doc-actions" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', opacity: 0, transition: 'opacity .14s' }}>
                  <IconBtn title="Preview" onClick={() => preview(d)}><Eye className="h-4 w-4" strokeWidth={1.8} /></IconBtn>
                  <IconBtn title="Download" onClick={() => download(d)}><Download className="h-4 w-4" strokeWidth={1.8} /></IconBtn>
                  <IconBtn title="Delete" danger onClick={() => { if (confirm(`Delete ${d.title}?`)) del.mutate(d) }}><Trash2 className="h-4 w-4" strokeWidth={1.8} /></IconBtn>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* upload slide-over */}
      {open && (
        <>
          <div onClick={closePanel} style={{ position: 'fixed', inset: 0, background: 'rgba(20,22,27,.36)', zIndex: 60, opacity: shown ? 1 : 0, transition: 'opacity .3s ease-out' }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 460, maxWidth: '94vw', background: '#fff', zIndex: 61, boxShadow: '-24px 0 60px -30px rgba(16,24,40,.4)', display: 'flex', flexDirection: 'column', transform: shown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .3s cubic-bezier(0.32,0.72,0,1)' }}>
            <div style={{ flex: 'none', padding: '20px 24px', borderBottom: '1px solid #eef0f2', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-.01em' }}>Upload document</h2>
                <div style={{ fontSize: 13, color: '#8a9099', marginTop: 2 }}>Add to {currentSiteId ? siteName(currentSiteId) : (fSite ? siteName(fSite) : 'your group')}</div>
              </div>
              <button onClick={closePanel} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: '#f1f2f4', color: '#5c626b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X className="h-[17px] w-[17px]" strokeWidth={2} /></button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <Label>File <span style={{ color: '#c0403a' }}>*</span></Label>
                {file ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #e2e4e8', borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: '#f1f2f4', color: '#8a9099', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><FileText className="h-4 w-4" strokeWidth={1.7} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ font: "600 13.5px 'Geist'", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</div>
                      <div style={{ fontSize: 12, color: '#9aa0a8' }}>{fmtSize(file.size)}</div>
                    </div>
                    <button onClick={() => setFile(null)} style={{ border: 'none', background: 'none', color: '#9aa0a8', cursor: 'pointer', padding: 4 }}><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, border: '1.5px dashed #d0d5d9', borderRadius: 12, padding: '24px', textAlign: 'center', color: '#8a9099', cursor: 'pointer' }}>
                    <input type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); if (!fTitle) setFTitle(f.name.replace(/\.[^.]+$/, '')) } }} />
                    <FileText className="h-5 w-5" strokeWidth={1.7} style={{ color: '#c2c6cc' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#5c626b' }}>Drop a file here or browse</span>
                    <span style={{ fontSize: 12 }}>PDF, images, documents up to 50MB</span>
                  </label>
                )}
              </div>
              {allSites && <FieldChips label="Site" required options={sites.map((s) => ({ id: s.id, name: s.name }))} value={fSite} onPick={setFSite} />}
              <div>
                <Label>Title <span style={{ color: '#c0403a' }}>*</span></Label>
                <Input value={fTitle} onChange={setFTitle} placeholder="e.g. Public Liability Insurance" />
              </div>
              <FieldChips label="Category" options={DOCUMENT_CATEGORIES.map((c) => ({ id: c, name: c }))} value={fCat} onPick={setFCat} capitalize />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <Label>Expiry date</Label>
                  <input type="date" value={fExpiry} onChange={(e) => setFExpiry(e.target.value)} style={{ width: '100%', border: '1px solid #e2e4e8', borderRadius: 10, padding: '10px 13px', font: "500 14px 'Geist'", color: '#16181d', outline: 'none' }} />
                </div>
                <div>
                  <Label>Access</Label>
                  <select value={fAccess} onChange={(e) => setFAccess(e.target.value)} style={{ width: '100%', border: '1px solid #e2e4e8', borderRadius: 10, padding: '10px 13px', font: "500 14px 'Geist'", color: '#16181d', background: '#fff' }}>
                    <option value="all">Everyone</option>
                    <option value="managers">Managers only</option>
                  </select>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#9aa0a8', lineHeight: 1.5, marginTop: -6 }}>Set an expiry so BlueRoll reminds you before it lapses. Leave empty if it never expires.</div>
            </div>
            <div style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid #eef0f2' }}>
              <button onClick={closePanel} style={{ background: '#fff', border: '1px solid #e2e4e8', color: '#41464d', font: "600 14px 'Geist'", padding: '11px 18px', borderRadius: 11, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => upload.mutate()} disabled={!canUpload || upload.isPending}
                style={{ background: canUpload ? '#1f9d63' : '#a9d8c0', border: 'none', color: '#fff', font: "600 14px 'Geist'", padding: '11px 20px', borderRadius: 11, cursor: canUpload ? 'pointer' : 'not-allowed', boxShadow: canUpload ? '0 1px 2px rgba(16,24,40,.1)' : 'none' }}>
                {upload.isPending ? 'Uploading…' : 'Upload document'}
              </button>
            </div>
          </div>
        </>
      )}

      <style>{`.doc-row:hover .doc-actions{opacity:1 !important}`}</style>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) { return <label style={{ font: "600 13px 'Geist'", color: '#41464d', display: 'block', marginBottom: 8 }}>{children}</label> }
function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    style={{ width: '100%', border: '1px solid #e2e4e8', borderRadius: 10, padding: '11px 13px', font: "500 14px 'Geist'", color: '#16181d', outline: 'none' }}
    onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' }}
    onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
}
function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button title={title} onClick={onClick} style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2e4e8', background: '#fff', color: '#8a9099', borderRadius: 8, cursor: 'pointer' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = danger ? '#eec7c5' : '#cdd1d6'; e.currentTarget.style.color = danger ? '#c0403a' : '#1c1f24'; if (danger) e.currentTarget.style.background = '#fdf6f6' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.color = '#8a9099'; e.currentTarget.style.background = '#fff' }}>{children}</button>
  )
}
function SummaryCard({ icon, tint, fg, label, value, active, onClick }: { icon: React.ReactNode; tint: string; fg: string; label: string; value: number; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} style={{ display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', background: '#fff', border: active ? `1.5px solid ${fg}` : '1px solid #e7e9ec', borderRadius: 14, padding: '15px 18px', cursor: onClick ? 'pointer' : 'default', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: tint, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{icon}</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 22, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 4 }}>{label}</div>
      </div>
    </button>
  )
}
function FieldChips({ label, required, options, value, onPick, capitalize }: { label: string; required?: boolean; options: { id: string; name: string }[]; value: string; onPick: (id: string) => void; capitalize?: boolean }) {
  return (
    <div>
      <Label>{label}{required && <span style={{ color: '#c0403a' }}> *</span>}</Label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const on = value === o.id
          return <button key={o.id} onClick={() => onPick(o.id)} style={{ border: on ? '1.5px solid #1f9d63' : '1px solid #e2e4e8', background: on ? '#f5faf7' : '#fff', color: on ? '#1a6e49' : '#5c626b', font: "600 13px 'Geist'", padding: '8px 13px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap', textTransform: capitalize ? 'capitalize' : 'none' }}>{o.name}</button>
        })}
      </div>
    </div>
  )
}
