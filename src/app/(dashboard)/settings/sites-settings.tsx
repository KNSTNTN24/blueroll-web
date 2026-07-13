'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useAuth } from '@/hooks/use-auth'
import { toast } from 'sonner'
import { X, Pencil, Trash2, ArrowRight } from 'lucide-react'

interface Site { id: string; name: string; address: string | null; postcode: string | null; fsa_rating: string | null; manager_id: string | null; status: string | null; created_at?: string }
interface Member { id: string; full_name: string | null; site_id: string | null }

const TILE = ['#1f7a52', '#5b6472', '#8a6d52', '#4e6e81']
const codeOf = (n: string) => {
  const p = n.split(' ').filter(Boolean)
  return (p.length >= 2 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase()
}
const ratingMeta = (r: number) =>
  r >= 4 ? { bg: '#eaf4ee', color: '#1f7a52' }
    : r === 3 ? { bg: '#fbf1e1', color: '#b07d1e' }
    : { bg: '#fbecec', color: '#c0403a' }

interface FsaEstablishment {
  FHRSID: number
  BusinessName: string
  AddressLine1: string
  AddressLine2: string
  AddressLine3: string
  PostCode: string
  RatingValue: string
}

export function SitesSettings() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites) as unknown as Site[]
  const setCurrentSiteId = useAuthStore((s) => s.setCurrentSiteId)
  const { refreshProfile } = useAuth()
  const router = useRouter()
  const bid = business?.id

  const [addOpen, setAddOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const { data: members = [] } = useQuery({
    queryKey: ['sites-members', bid],
    enabled: !!bid,
    queryFn: async () => (await supabase.from('profiles').select('id, full_name, site_id').eq('business_id', bid!)).data as Member[] ?? [],
  })
  const memberCount = (siteId: string) => members.filter((m) => m.site_id === siteId).length
  const openSite = sites.find((s) => s.id === openId) ?? null

  function manageTeam(siteId: string) { setCurrentSiteId(siteId); router.push('/team') }

  return (
    <div>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: '#16181d' }}>Sites</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: '#6b7280' }}>Each site has its own checklists, team and records. £24.99/mo per site, billed together.</p>
        </div>
        <button onClick={() => setAddOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', background: '#1f9d63', border: 'none', color: '#fff', font: "600 13.5px 'Geist'", padding: '9px 16px', borderRadius: 10, cursor: 'pointer' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#1a8a56')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#1f9d63')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add site
        </button>
      </div>

      {/* site cards (whole card opens the view panel) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 22 }}>
        {sites.map((s) => {
          const r = parseInt(s.fsa_rating ?? '')
          const rm = Number.isNaN(r) ? null : ratingMeta(r)
          const mc = memberCount(s.id)
          const since = s.created_at ? new Date(s.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : null
          const onboarding = s.status === 'onboarding'
          const selected = openId === s.id
          return (
            <button key={s.id} onClick={() => setOpenId(s.id)}
              style={{ background: '#fff', border: `1px solid ${selected ? '#cfe8db' : '#e9eaed'}`, borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)', padding: '17px 20px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit', transition: 'border-color .14s' }}
              onMouseEnter={(e) => { if (!selected) e.currentTarget.style.borderColor = '#cfe8db' }}
              onMouseLeave={(e) => { if (!selected) e.currentTarget.style.borderColor = '#e9eaed' }}>
              <span style={{ width: 42, height: 42, flex: 'none', borderRadius: 12, background: '#eef7f2', color: '#1f7a52', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 14px 'Geist'" }}>{codeOf(s.name)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 9, font: "700 14.5px 'Geist'", color: '#16181d', whiteSpace: 'nowrap' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                  {onboarding ? (
                    <span style={{ font: "600 11.5px 'Geist'", color: '#b07d1e', background: '#fbf3e6', border: '1px solid #f2e2c4', padding: '3px 9px', borderRadius: 14, flex: 'none' }}>Onboarding</span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: "600 11.5px 'Geist'", color: '#1f7a52', background: '#e9f6ef', padding: '3px 9px', borderRadius: 14, flex: 'none' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#1f9d63' }} />Active</span>
                  )}
                </span>
                <span style={{ display: 'block', font: "400 12.5px 'Geist'", color: '#9aa0a8', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[s.address || s.postcode, rm ? `FSA ${s.fsa_rating}` : null].filter(Boolean).join(' · ') || 'FSA pending'}</span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, whiteSpace: 'nowrap', flex: 'none' }}>
                <span style={{ font: "600 12.5px 'Geist'", color: '#41464d' }}>{mc} team member{mc === 1 ? '' : 's'}</span>
                {since && <span style={{ font: "400 12px 'Geist'", color: '#9aa0a8' }}>live since {since}</span>}
              </span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c2c6cc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><polyline points="9 6 15 12 9 18" /></svg>
            </button>
          )
        })}
      </div>

      {addOpen && <AddSiteSlideOver onClose={() => setAddOpen(false)} onDone={async () => { setAddOpen(false); await refreshProfile() }} businessId={bid!} />}
      {openSite && (
        <SiteViewPanel key={openSite.id} site={openSite} members={members} teamCount={memberCount(openSite.id)} canRemove={sites.length > 1}
          onClose={() => setOpenId(null)} onManageTeam={() => manageTeam(openSite.id)}
          onChanged={async () => { await refreshProfile() }} />
      )}
    </div>
  )
}

// ── Site view / edit / remove panel ─────────────────────────────────
function SiteViewPanel({ site, members, teamCount, canRemove, onClose, onManageTeam, onChanged }: {
  site: Site; members: Member[]; teamCount: number; canRemove: boolean
  onClose: () => void; onManageTeam: () => void; onChanged: () => Promise<void>
}) {
  const [shown, setShown] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [name, setName] = useState(site.name)
  const [address, setAddress] = useState(site.address ?? '')
  const [managerId, setManagerId] = useState(site.manager_id ?? '')

  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t) }, [])
  function close() { setShown(false); setTimeout(onClose, 300) }

  const managerName = members.find((m) => m.id === site.manager_id)?.full_name ?? null
  const since = site.created_at ? new Date(site.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

  async function save() {
    if (!name.trim()) { toast.error('Site name is required'); return }
    setSaving(true)
    const { error } = await supabase.from('sites').update({ name: name.trim(), address: address.trim() || null, manager_id: managerId || null }).eq('id', site.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Site updated')
    setEditing(false)
    await onChanged()
  }

  async function remove() {
    if (!canRemove) { toast.error('A group must keep at least one site.'); return }
    setRemoving(true)
    // Soft delete: keep the row + all its records (checklists, incidents, docs…) for
    // 4-year EHO retention; hiding it from the estate stops billing for it.
    const { error } = await supabase.from('sites').update({ status: 'removed', removed_at: new Date().toISOString() }).eq('id', site.id)
    setRemoving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Site removed — records kept for 4 years')
    close()
    await onChanged()
  }

  const field: React.CSSProperties = { width: '100%', border: '1px solid #e2e4e8', borderRadius: 10, padding: '10px 12px', font: "500 13.5px 'Geist'", color: '#16181d', outline: 'none', background: '#fff' }
  const lbl: React.CSSProperties = { font: "600 12.5px 'Geist'", color: '#41464d', display: 'block', marginBottom: 7 }

  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(16,18,29,.32)', zIndex: 60, display: 'flex', justifyContent: 'flex-end', opacity: shown ? 1 : 0, transition: 'opacity .3s ease-out' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 400, maxWidth: '92vw', height: '100%', background: '#fff', boxShadow: '-24px 0 60px -30px rgba(16,24,40,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: shown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .3s cubic-bezier(0.32,0.72,0,1)' }}>
        {/* header */}
        <div style={{ flex: 'none', padding: '18px 22px', borderBottom: '1px solid #eef0f2', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 40, height: 40, flex: 'none', borderRadius: 11, background: '#eef7f2', color: '#1f7a52', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 13.5px 'Geist'" }}>{codeOf(site.name)}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: "700 16px 'Geist'", color: '#16181d', whiteSpace: 'nowrap' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{site.name}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: "600 11px 'Geist'", color: '#1f7a52', background: '#e9f6ef', padding: '3px 8px', borderRadius: 14, flex: 'none' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#1f9d63' }} />{site.status === 'onboarding' ? 'Onboarding' : 'Active'}</span>
            </span>
          </span>
          <button onClick={close} style={{ width: 32, height: 32, borderRadius: 9, border: 'none', background: '#f1f2f4', color: '#5c626b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><X className="h-4 w-4" strokeWidth={2} /></button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div><label style={lbl}>Site name</label><input value={name} onChange={(e) => setName(e.target.value)} style={field} /></div>
              <div><label style={lbl}>Address</label><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, town, postcode" style={field} /></div>
              <div>
                <label style={lbl}>Manager</label>
                <select value={managerId} onChange={(e) => setManagerId(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                  <option value="">No manager</option>
                  {members.filter((m) => m.full_name).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={() => { setEditing(false); setName(site.name); setAddress(site.address ?? ''); setManagerId(site.manager_id ?? '') }} style={{ flex: 1, background: '#fff', border: '1px solid #e2e4e8', color: '#5c626b', font: "600 13.5px 'Geist'", padding: '10px', borderRadius: 10, cursor: 'pointer' }}>Cancel</button>
                <button onClick={save} disabled={saving} style={{ flex: 1.4, background: '#1f9d63', border: 'none', color: '#fff', font: "600 13.5px 'Geist'", padding: '10px', borderRadius: 10, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save changes'}</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ font: "600 11px 'Geist'", letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a9099', marginBottom: 12 }}>Details</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <DetailRow label="Address" value={site.address || site.postcode || 'Not set'} />
                <DetailRow label="Manager" value={managerName || 'No manager yet'} />
                <DetailRow label="Team members" value={`${teamCount}`} />
                <DetailRow label="Live since" value={since} />
                <DetailRow label="Billing" value="£24.99/mo" sub="see Billing & subscription" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
                <button onClick={() => setEditing(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid #e2e4e8', background: '#fff', color: '#41464d', font: "600 13.5px 'Geist'", padding: '10px 14px', borderRadius: 10, cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
                  <Pencil className="h-4 w-4" strokeWidth={1.8} /> Edit site details
                </button>
                <button onClick={onManageTeam} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid #e2e4e8', background: '#fff', color: '#41464d', font: "600 13.5px 'Geist'", padding: '10px 14px', borderRadius: 10, cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
                  Manage team at this site <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* remove footer (hidden while editing) */}
        {!editing && (
          <div style={{ flex: 'none', borderTop: '1px solid #eef0f2', padding: '14px 22px' }}>
            {confirming ? (
              <div style={{ background: '#fdf3f2', border: '1px solid #f5dcda', borderRadius: 12, padding: 14 }}>
                <div style={{ font: "600 13px 'Geist'", color: '#8f2f26', marginBottom: 5 }}>Remove {site.name}?</div>
                <div style={{ font: "400 12px/1.5 'Geist'", color: '#a05a52', marginBottom: 12 }}>Billing stops today. Records are kept read-only for 4 years for EHO inspection. This can&apos;t be undone.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setConfirming(false)} style={{ flex: 1, background: '#fff', border: '1px solid #e6c9c5', color: '#8f2f26', font: "600 13px 'Geist'", padding: '9px', borderRadius: 9, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={remove} disabled={removing} style={{ flex: 1, background: '#c0392b', border: 'none', color: '#fff', font: "600 13px 'Geist'", padding: '9px', borderRadius: 9, cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#a93226')} onMouseLeave={(e) => (e.currentTarget.style.background = '#c0392b')}>{removing ? 'Removing…' : 'Remove site'}</button>
                </div>
              </div>
            ) : (
              <button onClick={() => canRemove ? setConfirming(true) : toast.error('A group must keep at least one site.')}
                style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none', color: '#c0392b', font: "600 13px 'Geist'", padding: '6px 4px', borderRadius: 8, cursor: 'pointer', opacity: canRemove ? 1 : 0.5 }}>
                <Trash2 className="h-4 w-4" strokeWidth={1.8} /> Remove site
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '10px 0', borderBottom: '1px solid #f4f5f6' }}>
      <span style={{ font: "500 13px 'Geist'", color: '#8a9099' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>
        <span style={{ display: 'block', font: "600 13.5px 'Geist'", color: '#16181d' }}>{value}</span>
        {sub && <span style={{ display: 'block', font: "400 11.5px 'Geist'", color: '#9aa0a8', marginTop: 1 }}>{sub}</span>}
      </span>
    </div>
  )
}

// ── Add-site slide-over ─────────────────────────────────────────────
function AddSiteSlideOver({ onClose, onDone, businessId }: { onClose: () => void; onDone: () => void; businessId: string }) {
  const [pc, setPc] = useState('')
  const [results, setResults] = useState<FsaEstablishment[]>([])
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<FsaEstablishment | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState(false)
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { const t = setTimeout(() => setShown(true), 10); return () => clearTimeout(t) }, [])

  // Debounced FSA lookup once postcode ≥ 5 chars
  useEffect(() => {
    if (sel) return
    if (pc.trim().length < 5) { setResults([]); return }
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `https://api.ratings.food.gov.uk/Establishments?address=${encodeURIComponent(pc.trim())}&pageSize=8&sortOptionKey=distance`,
          { headers: { 'x-api-version': '2', Accept: 'application/json' } },
        )
        const json = await res.json()
        setResults((json.establishments ?? []).slice(0, 6))
      } catch { setResults([]) } finally { setLoading(false) }
    }, 350)
    return () => { if (debRef.current) clearTimeout(debRef.current) }
  }, [pc, sel])

  const addr = (e: FsaEstablishment) => [e.AddressLine1, e.AddressLine2, e.AddressLine3, e.PostCode].filter(Boolean).join(', ')

  async function confirm() {
    if (!sel) return
    setBusy(true)
    try {
      const { error } = await supabase.from('sites').insert({
        business_id: businessId,
        name: sel.BusinessName,
        postcode: sel.PostCode || pc.trim().toUpperCase(),
        fsa_rating: sel.RatingValue,
        status: 'onboarding',
      })
      if (error) throw error
      if (email.trim()) {
        try { await supabase.rpc('create_invite', { p_email: email.trim(), p_role: 'manager' }) } catch { /* non-blocking */ }
      }
      toast.success('Site added')
      onDone()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add site')
    } finally { setBusy(false) }
  }

  const inputStyle: React.CSSProperties = { width: '100%', background: '#fff', border: '1px solid #e2e4e8', borderRadius: 10, padding: '11px 13px', fontSize: 14, color: '#1c1f24', outline: 'none' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,22,27,.36)', zIndex: 60, display: 'flex', justifyContent: 'flex-end', opacity: shown ? 1 : 0, transition: 'opacity .3s ease-out' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 440, maxWidth: '92vw', height: '100%', background: '#fff', boxShadow: '-24px 0 64px -32px rgba(16,24,40,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: shown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .3s cubic-bezier(0.32,0.72,0,1)' }}>
        {/* header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #eef0f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#16181d' }}>Add a site</h2>
            <div style={{ fontSize: 13, color: '#8a9099', marginTop: 2 }}>Find your business on the FSA register</div>
          </div>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: '#f1f2f4', color: '#5c626b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {!sel && (
            <>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#41464d', display: 'block', marginBottom: 8 }}>Postcode <span style={{ color: '#d2453f' }}>*</span></label>
                <input autoFocus value={pc} onChange={(e) => setPc(e.target.value)} placeholder="e.g. E8 3RL" style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
              </div>
              {pc.trim().length >= 5 && (
                <div style={{ border: '1px solid #e7e9ec', borderRadius: 12, padding: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa0a8', padding: '7px 10px 4px' }}>
                    {loading ? 'Searching…' : `Found at ${pc.trim().toUpperCase()} · Food Standards Agency`}
                  </div>
                  {!loading && results.map((e) => {
                    const r = parseInt(e.RatingValue)
                    const rm = Number.isNaN(r) ? null : ratingMeta(r)
                    return (
                      <button key={e.FHRSID} onClick={() => setSel(e)}
                        style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', border: 'none', background: 'none', padding: 10, borderRadius: 9, cursor: 'pointer', textAlign: 'left' }}
                        onMouseEnter={(ev) => (ev.currentTarget.style.background = '#f2faf6')}
                        onMouseLeave={(ev) => (ev.currentTarget.style.background = 'none')}>
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#16181d' }}>{e.BusinessName}</span>
                          <span style={{ display: 'block', fontSize: 12.5, color: '#8a9099', marginTop: 1 }}>{addr(e)}</span>
                        </span>
                        {rm ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 700, padding: '5px 9px', borderRadius: 7, background: rm.bg, color: rm.color, whiteSpace: 'nowrap', flex: 'none' }}>FSA {e.RatingValue}</span>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 500, color: '#b0b5bc', whiteSpace: 'nowrap', flex: 'none' }}>FSA pending</span>
                        )}
                      </button>
                    )
                  })}
                  {!loading && results.length === 0 && (
                    <div style={{ fontSize: 12, color: '#9aa0a8', padding: '5px 10px 7px' }}>No businesses found at that postcode.</div>
                  )}
                </div>
              )}
            </>
          )}

          {sel && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1.5px solid #bfe0cd', background: '#f5faf7', borderRadius: 12, padding: '13px 15px' }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#1f9d63', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12.5 10 17 19 7.5" /></svg>
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: '#16181d' }}>{sel.BusinessName}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: '#5c7568', marginTop: 1 }}>{addr(sel)}</span>
                </span>
                {(() => { const r = parseInt(sel.RatingValue); const rm = Number.isNaN(r) ? null : ratingMeta(r); return rm ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 700, padding: '5px 9px', borderRadius: 7, background: rm.bg, color: rm.color, whiteSpace: 'nowrap', flex: 'none' }}>FSA {sel.RatingValue}</span>
                ) : <span style={{ fontSize: 12, fontWeight: 500, color: '#b0b5bc', flex: 'none' }}>FSA pending</span> })()}
                <button onClick={() => setSel(null)} style={{ border: 'none', background: 'none', color: '#8a9099', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 2, flex: 'none' }}>Change</button>
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#41464d', display: 'block', marginBottom: 8 }}>Site manager <span style={{ color: '#9aa0a8', fontWeight: 500 }}>(optional)</span></label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="manager@email.com" style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.12)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
                <div style={{ fontSize: 12, color: '#9aa0a8', marginTop: 8 }}>They&apos;ll get an invite and see only this site. You can invite more people later from Team.</div>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#f5f6f7', border: '1px solid #eceef0', borderRadius: 12, padding: '12px 14px' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa0a8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', marginTop: 1 }}><rect x="4" y="4" width="16" height="16" rx="4" /><polyline points="8.5 12 11 14.5 15.5 9.5" /></svg>
                <span style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.5 }}>We&apos;ll create the site with your group&apos;s standard checklists and shared HACCP pack. Status stays &quot;Onboarding&quot; until the first week of checks is complete.</span>
              </div>
            </>
          )}
        </div>

        {/* footer */}
        <div style={{ display: 'flex', gap: 10, padding: '16px 24px', borderTop: '1px solid #eef0f2' }}>
          <button onClick={onClose} style={{ flex: 1, background: '#fff', border: '1px solid #e2e4e8', color: '#5c626b', fontSize: 14, fontWeight: 600, padding: 11, borderRadius: 11, cursor: 'pointer' }}>Cancel</button>
          <button onClick={confirm} disabled={!sel || busy}
            style={{ flex: 1.4, background: sel ? '#1f9d63' : '#cfe6da', border: 'none', color: sel ? '#fff' : '#8fb9a4', fontSize: 14, fontWeight: 600, padding: 11, borderRadius: 11, cursor: sel ? 'pointer' : 'not-allowed' }}>
            {busy ? 'Adding…' : 'Add site'}
          </button>
        </div>
      </div>
    </div>
  )
}
