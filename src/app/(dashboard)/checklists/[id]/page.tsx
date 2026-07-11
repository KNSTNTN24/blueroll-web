'use client'

import { use, useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { ChevronLeft, Check, Minus, Plus, Camera, AlertTriangle, ShieldCheck } from 'lucide-react'
import { notifyFlaggedItem, notifySignOffRequired } from '@/lib/notifications'
import { normalizeInitials, isValidInitials, INITIALS_STORAGE_KEY } from '@/lib/initials'
import { startOfDay, startOfWeek, startOfMonth, format } from 'date-fns'

function getPeriodStart(f: string): Date {
  const n = new Date()
  if (f === 'weekly') return startOfWeek(n, { weekStartsOn: 1 })
  if (f === 'monthly') return startOfMonth(n)
  if (f === 'four_weekly') { const d = startOfWeek(n, { weekStartsOn: 1 }); d.setDate(d.getDate() - 21); return d }
  return startOfDay(n)
}
interface ItemResponse { value: string; notes: string; flagged: boolean }

export default function ChecklistFillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const qc = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const [responses, setResponses] = useState<Record<string, ItemResponse>>({})
  const [submitting, setSubmitting] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: template, isLoading } = useQuery({
    queryKey: ['checklist-template', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('checklist_templates').select('*, checklist_template_items(*)').eq('id', id).single()
      if (error) throw error
      if (data?.checklist_template_items) data.checklist_template_items.sort((a: any, b: any) => a.sort_order - b.sort_order)
      return data
    },
  })
  const { data: existing } = useQuery({
    queryKey: ['existing-completion', id, business?.id],
    enabled: !!business?.id && !!template,
    queryFn: async () => {
      const { data } = await supabase.from('checklist_completions').select('*, checklist_responses(*), completed_by_profile:profiles!checklist_completions_completed_by_fkey(full_name)').eq('template_id', id).eq('business_id', business!.id).gte('completed_at', getPeriodStart(template!.frequency).toISOString()).order('completed_at', { ascending: false }).limit(1).maybeSingle()
      return data
    },
  })
  const isCompleted = !!existing && !template?.multi_per_day
  const canSignOff = isCompleted && template?.supervisor_role && !existing?.signed_off_by && isManager

  const { data: draft } = useQuery({
    queryKey: ['checklist-draft', id, profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => (await supabase.from('checklist_drafts').select('responses, updated_at').eq('template_id', id).eq('created_by', profile!.id).maybeSingle()).data,
  })
  useEffect(() => { if (draft?.responses && !isCompleted && Object.keys(responses).length === 0) setResponses(draft.responses as Record<string, ItemResponse>) /* eslint-disable-next-line */ }, [draft])

  const getR = (itemId: string): ItemResponse => responses[itemId] ?? { value: '', notes: '', flagged: false }
  const setR = (itemId: string, u: Partial<ItemResponse>) => setResponses((p) => ({ ...p, [itemId]: { ...getR(itemId), ...u } }))

  function autoFlag(item: any, value: string): boolean {
    if (item.item_type === 'yes_no' && value === 'no') return true
    if (item.item_type === 'temperature' && value !== '') {
      const n = parseFloat(value); if (isNaN(n)) return false
      if (item.min_value != null && n < item.min_value) return true
      if (item.max_value != null && n > item.max_value) return true
    }
    return false
  }
  function answered(item: any, r: ItemResponse): boolean {
    switch (item.item_type) {
      case 'tick': return r.value === 'true'
      case 'yes_no': return r.value === 'yes' || r.value === 'no'
      case 'temperature': return r.value !== ''
      case 'initials': return isValidInitials(r.value)
      case 'photo': return r.value !== ''
      default: return r.value.trim() !== ''
    }
  }

  const saveDraft = useCallback(async (silent: boolean) => {
    if (!business || !profile || isCompleted) return
    if (!silent) setSavingDraft(true)
    const { error } = await supabase.from('checklist_drafts').upsert({ template_id: id, business_id: business.id, created_by: profile.id, responses, updated_at: new Date().toISOString() }, { onConflict: 'template_id,created_by' })
    if (!silent) { setSavingDraft(false); error ? toast.error('Failed to save draft') : toast.success('Draft saved — finish anytime') }
  }, [business, profile, isCompleted, id, responses])

  // Auto-save on change (debounced) — powers the "Saved automatically" chip.
  useEffect(() => {
    if (isCompleted || Object.keys(responses).length === 0) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveDraft(true), 900)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [responses, isCompleted, saveDraft])

  async function handlePhoto(itemId: string, file: File) {
    if (!business?.id) return
    const path = `${business.id}/checklist-photos/${Date.now()}_${file.name}`
    const { error } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || 'image/jpeg' })
    if (error) { toast.error('Failed to upload photo'); return }
    setR(itemId, { value: path }); toast.success('Photo attached')
  }
  async function openPhoto(path: string) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
    if (data) window.open(data.signedUrl, '_blank')
  }

  async function handleSubmit() {
    if (!template || !profile || !business) return
    const items: any[] = template.checklist_template_items ?? []
    for (const item of items) { if (item.required && !answered(item, getR(item.id))) { toast.error(`"${item.name}" is required`); return } }
    setSubmitting(true)
    try {
      const { data: completion, error: cErr } = await supabase.from('checklist_completions').insert({ template_id: id, business_id: business.id, site_id: currentSiteId ?? (template as any).site_id ?? null, completed_by: profile.id, completed_at: new Date().toISOString() }).select('id').single()
      if (cErr) throw cErr
      const rows = items.map((item) => { const r = getR(item.id); return { completion_id: completion.id, item_id: item.id, value: r.value, notes: r.notes || null, flagged: autoFlag(item, r.value) } })
      const { error: rErr } = await supabase.from('checklist_responses').insert(rows)
      if (rErr) throw rErr
      for (const item of items.filter((i) => autoFlag(i, getR(i.id).value))) await notifyFlaggedItem(business.id, template.name, item.name)
      if (template.supervisor_role) await notifySignOffRequired(business.id, template.name, template.supervisor_role)
      supabase.from('checklist_drafts').delete().eq('template_id', id).eq('created_by', profile.id).then(() => {})
      qc.invalidateQueries({ queryKey: ['checklist-draft', id, profile.id] })
      toast.success('Checklist submitted')
      ;['existing-completion', 'checklist-completions', 'my-completions', 'dash-templates', 'my-checklists', 'my-drafts', 'all-checklists'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      setTimeout(() => router.push('/checklists'), 400)
    } catch (e: any) { toast.error(e?.message ?? 'Failed to submit') } finally { setSubmitting(false) }
  }

  const signOff = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('checklist_completions').update({ signed_off_by: profile!.id, signed_off_at: new Date().toISOString() }).eq('id', existing!.id); if (error) throw error },
    onSuccess: () => { toast.success('Signed off'); qc.invalidateQueries({ queryKey: ['existing-completion', id] }) },
    onError: () => toast.error('Failed to sign off'),
  })

  if (isLoading) return <div style={{ padding: 60, textAlign: 'center', color: '#9aa0a8', fontSize: 13 }}>Loading…</div>
  if (!template) return <div style={{ padding: 60, textAlign: 'center', color: '#9aa0a8', fontSize: 13 }}>Checklist not found.</div>

  const items: any[] = template.checklist_template_items ?? []
  const readOnly = isCompleted
  const respMap: Record<string, any> = {}
  if (readOnly) (existing?.checklist_responses ?? []).forEach((r: any) => { respMap[r.item_id] = r })

  const doneCount = readOnly ? items.length : items.filter((i) => answered(i, getR(i.id))).length
  const total = items.length
  const pct = total ? Math.round((doneCount / total) * 100) : 0
  const requiredLeft = items.filter((i) => i.required && !answered(i, getR(i.id))).length
  const flaggedCount = readOnly ? (existing?.checklist_responses ?? []).filter((r: any) => r.flagged).length : items.filter((i) => autoFlag(i, getR(i.id).value)).length
  const canSubmit = requiredLeft === 0

  const myInitials = (profile?.full_name ?? '').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 4).join('').toUpperCase()

  return (
    <div style={{ fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d', margin: '-16px -24px 0', minHeight: 'calc(100vh - 62px)', display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #eceef0', padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/checklists')} style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid #e5e7ea', background: '#fff', color: '#5c626b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} /></button>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-.01em' }}>{template.name}</h1>
          {!readOnly && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: "500 11.5px 'Geist'", color: '#8a9099', background: '#f5f6f7', padding: '4px 9px', borderRadius: 20 }}><Check className="h-3 w-3" style={{ color: '#1f9d63' }} strokeWidth={3} /> Saved automatically</span>}
          {readOnly && <span style={{ font: "600 11.5px 'Geist'", color: '#1a6e49', background: '#e9f2ec', padding: '4px 10px', borderRadius: 20 }}>Completed{existing?.completed_by_profile?.full_name ? ` · ${existing.completed_by_profile.full_name}` : ''}</span>}
        </div>
        {template.description && <div style={{ fontSize: 13.5, color: '#6b7280', marginTop: 8, marginLeft: 48 }}>{template.description}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 12, marginLeft: 48, maxWidth: 640 }}>
          <div style={{ flex: 1, maxWidth: 520, height: 7, background: '#eef0f2', borderRadius: 20, overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: '#1f9d63', borderRadius: 20, transition: 'width .3s' }} /></div>
          <span style={{ font: "600 13px 'Geist'", color: '#41464d', fontVariantNumeric: 'tabular-nums' }}>{doneCount}/{total} completed</span>
        </div>
      </div>

      {/* items */}
      <div style={{ flex: 1, background: '#f6f7f8', padding: '20px 24px 120px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 13 }}>
          {items.map((item, idx) => {
            const r = readOnly ? { value: respMap[item.id]?.value ?? '', notes: respMap[item.id]?.notes ?? '', flagged: respMap[item.id]?.flagged ?? false } : getR(item.id)
            const done = readOnly ? true : answered(item, r)
            const isNo = item.item_type === 'yes_no' && r.value === 'no'
            const tempNum = item.item_type === 'temperature' && r.value !== '' ? parseFloat(r.value) : null
            const outOfRange = tempNum !== null && ((item.min_value != null && tempNum < item.min_value) || (item.max_value != null && tempNum > item.max_value))
            return (
              <div key={item.id} style={{ background: '#fff', border: `1px solid ${isNo || outOfRange ? '#f3ddd9' : '#e9eaed'}`, borderRadius: 15, padding: '17px 18px' }}>
                <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                  <span style={{ width: 26, height: 26, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 12px 'Geist'", background: done ? '#1f9d63' : '#eef0f2', color: done ? '#fff' : '#8a9099' }}>{done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : idx + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ font: "600 15px 'Geist'", color: '#1c1f24' }}>{item.name}</span>
                      <span style={{ font: "600 10.5px 'Geist'", letterSpacing: '.03em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 20, background: item.required ? '#fbf0ee' : '#f1f2f4', color: item.required ? '#a1493f' : '#8a9099' }}>{item.required ? 'Required' : 'Optional'}</span>
                    </div>
                    {item.hint && <div style={{ fontSize: 12.5, color: '#9aa0a8', marginTop: 3 }}>{item.hint}</div>}
                  </div>
                </div>

                {/* control */}
                <div style={{ marginLeft: 39, marginTop: 12 }}>
                  {item.item_type === 'tick' && (
                    <button disabled={readOnly} onClick={() => setR(item.id, { value: r.value === 'true' ? '' : 'true' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1px solid ${r.value === 'true' ? '#bfdccb' : '#e5e7ea'}`, background: r.value === 'true' ? '#f2f9f4' : '#fff', color: r.value === 'true' ? '#1a6e49' : '#5c626b', font: "600 13.5px 'Geist'", padding: '9px 15px', borderRadius: 10, cursor: readOnly ? 'default' : 'pointer' }}>
                      <span style={{ width: 18, height: 18, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: r.value === 'true' ? '#1f9d63' : '#fff', border: r.value === 'true' ? 'none' : '1.6px solid #cdd1d6' }}>{r.value === 'true' && <Check className="h-3 w-3 text-white" strokeWidth={3} />}</span>
                      {r.value === 'true' ? 'Done' : 'Mark done'}
                    </button>
                  )}
                  {item.item_type === 'yes_no' && (
                    <div style={{ display: 'flex', gap: 8, maxWidth: 320 }}>
                      {(['yes', 'no'] as const).map((v) => { const on = r.value === v; const yes = v === 'yes'; return (
                        <button key={v} disabled={readOnly} onClick={() => setR(item.id, { value: v })} style={{ flex: 1, border: on ? `1.5px solid ${yes ? '#1f9d63' : '#d98c80'}` : '1px solid #e5e7ea', background: on ? (yes ? '#e9f2ec' : '#fbf0ee') : '#fff', color: on ? (yes ? '#1f9d63' : '#a1493f') : '#5c626b', font: "600 14px 'Geist'", padding: '11px 0', borderRadius: 10, cursor: readOnly ? 'default' : 'pointer', textTransform: 'capitalize' }}>{v}</button>
                      ) })}
                    </div>
                  )}
                  {item.item_type === 'yes_no' && isNo && (
                    <div style={{ marginTop: 10 }}>
                      <textarea disabled={readOnly} value={r.notes} onChange={(e) => setR(item.id, { notes: e.target.value })} rows={2} placeholder="What did you do about it?" style={{ width: '100%', maxWidth: 480, background: '#fdf5f3', border: '1px solid #f3ddd9', borderRadius: 10, padding: '10px 12px', font: "500 13px 'Geist'", color: '#16181d', outline: 'none', resize: 'vertical' }} />
                    </div>
                  )}
                  {item.item_type === 'temperature' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${outOfRange ? '#e7c9c3' : '#e5e7ea'}`, borderRadius: 11, overflow: 'hidden' }}>
                        <button disabled={readOnly} onClick={() => setR(item.id, { value: ((tempNum ?? 0) - 0.5).toString() })} style={{ width: 40, height: 44, border: 'none', background: '#f7f8f9', color: '#5c626b', cursor: readOnly ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Minus className="h-4 w-4" strokeWidth={2} /></button>
                        <div style={{ width: 92, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, background: r.value === '' ? '#fff' : outOfRange ? '#fdf3f1' : '#f2f9f4' }}>
                          <input disabled={readOnly} value={r.value} inputMode="decimal" placeholder="—"
                            onChange={(e) => setR(item.id, { value: e.target.value.replace(/[^0-9.\-]/g, '') })}
                            style={{ width: 50, textAlign: 'center', border: 'none', outline: 'none', background: 'transparent', font: "700 16px 'Geist'", fontVariantNumeric: 'tabular-nums', color: r.value === '' ? '#c2c6cc' : outOfRange ? '#a1493f' : '#1a6e49' }} />
                          {r.value !== '' && <span style={{ font: "700 15px 'Geist'", color: outOfRange ? '#a1493f' : '#1a6e49' }}>°C</span>}
                        </div>
                        <button disabled={readOnly} onClick={() => setR(item.id, { value: ((tempNum ?? 0) + 0.5).toString() })} style={{ width: 40, height: 44, border: 'none', background: '#f7f8f9', color: '#5c626b', cursor: readOnly ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Plus className="h-4 w-4" strokeWidth={2} /></button>
                      </div>
                      {(item.min_value != null || item.max_value != null) && <span style={{ fontSize: 12.5, color: outOfRange ? '#a1493f' : '#9aa0a8' }}>{outOfRange ? 'Out of range — flagged' : `Range ${item.min_value ?? '–'} to ${item.max_value ?? '–'}°C`}</span>}
                    </div>
                  )}
                  {item.item_type === 'text' && (
                    <input disabled={readOnly} value={r.value} onChange={(e) => setR(item.id, { value: e.target.value })} placeholder="Type your answer…" style={{ width: '100%', maxWidth: 420, border: '1px solid #e2e4e8', borderRadius: 10, padding: '10px 13px', font: "500 14px 'Geist'", outline: 'none' }} />
                  )}
                  {item.item_type === 'photo' && (
                    r.value ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button onClick={() => openPhoto(r.value)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid #bfdccb', background: '#f2f9f4', color: '#1a6e49', font: "600 13px 'Geist'", padding: '9px 13px', borderRadius: 10, cursor: 'pointer' }}><Check className="h-3.5 w-3.5" strokeWidth={2.6} /> Photo attached</button>
                        {!readOnly && <label style={{ font: "600 12.5px 'Geist'", color: '#6b7280', cursor: 'pointer' }}>Retake<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handlePhoto(item.id, e.target.files[0])} /></label>}
                      </div>
                    ) : !readOnly ? (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1.5px dashed #cfd3d8', borderRadius: 11, padding: '12px 16px', color: '#5c626b', font: "600 13px 'Geist'", cursor: 'pointer' }}><Camera className="h-4 w-4" strokeWidth={1.8} /> Take photo<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handlePhoto(item.id, e.target.files[0])} /></label>
                    ) : <span style={{ fontSize: 13, color: '#b3b8bf' }}>No photo</span>
                  )}
                  {item.item_type === 'initials' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input disabled={readOnly} value={r.value} onChange={(e) => { const v = normalizeInitials(e.target.value); setR(item.id, { value: v }); try { if (isValidInitials(v)) localStorage.setItem(INITIALS_STORAGE_KEY, v) } catch {} }} maxLength={4} placeholder="ET" style={{ width: 96, textAlign: 'center', textTransform: 'uppercase', border: `1px solid ${r.value && !isValidInitials(r.value) ? '#d98c80' : '#e2e4e8'}`, borderRadius: 10, padding: '10px 0', font: "700 15px 'Geist'", letterSpacing: '.08em', outline: 'none' }} />
                      {!readOnly && myInitials && <button onClick={() => setR(item.id, { value: myInitials })} style={{ font: "600 12.5px 'Geist'", color: '#1f7a52', border: 'none', background: 'none', cursor: 'pointer' }}>Use mine ({myInitials})</button>}
                    </div>
                  )}

                  {/* per-item notes (except text, whose control is a field) */}
                  {!readOnly && item.item_type !== 'text' && !(item.item_type === 'yes_no' && isNo) && (
                    <input value={r.notes} onChange={(e) => setR(item.id, { notes: e.target.value })} placeholder="Add notes (optional)" style={{ display: 'block', width: '100%', maxWidth: 480, marginTop: 10, background: '#fafbfb', border: '1px solid #eef0f2', borderRadius: 10, padding: '8px 12px', font: "500 12.5px 'Geist'", color: '#16181d', outline: 'none' }} />
                  )}
                  {readOnly && r.notes && <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 8 }}>Note: {r.notes}</div>}
                </div>
              </div>
            )
          })}

          {canSignOff && (
            <button onClick={() => signOff.mutate()} disabled={signOff.isPending} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', background: '#1f9d63', border: 'none', color: '#fff', font: "600 13.5px 'Geist'", padding: '10px 16px', borderRadius: 10, cursor: 'pointer' }}><ShieldCheck className="h-4 w-4" strokeWidth={1.9} /> {signOff.isPending ? 'Signing…' : 'Sign off as supervisor'}</button>
          )}
        </div>
      </div>

      {/* footer */}
      {!readOnly && (
        <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #eceef0', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ font: "500 13px 'Geist'", color: flaggedCount ? '#a1493f' : requiredLeft ? '#8a9099' : '#1a6e49', display: 'flex', alignItems: 'center', gap: 6 }}>
            {flaggedCount > 0 && <AlertTriangle className="h-4 w-4" strokeWidth={1.9} />}
            {flaggedCount > 0 ? `${flaggedCount} item${flaggedCount === 1 ? '' : 's'} flagged — logged with your notes` : requiredLeft > 0 ? `${requiredLeft} required item${requiredLeft === 1 ? '' : 's'} left` : 'All required items completed'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={() => saveDraft(false)} disabled={savingDraft} style={{ background: '#fff', border: '1px solid #e2e4e8', color: '#41464d', font: "600 14px 'Geist'", padding: '11px 17px', borderRadius: 11, cursor: 'pointer' }}>{savingDraft ? 'Saving…' : 'Save draft'}</button>
            <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={{ background: canSubmit ? '#1f9d63' : '#dfe2e6', border: 'none', color: canSubmit ? '#fff' : '#a3a8b0', font: "600 14px 'Geist'", padding: '11px 20px', borderRadius: 11, cursor: canSubmit ? 'pointer' : 'not-allowed', boxShadow: canSubmit ? '0 1px 2px rgba(16,24,40,.1)' : 'none' }}>{submitting ? 'Submitting…' : 'Submit checklist'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
