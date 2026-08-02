'use client'

import { use, useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  ChevronLeft, Pencil, Trash2, Power, Flame, AlertTriangle,
  MoreHorizontal, Copy, FileDown, Check,
} from 'lucide-react'
import { ALLERGEN_LABELS, type EUAllergen } from '@/lib/constants'
import { dishesForRecipe, convertDishesToManual } from '@/lib/dishes'
import { HACCP_RECIPE_METHODS } from '@/lib/haccp-methods'
import { effectiveDietary } from '@/lib/dietary'
import { getRecipeTags } from '@/lib/tags'
import { formatDistanceToNow, parseISO } from 'date-fns'

const EXTRA_CARE_LABELS: Record<string, string> = {
  eggs: 'Eggs', rice: 'Rice', pulses: 'Pulses', shellfish: 'Shellfish',
}
const EXTRA_CARE_NOTE: Record<string, string> = {
  eggs: 'Uses raw or lightly-cooked eggs — cook thoroughly or use pasteurised egg for vulnerable groups.',
  rice: 'Cooked rice — cool within 90 minutes and refrigerate; reheat once, piping hot.',
  pulses: 'Dried pulses must be soaked and boiled hard for at least 10 minutes before use.',
  shellfish: 'Shellfish — keep chilled, cook thoroughly and never re-freeze once defrosted.',
}

// Split an instructions blob into discrete steps (newlines first, then "1." numbering).
function splitSteps(text?: string | null): string[] {
  if (!text) return []
  const t = text.trim()
  if (!t) return []
  const lines = t.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean)
  if (lines.length > 1) return lines.map((l) => l.replace(/^\s*\d+[.)]\s*/, ''))
  const parts = t.split(/\s*\d+[.)]\s+/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts : [t]
}

