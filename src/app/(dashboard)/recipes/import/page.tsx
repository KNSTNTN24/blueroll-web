'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { ChevronLeft, Sparkles, Check, X, AlertTriangle, Image as ImageIcon } from 'lucide-react'
import { EU_ALLERGENS, ALLERGEN_LABELS } from '@/lib/constants'
import { HACCP_RECIPE_METHODS } from '@/lib/haccp-methods'
import { fileToImageInput } from '@/lib/recipe-images'

interface PIng { name: string; quantity: string; unit: string; allergens: string[] }
interface Parsed {
  name: string; description: string; category: string; instructions: string
  cooking_method: string; cooking_temp: string; cooking_time: string; cooking_time_unit: string
  chilling_method: string; freezing_instructions: string; defrosting_instructions: string; reheating_instructions: string
  hot_holding_required: boolean; extra_care_flags: string[]; haccp_methods: string[]; ingredients: PIng[]
}
const CONTROLS = HACCP_RECIPE_METHODS.filter((m) => m.id !== 'cooking_safely')
const SAMPLE = `Mushroom Risotto — serves 4

Ingredients
- 300g arborio rice
- 400g chestnut mushrooms
- 1 onion, diced
- 100ml white wine
- 50g parmesan
- 30g butter
- 1L vegetable stock

Method
Sauté the onion and mushrooms in butter, stir in the rice, deglaze with wine, then add the stock a ladle at a time until creamy. Finish with parmesan.`

