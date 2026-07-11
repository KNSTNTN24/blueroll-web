'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { ChevronLeft, Plus, Trash2, Check } from 'lucide-react'
import { EU_ALLERGENS, ALLERGEN_LABELS } from '@/lib/constants'
import { HACCP_RECIPE_METHODS } from '@/lib/haccp-methods'

interface Ing { id: string; name: string; qty: string; unit: string; allergens: string[] }

const CATEGORIES = [{ label: 'Starters', v: 'starter' }, { label: 'Mains', v: 'main' }, { label: 'Sides', v: 'side' }, { label: 'Desserts', v: 'dessert' }]
const COOKING = ['Oven', 'Grill', 'Pan fry', 'Deep fry', 'Boil / simmer', 'Steam', 'No cook']
const UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'tbsp', 'tsp']
// The 8 HACCP control cards (cooking is handled in the Method section).
const CONTROLS = HACCP_RECIPE_METHODS.filter((m) => m.id !== 'cooking_safely')
const CONTROL_HINT: Record<string, string> = {
  chilled_storage: 'e.g. Fridge 0–5°C, use within 3 days',
  chilling_down: 'e.g. Portion, blast chill to <8°C within 90 min',
  defrosting: 'e.g. Overnight in the fridge — never at room temperature',
  freezing: 'e.g. Portion, label with freeze date',
  reheating: 'e.g. Reheat once to 75°C core',
  hot_holding: 'e.g. Hold above 63°C, discard after 2 hours',
  ready_to_eat: 'e.g. Separate boards, no bare-hand contact',
  extra_care: 'e.g. Cook thoroughly for vulnerable groups',
}
const uid = () => Math.random().toString(36).slice(2, 9)