export default function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const queryClient = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const canManageRecipes = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'chef'
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!moreOpen) return
    const h = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [moreOpen])

  const { data: recipe, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select(`
          *,
          recipe_ingredients ( quantity, unit, ingredient:ingredients (id, name, allergens) ),
          recipe_tags ( tag:tags (id, name) )
        `)
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
  })

  function getAllergens(): string[] {
    if (!recipe) return []
    const set = new Set<string>()
    recipe.recipe_ingredients?.forEach((ri: any) => ri.ingredient?.allergens?.forEach((a: string) => set.add(a)))
    return Array.from(set)
  }

  async function handleToggleActive() {
    if (!recipe) return
    setMoreOpen(false)
    const { error } = await supabase.from('recipes').update({ active: !recipe.active }).eq('id', recipe.id)
    if (error) return toast.error('Failed to update status')
    toast.success(recipe.active ? 'Recipe deactivated' : 'Recipe activated')
    queryClient.invalidateQueries({ queryKey: ['recipe', id] })
    queryClient.invalidateQueries({ queryKey: ['recipes'] })
  }

  async function handleDelete() {
    setMoreOpen(false)
    // Dishes built from this recipe would lose their allergen evidence, so the
    // FK blocks the delete. Surface them and offer to keep them on the menu as
    // hand-declared items rather than failing with a constraint error.
    const dishes = await dishesForRecipe(supabase, recipe!.id)
    if (dishes.length > 0) {
      const one = dishes.length === 1
      const names = dishes.map((d) => `• ${d.name}`).join('\n')
      const ok = confirm(
        `${dishes.length} dish${one ? '' : 'es'} on the menu ${one ? 'takes its' : 'take their'} allergens from this recipe:\n\n${names}\n\n` +
        `Deleting it will convert ${one ? 'it' : 'them'} to hand-declared dish${one ? '' : 'es'}: today's allergens are kept, but ${one ? 'it stops' : 'they stop'} being traceable to ingredients and you are recorded as attesting to them.\n\nContinue?`
      )
      if (!ok) return
      try {
        await convertDishesToManual(supabase, dishes, profile?.id ?? null, profile?.full_name ?? profile?.email ?? 'Unknown')
      } catch {
        return toast.error('Could not convert the affected dishes — recipe not deleted')
      }
    } else if (!confirm('Delete this recipe? This cannot be undone.')) return

    const { error } = await supabase.from('recipes').delete().eq('id', recipe!.id)
    if (error) return toast.error('Failed to delete recipe')
    toast.success(dishes.length ? `Recipe deleted · ${dishes.length} dish${dishes.length === 1 ? '' : 'es'} now hand-declared` : 'Recipe deleted')
    router.push('/recipes')
  }

  async function handleDuplicate() {
    if (!recipe) return
    setMoreOpen(false)
    const { recipe_ingredients, recipe_tags, id: _id, created_at, updated_at, ...fields } = recipe as any
    const { data: created, error } = await supabase
      .from('recipes')
      .insert({ ...fields, name: `${recipe.name} (copy)`, active: true })
      .select('id').single()
    if (error || !created) return toast.error('Failed to duplicate recipe')
    const ingRows = (recipe_ingredients ?? [])
      .map((ri: any) => ({ recipe_id: created.id, ingredient_id: ri.ingredient?.id, quantity: ri.quantity, unit: ri.unit }))
      .filter((r: any) => r.ingredient_id)
    if (ingRows.length) await supabase.from('recipe_ingredients').insert(ingRows)
    const tagRows = getRecipeTags(recipe).map((t) => ({ recipe_id: created.id, tag_id: t.id }))
    if (tagRows.length) await supabase.from('recipe_tags').insert(tagRows)
    toast.success('Recipe duplicated')
    queryClient.invalidateQueries({ queryKey: ['recipes'] })
    router.push(`/recipes/edit/${created.id}`)
  }

  if (isLoading) return <div style={{ padding: '64px 0', textAlign: 'center', color: '#9aa0a8', font: "500 13px 'Geist'" }}>Loading recipe…</div>
  if (!recipe) return <div style={{ padding: '64px 0', textAlign: 'center', color: '#9aa0a8', font: "500 13px 'Geist'" }}>Recipe not found</div>

  const allergens = getAllergens()
  const dietary = effectiveDietary(recipe, allergens)
  const tags = getRecipeTags(recipe)
  const steps = splitSteps(recipe.instructions)
  const ingredients = recipe.recipe_ingredients ?? []
  const tempStr = recipe.cooking_temp ? `${recipe.cooking_temp} °${recipe.cooking_temp_unit === 'fahrenheit' ? 'F' : 'C'}` : null
  const methodChip = [recipe.cooking_method, tempStr].filter(Boolean).join(' · ')
  const chilling = HACCP_RECIPE_METHODS.filter((m) => m.section === 'Chilling' && recipe.haccp_methods?.includes(m.id))
  const cooking = HACCP_RECIPE_METHODS.filter((m) => m.section === 'Cooking' && recipe.haccp_methods?.includes(m.id))
  const lastEdited = recipe.updated_at ? formatDistanceToNow(parseISO(recipe.updated_at)).replace('about ', '') : null

  const outlineChip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #e9eaed', borderRadius: 20, font: "600 12.5px 'Geist'", color: '#41464d', padding: '6px 11px' }
  const railLabel: React.CSSProperties = { font: "600 11px 'Geist'", letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a9099' }
  const railCard: React.CSSProperties = { background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, padding: 17, boxShadow: '0 1px 2px rgba(16,24,40,.03)' }

  return (
    <div style={{ maxWidth: 1060, margin: '0 auto', fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingBottom: 18 }}>
        <button onClick={() => router.push('/recipes')} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer', font: "600 13.5px 'Geist'", color: '#6b7280' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#16181d')} onMouseLeave={(e) => (e.currentTarget.style.color = '#6b7280')}>
          <ChevronLeft className="h-4 w-4" strokeWidth={2} /> Recipes
        </button>
        <span style={{ width: 1, height: 18, background: '#e5e7ea' }} />
        <span style={{ font: "700 15px 'Geist'", color: '#16181d' }}>{recipe.name}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: recipe.active ? '#e9f6ef' : '#f1f2f4', borderRadius: 20, padding: '4px 10px', font: "600 12px 'Geist'", color: recipe.active ? '#1f7a52' : '#6b7280' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: recipe.active ? '#1f9d63' : '#9aa0a8' }} /> {recipe.active ? 'Active' : 'Inactive'}
        </span>

        {canManageRecipes && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div ref={moreRef} style={{ position: 'relative' }}>
              <button onClick={() => setMoreOpen((v) => !v)} aria-label="More actions"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, border: '1px solid #e2e4e8', borderRadius: 10, background: moreOpen ? '#f4f5f6' : '#fff', color: '#5c626b', cursor: 'pointer' }}>
                <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
              {moreOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 190, background: '#fff', border: '1px solid #e7e9ec', borderRadius: 12, boxShadow: '0 18px 44px -18px rgba(16,24,40,.28)', padding: 5, zIndex: 50 }}>
                  {[
                    { label: 'Duplicate recipe', Icon: Copy, onClick: handleDuplicate },
                    { label: 'Export as PDF', Icon: FileDown, onClick: () => { setMoreOpen(false); window.print() } },
                    { label: recipe.active ? 'Deactivate' : 'Activate', Icon: Power, onClick: handleToggleActive },
                  ].map((it) => (
                    <button key={it.label} onClick={it.onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: 'none', background: 'none', borderRadius: 8, padding: '8px 9px', font: "500 13px 'Geist'", color: '#3c414a', cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f6f7')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
                      <it.Icon className="h-4 w-4" strokeWidth={1.7} style={{ color: '#8a9099' }} /> {it.label}
                    </button>
                  ))}
                  <div style={{ height: 1, background: '#f2f3f5', margin: '5px 4px' }} />
                  <button onClick={handleDelete} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: 'none', background: 'none', borderRadius: 8, padding: '8px 9px', font: "500 13px 'Geist'", color: '#c0392b', cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#fdf3f2')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} /> Delete recipe
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => router.push(`/recipes/edit/${recipe.id}`)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#1f9d63', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', font: "600 13.5px 'Geist'", cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#1a8a56')} onMouseLeave={(e) => (e.currentTarget.style.background = '#1f9d63')}>
              <Pencil className="h-[15px] w-[15px]" strokeWidth={1.9} /> Edit recipe
            </button>
          </div>
        )}
      </div>

      {/* title block */}
      <h1 style={{ margin: 0, font: "700 25px 'Geist'", letterSpacing: '-.02em' }}>{recipe.name}</h1>
      {recipe.description && <p style={{ margin: '8px 0 0', font: "400 14px 'Geist'", color: '#6b7280', maxWidth: 560, lineHeight: 1.5 }}>{recipe.description}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 13 }}>
        {methodChip && <span style={outlineChip}><Flame className="h-[13px] w-[13px]" strokeWidth={1.9} style={{ color: '#9aa0a8' }} /> {methodChip}</span>}
        <span style={outlineChip}>{ingredients.length} ingredient{ingredients.length === 1 ? '' : 's'}</span>
        {steps.length > 0 && <span style={outlineChip}>{steps.length} step{steps.length === 1 ? '' : 's'}</span>}
        {tags.length > 0 && <span style={{ width: 1, height: 18, background: '#e5e7ea' }} />}
        {tags.map((t) => <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', background: '#eef0f2', borderRadius: 20, font: "500 12.5px 'Geist'", color: '#6b7280', padding: '6px 11px' }}>{t.name}</span>)}
      </div>

      {/* two columns */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', marginTop: 22 }}>
        {/* main */}
        <div style={{ flex: '1 1 480px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* ingredients */}
          <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '15px 20px 13px' }}>
              <span style={{ font: "700 15px 'Geist'" }}>Ingredients</span>
              <span style={{ font: "600 12px 'Geist'", color: '#8a9099', background: '#f1f2f4', borderRadius: 14, padding: '1px 8px' }}>{ingredients.length}</span>
              <span style={{ marginLeft: 'auto', font: "500 12px 'Geist'", color: '#9aa0a8' }}>allergens detected automatically</span>
            </div>
            {ingredients.length === 0 ? (
              <div style={{ padding: '0 20px 16px', font: "500 13px 'Geist'", color: '#9aa0a8' }}>No ingredients listed.</div>
            ) : ingredients.map((ri: any, i: number) => {
              const amt = [ri.quantity, ri.unit].filter((x) => x !== null && x !== undefined && x !== '').join(' ')
              const algs: string[] = ri.ingredient?.allergens ?? []
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9.5px 20px', borderTop: '1px solid #f4f5f6' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ flex: 1, font: "500 13.5px 'Geist'", color: '#16181d' }}>{ri.ingredient?.name}</span>
                  <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {algs.map((a) => (
                      <span key={a} style={{ font: "600 11.5px 'Geist'", color: '#b07d1e', background: '#fbf3e6', border: '1px solid #f2e2c4', borderRadius: 14, padding: '1px 8px', whiteSpace: 'nowrap' }}>{ALLERGEN_LABELS[a as EUAllergen] ?? a}</span>
                    ))}
                  </span>
                  <span style={{ width: 76, textAlign: 'right', font: "600 13px 'Geist'", color: '#41464d', fontVariantNumeric: 'tabular-nums' }}>{amt || '—'}</span>
                </div>
              )
            })}
          </div>

          {/* method */}
          {steps.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03)', padding: '15px 20px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
                <span style={{ font: "700 15px 'Geist'" }}>Method</span>
                <span style={{ font: "600 12px 'Geist'", color: '#8a9099', background: '#f1f2f4', borderRadius: 14, padding: '1px 8px' }}>{steps.length} step{steps.length === 1 ? '' : 's'}</span>
              </div>
              {steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 13, padding: '11px 0', borderTop: i === 0 ? 'none' : '1px solid #f4f5f6' }}>
                  <span style={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', background: '#eef7f2', color: '#1f7a52', font: "700 12.5px 'Geist'", display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  <span style={{ font: "400 14px 'Geist'", lineHeight: 1.6, color: '#3c414a', textWrap: 'pretty' as any }}>{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* rail */}
        <div style={{ flex: '1 1 260px', maxWidth: 300, position: 'sticky', top: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* allergens */}
          <div style={railCard}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 11 }}>
              <span style={railLabel}>Allergens</span>
              <span style={{ marginLeft: 'auto', font: "700 12px 'Geist'", color: '#b07d1e' }}>{allergens.length} of 14</span>
            </div>
            {allergens.length === 0 ? (
              <div style={{ font: "500 12.5px 'Geist'", color: '#9aa0a8' }}>None mapped from ingredients.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {allergens.map((a) => <span key={a} style={{ font: "600 12.5px 'Geist'", color: '#8a6a1f', background: '#fbf3e6', border: '1px solid #f2e2c4', borderRadius: 16, padding: '3px 10px' }}>{ALLERGEN_LABELS[a as EUAllergen] ?? a}</span>)}
              </div>
            )}
            <div style={{ height: 1, background: '#f2f3f5', margin: '12px 0 10px' }} />
            <div style={{ font: "400 12px 'Geist'", color: '#9aa0a8', lineHeight: 1.5 }}>Mapped from ingredients. Shown on the <button onClick={() => router.push('/allergens')} style={{ border: 'none', background: 'none', padding: 0, font: "500 12px 'Geist'", color: '#1f7a52', cursor: 'pointer' }}>allergen matrix</button>.</div>
          </div>

          {/* dietary */}
          {dietary.length > 0 && (
            <div style={railCard}>
              <div style={{ ...railLabel, marginBottom: 11 }}>Dietary labels</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {dietary.map((d) => <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: "600 12.5px 'Geist'", color: '#1f7a52', background: '#e9f6ef', borderRadius: 16, padding: '3px 10px' }}><Check className="h-3 w-3" strokeWidth={2.4} /> {d}</span>)}
              </div>
            </div>
          )}

          {/* haccp */}
          {(chilling.length > 0 || cooking.length > 0) && (
            <div style={railCard}>
              <div style={{ ...railLabel, marginBottom: 12 }}>HACCP control methods</div>
              {chilling.length > 0 && (
                <div style={{ marginBottom: cooking.length > 0 ? 14 : 0 }}>
                  <div style={{ font: "600 11px 'Geist'", color: '#4a90b8', letterSpacing: '.05em', marginBottom: 7 }}>CHILLING</div>
                  {chilling.map((m) => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '3px 0' }} title={m.description}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#8fc3dd', flex: 'none' }} />
                      <span style={{ font: "500 13px 'Geist'", color: '#41464d' }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {cooking.length > 0 && (
                <div>
                  <div style={{ font: "600 11px 'Geist'", color: '#b07d1e', letterSpacing: '.05em', marginBottom: 7 }}>COOKING</div>
                  {cooking.map((m) => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '3px 0' }} title={m.description}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#e7c79a', flex: 'none' }} />
                      <span style={{ font: "500 13px 'Geist'", color: '#41464d' }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* extra care */}
          {recipe.extra_care_flags && recipe.extra_care_flags.length > 0 && (
            <div style={{ background: '#fbf3e6', border: '1px solid #f2e2c4', borderRadius: 16, padding: 17 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <AlertTriangle className="h-[15px] w-[15px]" strokeWidth={2} style={{ color: '#b07d1e' }} />
                <span style={{ font: "700 13px 'Geist'", color: '#8a6a1f' }}>Extra care required</span>
              </div>
              {recipe.extra_care_flags.map((f: string) => (
                <div key={f} style={{ font: "500 12.5px 'Geist'", color: '#8a6a1f', lineHeight: 1.55, marginTop: 4 }}>
                  <strong style={{ fontWeight: 700 }}>{EXTRA_CARE_LABELS[f] ?? f}.</strong> {EXTRA_CARE_NOTE[f] ?? 'Handle with extra care.'}
                </div>
              ))}
            </div>
          )}

          {lastEdited && <div style={{ font: "400 12px 'Geist'", color: '#9aa0a8', padding: '0 2px' }}>Last edited {lastEdited} ago</div>}
        </div>
      </div>
    </div>
  )
}