export default function AIImportPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const [phase, setPhase] = useState<'input' | 'analyzing' | 'review'>('input')
  const [mode, setMode] = useState<'text' | 'photo' | 'url'>('text')
  const [raw, setRaw] = useState('')
  const [url, setUrl] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [step, setStep] = useState(0)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const canExtract = mode === 'text' ? raw.trim().length > 20 : mode === 'photo' ? photos.length > 0 : url.trim().length > 8

  async function extract() {
    if (!canExtract) return
    setPhase('analyzing'); setStep(0)
    const timers = [setTimeout(() => setStep(1), 700), setTimeout(() => setStep(2), 1400)]
    try {
      const payload: any = {}
      if (mode === 'text') payload.text = raw
      else if (mode === 'url') payload.text = `Recipe from ${url}`
      else payload.images = await Promise.all(photos.map(fileToImageInput))
      const { data, error } = await supabase.functions.invoke('import-recipe', { body: payload })
      if (error) throw error
      const result = typeof data === 'string' ? JSON.parse(data) : data
      const r = result.recipe ?? result
      const p: Parsed = {
        name: r.name ?? '', description: r.description ?? '', category: r.category ?? '',
        instructions: r.instructions ?? '', cooking_method: r.cookingMethod ?? r.cooking_method ?? '',
        cooking_temp: (r.cookingTemp ?? r.cooking_temp ?? '').toString(), cooking_time: (r.cookingTime ?? r.cooking_time ?? '').toString(), cooking_time_unit: r.cookingTimeUnit ?? 'minutes',
        chilling_method: r.chillingMethod ?? '', freezing_instructions: r.freezingInstructions ?? '', defrosting_instructions: r.defrostingInstructions ?? '', reheating_instructions: r.reheatingInstructions ?? '',
        hot_holding_required: r.hotHoldingRequired ?? false, extra_care_flags: r.extraCareFlags ?? [],
        haccp_methods: Array.isArray(r.haccp_methods) ? r.haccp_methods : [],
        ingredients: (r.ingredients ?? []).map((i: any) => ({ name: i.name ?? '', quantity: (i.quantity ?? '').toString(), unit: i.unit ?? '', allergens: i.allergens ?? [] })),
      }
      timers.forEach(clearTimeout); setStep(3)
      setTimeout(() => { setParsed(p); setConfirmed(new Set()); setPhase('review') }, 500)
    } catch (e: any) {
      timers.forEach(clearTimeout); toast.error(e.message || 'Could not read the recipe'); setPhase('input')
    }
  }

  const allergenUnion = parsed ? [...new Set(parsed.ingredients.flatMap((i) => i.allergens))] : []
  const flaggedIdx = parsed ? parsed.ingredients.map((i, idx) => (i.allergens.length && !confirmed.has(idx) ? idx : -1)).filter((x) => x >= 0) : []
  const dietary = (() => {
    const a = allergenUnion
    return [a.every((x) => !['milk', 'eggs', 'fish', 'crustaceans', 'molluscs'].includes(x)) && 'Vegan', a.every((x) => !['fish', 'crustaceans', 'molluscs'].includes(x)) && 'Vegetarian', !a.includes('gluten') && 'Gluten-free', !a.includes('milk') && 'Dairy-free'].filter(Boolean) as string[]
  })()

  function removeTag(idx: number, a: string) { setParsed((p) => p ? { ...p, ingredients: p.ingredients.map((ing, i) => i === idx ? { ...ing, allergens: ing.allergens.filter((x) => x !== a) } : ing) } : p); setConfirmed((s) => new Set(s).add(idx)) }
  function toggleHaccp(id: string) { setParsed((p) => p ? { ...p, haccp_methods: p.haccp_methods.includes(id) ? p.haccp_methods.filter((x) => x !== id) : [...p.haccp_methods, id] } : p) }

  async function save() {
    if (!parsed) return
    setSaving(true)
    try {
      const valid = parsed.ingredients.filter((i) => i.name.trim())
      const { data: rpc, error } = await supabase.rpc('create_recipe_with_ingredients', {
        p: {
          recipe: {
            name: parsed.name.trim() || 'Imported recipe', description: parsed.description.trim() || null, category: parsed.category || null,
            instructions: parsed.instructions.trim() || null, cooking_method: parsed.cooking_method.trim() || null,
            cooking_temp: parsed.cooking_temp || null, cooking_time: parsed.cooking_time || null, cooking_time_unit: parsed.cooking_time_unit,
            chilling_method: parsed.chilling_method.trim() || null, freezing_instructions: parsed.freezing_instructions.trim() || null,
            defrosting_instructions: parsed.defrosting_instructions.trim() || null, reheating_instructions: parsed.reheating_instructions.trim() || null,
            hot_holding_required: parsed.hot_holding_required, haccp_methods: parsed.haccp_methods,
          },
          ingredients: valid.map((ing) => ({ name: ing.name.trim(), allergens: ing.allergens, quantity: ing.quantity?.toString().trim() || null, unit: ing.unit.trim() || null })),
          tags: [],
        },
      })
      if (error) throw error
      const recipeId = (rpc as { recipe_id: string }).recipe_id
      if (parsed.extra_care_flags.length) await supabase.from('recipes').update({ extra_care_flags: parsed.extra_care_flags }).eq('id', recipeId)
      toast.success(`"${parsed.name.trim() || 'Recipe'}" added to recipes`)
      ;['recipes', 'haccp-recipes', 'menu-recipes', 'menu-all-recipes', 'allergen-recipes'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      router.push(`/recipes/${recipeId}`)
    } catch (e: any) { toast.error(e.message || 'Failed to save') } finally { setSaving(false) }
  }

  const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, padding: 20 }
  const modeChip = (on: boolean): React.CSSProperties => ({ border: on ? 'none' : '1px solid #e5e7ea', background: on ? '#16181d' : '#fff', color: on ? '#fff' : '#41464d', font: "600 13px 'Geist'", padding: '8px 15px', borderRadius: 9, cursor: 'pointer' })

  return (
    <div style={{ fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d', margin: '-16px -24px 0' }}>
      {/* top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, height: 62, background: '#fff', borderBottom: '1px solid #eceef0', display: 'flex', alignItems: 'center', gap: 14, padding: '0 24px' }}>
        <button onClick={() => router.push('/recipes')} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: '#6b7280', font: "600 13.5px 'Geist'", cursor: 'pointer' }}><ChevronLeft className="h-4 w-4" strokeWidth={2} /> Recipes</button>
        <span style={{ width: 1, height: 22, background: '#eceef0' }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: "700 15px 'Geist'" }}><Sparkles className="h-4 w-4" style={{ color: '#1f9d63' }} strokeWidth={2} /> AI Import</span>
        <div style={{ marginLeft: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
          {[['Paste', phase === 'input'], ['Review', phase === 'review']].map(([label, active], i) => (
            <button key={label as string} onClick={() => { if (i === 0) setPhase('input'); else if (parsed) setPhase('review') }} style={{ display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: 'none', cursor: 'pointer' }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 11px 'Geist'", background: (active || (i === 0 && parsed)) ? '#1f9d63' : '#eef0f2', color: (active || (i === 0 && parsed)) ? '#fff' : '#8a9099' }}>{i + 1}</span>
              <span style={{ font: `600 13px 'Geist'`, color: active ? '#16181d' : '#8a9099' }}>{label as string}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: phase === 'review' ? 1060 : 760, margin: '0 auto', padding: '28px 24px 40px' }}>
        {phase === 'input' && (
          <>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-.02em' }}>Drop in a recipe, any format</h1>
            <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8, lineHeight: 1.55 }}>Paste text, upload a photo of a recipe card, or point us at a link. The AI splits ingredients and tags the 14 UK allergens — you review before anything saves.</p>
            <div style={{ display: 'flex', gap: 8, margin: '18px 0' }}>
              <button onClick={() => setMode('text')} style={modeChip(mode === 'text')}>Paste text</button>
              <button onClick={() => setMode('photo')} style={modeChip(mode === 'photo')}>Upload photo</button>
              <button onClick={() => setMode('url')} style={modeChip(mode === 'url')}>From a link</button>
            </div>

            {mode === 'text' && (
              <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={10} placeholder={"Paste a recipe here…\n\ne.g.\nMushroom Risotto — serves 4\n300g arborio rice, 400g mushrooms, 1 onion, 100ml white wine, 50g parmesan…"} style={{ width: '100%', border: 'none', outline: 'none', resize: 'vertical', padding: '18px 20px', font: "400 13.5px/1.6 'Geist'", color: '#16181d' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fafbfb', borderTop: '1px solid #f2f3f5', padding: '10px 16px' }}>
                  <button onClick={() => setRaw(SAMPLE)} style={{ border: 'none', background: 'none', color: '#1f7a52', font: "600 12.5px 'Geist'", cursor: 'pointer' }}>Try with a sample recipe</button>
                  <span style={{ fontSize: 12, color: '#9aa0a8' }}>{raw.length} characters</span>
                </div>
              </div>
            )}
            {mode === 'photo' && (
              <div onClick={() => fileRef.current?.click()} style={{ border: '1.5px dashed #cfd3d8', borderRadius: 16, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', color: '#8a9099', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => setPhotos([...e.target.files ?? []].slice(0, 5))} />
                <ImageIcon className="h-6 w-6" strokeWidth={1.6} style={{ color: '#c2c6cc' }} />
                <span style={{ font: "600 14px 'Geist'", color: '#5c626b' }}>{photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'} selected` : 'Drop a photo of the recipe card'}</span>
                <span style={{ fontSize: 12.5 }}>Handwritten is fine · JPG, PNG, PDF · up to 10 MB</span>
              </div>
            )}
            {mode === 'url' && (
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… link to a recipe page or shared doc" style={{ width: '100%', border: '1px solid #e2e4e8', borderRadius: 12, padding: '13px 15px', font: "500 14px 'Geist'", outline: 'none' }} />
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 }}>
              <button onClick={extract} disabled={!canExtract} style={{ display: 'flex', alignItems: 'center', gap: 8, background: canExtract ? '#1f9d63' : '#c9ccd1', border: 'none', color: '#fff', font: "600 14px 'Geist'", padding: '11px 20px', borderRadius: 11, cursor: canExtract ? 'pointer' : 'not-allowed' }}><Sparkles className="h-4 w-4" strokeWidth={2} /> Extract recipe</button>
              <span style={{ fontSize: 12.5, color: '#9aa0a8' }}>Nothing is saved until you approve the review.</span>
            </div>
          </>
        )}

        {phase === 'analyzing' && (
          <div style={{ maxWidth: 460, margin: '40px auto', textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 18, margin: '0 auto', background: '#eef4f0', color: '#1f9d63', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pulse 1.4s ease-in-out infinite' }}><Sparkles className="h-7 w-7" strokeWidth={1.8} /></div>
            <div style={{ font: "700 18px 'Geist'", marginTop: 18 }}>Reading the recipe…</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20, textAlign: 'left' }}>
              {['Reading text & splitting ingredients', 'Matching the 14 UK allergens', 'Suggesting HACCP controls'].map((s, i) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#fff', border: '1px solid #e9eaed', borderRadius: 12, padding: '12px 15px' }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: step > i ? '#1f9d63' : 'transparent', border: step > i ? 'none' : '2px solid #e2e4e8' }}>{step > i ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : (step === i ? <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #cdd1d6', borderTopColor: '#1f9d63', animation: 'spin .7s linear infinite' }} /> : null)}</span>
                  <span style={{ font: "500 13.5px 'Geist'", color: step > i ? '#1c1f24' : '#8a9099' }}>{s}</span>
                </div>
              ))}
            </div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
          </div>
        )}

        {phase === 'review' && parsed && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#eef4f0', border: '1px solid #d7e7dd', borderRadius: 12, padding: '12px 15px', fontSize: 13, color: '#1a6e49', lineHeight: 1.5 }}>
                <Sparkles className="h-4 w-4" style={{ flex: 'none' }} strokeWidth={1.8} />
                <span>Extracted 1 recipe{flaggedIdx.length ? <> · <b>{flaggedIdx.length} item{flaggedIdx.length === 1 ? '' : 's'} need your eyes</b> — highlighted below.</> : ''} Everything is editable.</span>
              </div>
              <div style={CARD}>
                <input value={parsed.name} onChange={(e) => setParsed({ ...parsed, name: e.target.value })} placeholder="Recipe name" style={{ width: '100%', border: 'none', outline: 'none', font: "700 20px 'Geist'" }} />
                <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 4, textTransform: 'capitalize' }}>{[parsed.category, parsed.cooking_method, parsed.cooking_time ? `${parsed.cooking_time} min` : null, `${parsed.ingredients.length} ingredients`].filter(Boolean).join(' · ')}</div>
              </div>
              <div style={CARD}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Ingredients</div>
                {parsed.ingredients.map((ing, idx) => {
                  const flagged = ing.allergens.length > 0 && !confirmed.has(idx)
                  return (
                    <div key={idx} style={{ borderTop: '1px solid #f2f3f5', padding: '11px 0', background: flagged ? '#fdfaf1' : 'transparent', margin: '0 -6px', paddingLeft: 6, paddingRight: 6, borderRadius: flagged ? 8 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ flex: 1, font: "600 13.5px 'Geist'" }}>{ing.name} {ing.quantity && <span style={{ color: '#9aa0a8', fontWeight: 400 }}>· {ing.quantity}{ing.unit}</span>}</span>
                        {ing.allergens.length === 0 ? <span style={{ fontSize: 12, color: '#b3b8bf' }}>no allergens</span> : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'flex-end' }}>
                            {ing.allergens.map((a) => <button key={a} onClick={() => removeTag(idx, a)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: "600 12px 'Geist'", color: '#a1493f', background: '#fbf0ee', border: '1px solid #f3ddd9', borderRadius: 7, padding: '3px 8px', cursor: 'pointer' }}>{ALLERGEN_LABELS[a as keyof typeof ALLERGEN_LABELS] ?? a} <X className="h-3 w-3" /></button>)}
                          </div>
                        )}
                      </div>
                      {flagged && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5, font: "500 12px 'Geist'", color: '#8a6a1f', flex: 1 }}><AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.9} /> AI tagged these — confirm or remove.</span>
                          <button onClick={() => setConfirmed((s) => new Set(s).add(idx))} style={{ border: '1px solid #cfe0d6', background: '#fff', color: '#1f7a52', font: "600 12px 'Geist'", padding: '5px 11px', borderRadius: 8, cursor: 'pointer' }}>Looks right</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div style={CARD}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Suggested HACCP controls</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {CONTROLS.map((c) => { const on = parsed.haccp_methods.includes(c.id); return <button key={c.id} onClick={() => toggleHaccp(c.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: on ? '1px solid #bfdccb' : '1px solid #e5e7ea', background: on ? '#f4faf6' : '#fff', color: on ? '#1a6e49' : '#5c626b', font: "600 12.5px 'Geist'", padding: '7px 12px', borderRadius: 9, cursor: 'pointer' }}>{on && <Check className="h-3.5 w-3.5" strokeWidth={2.6} />}{c.label}</button> })}
                </div>
              </div>
            </div>

            {/* rail */}
            <div style={{ flex: '1 1 260px', maxWidth: 300, position: 'sticky', top: 78, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={CARD}>
                <div style={{ font: "600 11px 'Geist'", letterSpacing: '.05em', textTransform: 'uppercase', color: '#8a9099' }}>Will be saved as</div>
                <div style={{ font: "700 17px 'Geist'", marginTop: 8, color: parsed.name ? '#16181d' : '#b3b8bf' }}>{parsed.name || 'Untitled'}</div>
                <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 4, textTransform: 'capitalize' }}>{[parsed.category, `${parsed.ingredients.length} ingredients`].filter(Boolean).join(' · ')}</div>
                <div style={{ height: 1, background: '#f2f3f5', margin: '13px 0' }} />
                <div style={{ font: "600 12px 'Geist'", color: '#6f7580', marginBottom: 7 }}>Allergens</div>
                {allergenUnion.length === 0 ? <div style={{ fontSize: 12.5, color: '#8a9099' }}>None declared</div> : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{allergenUnion.map((a) => <span key={a} style={{ font: "600 12px 'Geist'", color: '#a1493f', background: '#fbf0ee', border: '1px solid #f3ddd9', borderRadius: 7, padding: '3px 9px' }}>{ALLERGEN_LABELS[a as keyof typeof ALLERGEN_LABELS] ?? a}</span>)}</div>}
                {dietary.length > 0 && <><div style={{ font: "600 12px 'Geist'", color: '#6f7580', margin: '13px 0 7px' }}>Dietary · auto</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{dietary.map((d) => <span key={d} style={{ font: "600 12px 'Geist'", color: '#1a6e49', background: '#e9f2ec', borderRadius: 7, padding: '3px 9px' }}>{d}</span>)}</div></>}
              </div>
              {flaggedIdx.length > 0 && (
                <div style={{ background: '#fbf5e6', border: '1px solid #eddfba', borderRadius: 14, padding: '13px 15px', fontSize: 12.5, color: '#8a6a1f', lineHeight: 1.5 }}>{flaggedIdx.length} ingredient{flaggedIdx.length === 1 ? '' : 's'} still need a check — you can save anyway, it stays flagged on the recipe.</div>
              )}
              <button onClick={save} disabled={saving} style={{ background: '#1f9d63', border: 'none', color: '#fff', font: "600 14px 'Geist'", padding: '12px', borderRadius: 11, cursor: 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}>{saving ? 'Saving…' : 'Add to recipes'}</button>
              <button onClick={() => { setParsed(null); setPhase('input') }} style={{ background: 'none', border: 'none', color: '#8a9099', font: "600 13px 'Geist'", cursor: 'pointer', padding: 4 }}>Start over</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