export default function NewRecipePage() {
  const router = useRouter()
  const qc = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)

  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [ingredients, setIngredients] = useState<Ing[]>([{ id: uid(), name: '', qty: '', unit: 'g', allergens: [] }])
  const [cookingMethod, setCookingMethod] = useState('')
  const [temp, setTemp] = useState('')
  const [time, setTime] = useState('')
  const [steps, setSteps] = useState('')
  const [controls, setControls] = useState<Set<string>>(new Set())
  const [controlInstr, setControlInstr] = useState<Record<string, string>>({})

  const validIngredients = ingredients.filter((i) => i.name.trim())
  const allergenUnion = useMemo(() => {
    const s = new Set<string>(); ingredients.forEach((i) => i.allergens.forEach((a) => s.add(a))); return [...s]
  }, [ingredients])
  const dietary = useMemo(() => {
    const a = allergenUnion
    return [
      a.every((x) => !['milk', 'eggs', 'fish', 'crustaceans', 'molluscs'].includes(x)) && 'Vegan',
      a.every((x) => !['fish', 'crustaceans', 'molluscs'].includes(x)) && 'Vegetarian',
      !a.includes('gluten') && 'Gluten-free',
      !a.includes('milk') && 'Dairy-free',
    ].filter(Boolean) as string[]
  }, [allergenUnion])

  const canSave = !!name.trim() && !!category && validIngredients.length > 0

  function setIng(id: string, patch: Partial<Ing>) { setIngredients((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r))) }
  function toggleAllergen(id: string, a: string) {
    setIngredients((rows) => rows.map((r) => (r.id === id ? { ...r, allergens: r.allergens.includes(a) ? r.allergens.filter((x) => x !== a) : [...r.allergens, a] } : r)))
  }
  function toggleControl(cid: string) {
    setControls((s) => { const n = new Set(s); if (n.has(cid)) n.delete(cid); else n.add(cid); return n })
  }

  async function save() {
    if (!business?.id || !profile?.id || !canSave) return
    setSaving(true)
    try {
      const ingredientIds: Record<string, string> = {}
      for (const ing of validIngredients) {
        const { data: existing } = await supabase.from('ingredients').select('id').eq('business_id', business.id).ilike('name', ing.name.trim()).maybeSingle()
        if (existing) { await supabase.from('ingredients').update({ allergens: ing.allergens }).eq('id', existing.id); ingredientIds[ing.name] = existing.id }
        else { const { data: created, error } = await supabase.from('ingredients').insert({ business_id: business.id, name: ing.name.trim(), allergens: ing.allergens }).select('id').single(); if (error) throw error; ingredientIds[ing.name] = created.id }
      }

      const cooked = !!cookingMethod && cookingMethod !== 'No cook'
      const haccp = [...controls]; if (cooked) haccp.push('cooking_safely')

      const { data: recipe, error: rErr } = await supabase.from('recipes').insert({
        business_id: business.id, created_by: profile.id, name: name.trim(), description: description.trim() || null, category,
        instructions: steps.trim() || null, cooking_method: cookingMethod || null,
        cooking_temp: temp ? Number(temp) : null, cooking_time: time ? Number(time) : null, cooking_time_unit: 'minutes',
        chilling_method: controls.has('chilling_down') ? (controlInstr.chilling_down || null) : null,
        freezing_instructions: controls.has('freezing') ? (controlInstr.freezing || null) : null,
        defrosting_instructions: controls.has('defrosting') ? (controlInstr.defrosting || null) : null,
        reheating_instructions: controls.has('reheating') ? (controlInstr.reheating || null) : null,
        hot_holding_required: controls.has('hot_holding'),
        extra_care_flags: controls.has('extra_care') ? [controlInstr.extra_care || 'extra_care'] : [],
        haccp_methods: haccp, active: true,
        vegan_override: null, vegetarian_override: null, gluten_free_override: null, dairy_free_override: null,
      }).select('id').single()
      if (rErr) throw rErr

      const ri = validIngredients.map((ing) => ({ recipe_id: recipe.id, ingredient_id: ingredientIds[ing.name], quantity: ing.qty ? Number(ing.qty) : null, unit: ing.unit || null }))
      if (ri.length) { const { error } = await supabase.from('recipe_ingredients').insert(ri); if (error) throw error }

      toast.success(`"${name.trim()}" saved to recipes`)
      ;['recipes', 'haccp-recipes', 'menu-recipes', 'menu-all-recipes', 'allergen-recipes'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      router.push(`/recipes/${recipe.id}`)
    } catch (e: any) { toast.error(e.message || 'Failed to create recipe') } finally { setSaving(false) }
  }

  const checklist = [
    { label: 'Name the recipe', done: !!name.trim() },
    { label: 'Pick a category', done: !!category },
    { label: 'Add an ingredient', done: validIngredients.length > 0 },
    { label: 'Select HACCP controls', done: controls.size > 0 || !!cookingMethod },
  ]

  const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, padding: 20 }
  const catChip = (on: boolean): React.CSSProperties => ({ border: on ? 'none' : '1px solid #e5e7ea', background: on ? '#16181d' : '#fff', color: on ? '#fff' : '#41464d', font: "600 13px 'Geist'", padding: '8px 14px', borderRadius: 9, cursor: 'pointer' })
  const inputCss: React.CSSProperties = { border: '1px solid #e2e4e8', borderRadius: 10, padding: '9px 12px', font: "500 14px 'Geist'", color: '#16181d', outline: 'none' }

  return (
    <div style={{ fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d', margin: '-16px -24px 0' }}>
      {/* sticky top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, height: 62, background: '#fff', borderBottom: '1px solid #eceef0', display: 'flex', alignItems: 'center', gap: 14, padding: '0 24px' }}>
        <button onClick={() => router.push('/recipes')} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: '#6b7280', font: "600 13.5px 'Geist'", cursor: 'pointer' }}><ChevronLeft className="h-4 w-4" strokeWidth={2} /> Recipes</button>
        <span style={{ width: 1, height: 22, background: '#eceef0' }} />
        <span style={{ font: "700 15px 'Geist'" }}>New recipe</span>
        <span style={{ font: "500 12.5px 'Geist'", color: '#9aa0a8', background: '#f1f2f4', padding: '3px 9px', borderRadius: 20 }}>Draft · not saved</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button onClick={() => router.push('/recipes')} style={{ background: '#fff', border: '1px solid #e2e4e8', color: '#41464d', font: "600 13.5px 'Geist'", padding: '9px 15px', borderRadius: 10, cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={!canSave || saving} style={{ background: canSave ? '#1f9d63' : '#c9ccd1', border: 'none', color: '#fff', font: "600 13.5px 'Geist'", padding: '9px 16px', borderRadius: 10, cursor: canSave ? 'pointer' : 'not-allowed' }}>{saving ? 'Saving…' : 'Save recipe'}</button>
        </div>
      </div>

      <div style={{ maxWidth: 1060, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 20, padding: '20px 24px 40px', alignItems: 'flex-start' }}>
        {/* form column */}
        <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {/* Basics */}
          <div style={CARD}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Recipe name — e.g. Mushroom Risotto" style={{ width: '100%', border: 'none', outline: 'none', font: "700 21px 'Geist'", color: '#16181d', letterSpacing: '-.01em' }} />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One-line description (optional)" style={{ width: '100%', border: 'none', outline: 'none', font: "400 14px 'Geist'", color: '#5c626b', marginTop: 6 }} />
            <div style={{ height: 1, background: '#f2f3f5', margin: '14px 0' }} />
            <label style={{ font: "600 12.5px 'Geist'", color: '#6f7580' }}>Category</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {CATEGORIES.map((c) => <button key={c.v} onClick={() => setCategory(c.v)} style={catChip(category === c.v)}>{c.label}</button>)}
            </div>
          </div>

          {/* Ingredients */}
          <div style={CARD}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Ingredients</div>
            <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 3 }}>Tag allergens per ingredient — the recipe&apos;s allergen list builds itself.</div>
            <div style={{ marginTop: 12 }}>
              {ingredients.map((ing) => (
                <div key={ing.id} style={{ borderTop: '1px solid #f2f3f5', padding: '14px 0' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <input value={ing.name} onChange={(e) => setIng(ing.id, { name: e.target.value })} placeholder="Ingredient" style={{ ...inputCss, flex: '1 1 180px', minWidth: 160 }} />
                    <input value={ing.qty} onChange={(e) => setIng(ing.id, { qty: e.target.value })} placeholder="Qty" inputMode="decimal" style={{ ...inputCss, width: 74 }} />
                    <select value={ing.unit} onChange={(e) => setIng(ing.id, { unit: e.target.value })} style={{ ...inputCss, width: 84, background: '#fff' }}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
                    <button onClick={() => setIngredients((r) => r.length > 1 ? r.filter((x) => x.id !== ing.id) : r)} title="Remove" style={{ width: 34, height: 34, border: 'none', background: 'none', color: '#c2c6cc', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#fbf0ee'; e.currentTarget.style.color = '#a1493f' }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#c2c6cc' }}><Trash2 className="h-4 w-4" strokeWidth={1.7} /></button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {EU_ALLERGENS.map((a) => {
                      const on = ing.allergens.includes(a)
                      return <button key={a} onClick={() => toggleAllergen(ing.id, a)} style={{ font: "600 11.5px 'Geist'", padding: '4px 9px', borderRadius: 7, cursor: 'pointer', border: on ? '1px solid #e8c8c1' : '1px solid #eef0f2', background: on ? '#fbf0ee' : '#fff', color: on ? '#a1493f' : '#a3a8b0' }}>{ALLERGEN_LABELS[a]}</button>
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setIngredients((r) => [...r, { id: uid(), name: '', qty: '', unit: 'g', allergens: [] }])} style={{ width: '100%', border: 'none', background: 'none', color: '#1f7a52', font: "600 13.5px 'Geist'", padding: '12px 0 2px', cursor: 'pointer', textAlign: 'left', borderTop: '1px solid #f2f3f5', marginTop: 4 }}>＋ Add ingredient</button>
          </div>

          {/* Method */}
          <div style={CARD}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Method</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {COOKING.map((m) => <button key={m} onClick={() => setCookingMethod((v) => v === m ? '' : m)} style={catChip(cookingMethod === m)}>{m}</button>)}
            </div>
            {cookingMethod && cookingMethod !== 'No cook' && (
              <>
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <input value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="180" inputMode="decimal" style={{ ...inputCss, width: 100 }} /><span style={{ alignSelf: 'center', color: '#9aa0a8', marginLeft: -6 }}>°C</span>
                  <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="30" inputMode="decimal" style={{ ...inputCss, width: 100 }} /><span style={{ alignSelf: 'center', color: '#9aa0a8', marginLeft: -6 }}>min</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#9aa0a8', marginTop: 8 }}>Core 75°C for 2s applies to all cooked dishes.</div>
              </>
            )}
            <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={3} placeholder="Method steps (optional)…" style={{ ...inputCss, width: '100%', marginTop: 12, resize: 'vertical' }} />
          </div>

          {/* HACCP controls */}
          <div style={CARD}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>HACCP controls</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 8 }}>
              {CONTROLS.map((c) => {
                const on = controls.has(c.id)
                return (
                  <div key={c.id}>
                    <button onClick={() => toggleControl(c.id)} style={{ display: 'flex', gap: 10, width: '100%', textAlign: 'left', border: on ? '1px solid #bfdccb' : '1px solid #eceef0', background: on ? '#f4faf6' : '#fff', borderRadius: 11, padding: '12px 13px', cursor: 'pointer' }}>
                      <span style={{ width: 18, height: 18, borderRadius: 5, flex: 'none', marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? '#1f9d63' : '#fff', border: on ? 'none' : '1.6px solid #cdd1d6' }}>{on && <Check className="h-3 w-3 text-white" strokeWidth={3} />}</span>
                      <span><span style={{ display: 'block', font: "600 13.5px 'Geist'" }}>{c.label}</span><span style={{ display: 'block', font: "400 12px 'Geist'", color: '#8a9099', marginTop: 2 }}>{c.description}</span></span>
                    </button>
                    {on && <input value={controlInstr[c.id] ?? ''} onChange={(e) => setControlInstr((m) => ({ ...m, [c.id]: e.target.value }))} placeholder={CONTROL_HINT[c.id]} style={{ ...inputCss, width: '100%', marginTop: 6, fontSize: 13 }} />}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* sticky rail */}
        <div style={{ flex: '1 1 260px', maxWidth: 300, position: 'sticky', top: 78, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={CARD}>
            <div style={{ font: "600 11px 'Geist'", letterSpacing: '.05em', textTransform: 'uppercase', color: '#8a9099' }}>Recipe card</div>
            <div style={{ font: "700 18px 'Geist'", marginTop: 8, color: name ? '#16181d' : '#b3b8bf' }}>{name || 'Untitled recipe'}</div>
            <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 4 }}>{[category ? CATEGORIES.find((c) => c.v === category)?.label : null, `${validIngredients.length} ingredient${validIngredients.length === 1 ? '' : 's'}`, time ? `${time} min` : null, temp ? `${temp}°C` : null].filter(Boolean).join(' · ')}</div>
            <div style={{ height: 1, background: '#f2f3f5', margin: '14px 0' }} />
            <div style={{ font: "600 12px 'Geist'", color: '#6f7580', marginBottom: 7 }}>Allergens</div>
            {allergenUnion.length === 0 ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#8a9099' }}><Check className="h-3.5 w-3.5" style={{ color: '#1f9d63' }} strokeWidth={2.4} /> None declared yet</div>
            ) : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{allergenUnion.map((a) => <span key={a} style={{ font: "600 12px 'Geist'", color: '#a1493f', background: '#fbf0ee', border: '1px solid #f3ddd9', borderRadius: 7, padding: '3px 9px' }}>{ALLERGEN_LABELS[a as keyof typeof ALLERGEN_LABELS] ?? a}</span>)}</div>}
            {dietary.length > 0 && <>
              <div style={{ font: "600 12px 'Geist'", color: '#6f7580', margin: '13px 0 7px' }}>Dietary · auto</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{dietary.map((d) => <span key={d} style={{ font: "600 12px 'Geist'", color: '#1a6e49', background: '#e9f2ec', borderRadius: 7, padding: '3px 9px' }}>{d}</span>)}</div>
            </>}
          </div>

          <div style={CARD}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Ready to save?</div>
            {checklist.map((c) => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0' }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.done ? '#1f9d63' : 'transparent', border: c.done ? 'none' : '1.6px solid #d4d7db' }}>{c.done && <Check className="h-3 w-3 text-white" strokeWidth={3} />}</span>
                <span style={{ font: "500 13.5px 'Geist'", color: c.done ? '#1c1f24' : '#8a9099' }}>{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
