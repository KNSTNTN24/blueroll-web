'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { useAuth } from '@/hooks/use-auth'
import { toast } from 'sonner'

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
  const sites = useAuthStore((s) => s.sites)
  const { refreshProfile } = useAuth()
  const bid = business?.id

  const [addOpen, setAddOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  useEffect(() => {
    if (!menuFor) return
    const h = () => setMenuFor(null)
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  }, [menuFor])

  const { data: members = [] } = useQuery({
    queryKey: ['sites-members', bid],
    enabled: !!bid,
    queryFn: async () => (await supabase.from('profiles').select('id, full_name, site_id').eq('business_id', bid!)).data ?? [],
  })
  const memberCount = (siteId: string) => (members as { site_id: string }[]).filter((m) => m.site_id === siteId).length
  const managerName = (id: string | null) => (members as { id: string; full_name: string }[]).find((m) => m.id === id)?.full_name ?? null

  async function removeSite(id: string, name: string) {
    if (sites.length <= 1) { toast.error('A group must keep at least one site.'); return }
    if (!confirm(`Remove ${name}? Its checklists, incidents and other site data will be deleted. This cannot be undone.`)) return
    const { error } = await supabase.from('sites').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Site removed')
    await refreshProfile()
  }

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

      {/* site cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 22 }}>
        {sites.map((s) => {
          const r = parseInt(s.fsa_rating ?? '')
          const rm = Number.isNaN(r) ? null : ratingMeta(r)
          const mc = memberCount(s.id)
          const created = (s as { created_at?: string }).created_at
          const since = created ? new Date(created).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : null
          const onboarding = s.status === 'onboarding'
          return (
            <div key={s.id} style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)', padding: '17px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
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
                <span style={{ display: 'block', font: "400 12.5px 'Geist'", color: '#9aa0a8', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[s.postcode, rm ? `FSA ${s.fsa_rating}` : null].filter(Boolean).join(' · ') || 'FSA pending'}</span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, whiteSpace: 'nowrap', flex: 'none' }}>
                <span style={{ font: "600 12.5px 'Geist'", color: '#41464d' }}>{mc} team member{mc === 1 ? '' : 's'}</span>
                {since && <span style={{ font: "400 12px 'Geist'", color: '#9aa0a8' }}>live since {since}</span>}
              </span>
              <div style={{ position: 'relative', flex: 'none' }} onClick={(e) => e.stopPropagation()}>
                <button onClick={() => setMenuFor((m) => (m === s.id ? null : s.id))}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #e2e4e8', background: '#fff', color: '#41464d', borderRadius: 10, padding: '8px 14px', font: "600 13px 'Geist'", cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#fafbfb'; e.currentTarget.style.color = '#16181d' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#41464d' }}>
                  Manage
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
                </button>
                {menuFor === s.id && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 180, background: '#fff', border: '1px solid #e7e9ec', borderRadius: 12, boxShadow: '0 18px 44px -18px rgba(16,24,40,.28)', padding: 5, zIndex: 40 }}>
                    <button onClick={() => { setMenuFor(null); removeSite(s.id, s.name) }} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: 'none', background: 'none', borderRadius: 8, padding: '8px 9px', font: "500 13px 'Geist'", color: '#c0392b', cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#fdf3f2')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6.5 7l1 12a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-12" /></svg>
                      Remove site
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* removal note */}
      <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)', padding: '17px 20px', marginTop: 14, display: 'flex', gap: 13 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0a8" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', marginTop: 2 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        <p style={{ margin: 0, font: "400 13px/1.6 'Geist'", color: '#6b7280' }}>Removing a site is done from its own <strong style={{ fontWeight: 600, color: '#41464d' }}>Manage</strong> menu and asks for confirmation. Records are kept for 4 years for EHO inspection even after removal; billing stops the same day.</p>
      </div>

      {addOpen && <AddSiteSlideOver onClose={() => setAddOpen(false)} onDone={async () => { setAddOpen(false); await refreshProfile() }} businessId={bid!} />}
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
