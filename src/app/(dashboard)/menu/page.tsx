'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Download, Plus, X, ChevronDown, FileSpreadsheet, FileText, Search, ShieldCheck, PencilLine, Check } from 'lucide-react'
import { EU_ALLERGENS } from '@/lib/constants'
import { DIETARY_FLAGS, effectiveDietary } from '@/lib/dietary'
import { DISH_CATS, catLabel, catSlug, resolveAllergens, recipeAllergens, allergenLabel, sourceMeta, type Dish, type DishRecipe } from '@/lib/dishes'

const RECIPE_SELECT = 'id, name, category, vegan_override, vegetarian_override, gluten_free_override, dairy_free_override, recipe_ingredients(ingredient:ingredients(name, allergens))'
const DISH_SELECT = `id, name, category, active, allergen_source, recipe_id, declared_allergens, may_contain, dietary, attested_by_name, attested_at, recipe:recipes(${RECIPE_SELECT})`

type RecipeRow = DishRecipe & { category: string | null; vegan_override: boolean | null; vegetarian_override: boolean | null; gluten_free_override: boolean | null; dairy_free_override: boolean | null }

/**
 * Dietary for a recipe-backed dish stays live: derived from the recipe's
 * current ingredients (honouring its overrides). Declared dishes keep exactly
 * what the attester ticked.
 */
function dishDietary(d: Dish): string[] {
  if (d.allergen_source !== 'recipe') return d.dietary
  const r = d.recipe as RecipeRow | null | undefined
  return effectiveDietary(r ?? null, resolveAllergens(d))
}

export default function MenuPage() {
  const qc = useQueryClient()
  const business = useAuthStore((s) => s.business)
  const bid = business?.id

  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('All')
  const [srcFilter, setSrcFilter] = useState<'recipe' | 'manual' | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const { data: dishes = [], isLoading } = useQuery({
    queryKey: ['dishes', bid],
    enabled: !!bid,
    queryFn: async () => {
      const { data, error } = await supabase.from('menu_items').select(DISH_SELECT).eq('business_id', bid!).order('display_order')
      if (error) throw error
      return (data ?? []) as unknown as Dish[]
    },
  })

  const { data: recipes = [] } = useQuery({
    queryKey: ['menu-all-recipes', bid],
    enabled: !!bid,
    queryFn: async () => {
      const { data } = await supabase.from('recipes').select(RECIPE_SELECT).eq('business_id', bid!).order('name')
      return (data ?? []) as unknown as RecipeRow[]
    },
  })

  const rows = useMemo(() => dishes.map((d) => ({
    dish: d,
    name: d.name,
    group: catLabel(d.category),
    fromRecipe: d.allergen_source === 'recipe',
    meta: sourceMeta(d),
    allergens: resolveAllergens(d),
    dietary: dishDietary(d),
  })), [dishes])

  const recipeCount = dishes.filter((d) => d.allergen_source === 'recipe').length
  const manualCount = dishes.filter((d) => d.allergen_source === 'manual').length

  const shown = rows.filter((r) => {
    if (cat !== 'All' && r.group !== cat) return false
    if (srcFilter && r.dish.allergen_source !== srcFilter) return false
    if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })
  const sections = DISH_CATS.map((c) => ({ name: c, rows: shown.filter((r) => r.group === c) })).filter((s) => s.rows.length)

  function exportCSV() {
    const out = [['Dish', 'Category', 'Allergen source', 'Attested by', 'Allergens', 'Dietary']]
    rows.forEach((r) => out.push([
      r.name, r.group,
      r.fromRecipe ? `From recipe: ${r.dish.recipe?.name ?? ''}` : 'Declared by hand',
      r.fromRecipe ? '' : `${r.dish.attested_by_name ?? ''}${r.dish.attested_at ? ` (${new Date(r.dish.attested_at).toLocaleDateString('en-GB')})` : ''}`,
      r.allergens.map(allergenLabel).join('; '), r.dietary.join('; '),
    ]))
    const csv = out.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'menu.csv'; a.click(); URL.revokeObjectURL(url)
    setExportOpen(false); toast.success('CSV downloaded')
  }

  function exportPDF() {
    setExportOpen(false)
    const esc = (s: string) => String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]!))
    const byGroup = DISH_CATS.map((g) => ({ g, items: rows.filter((r) => r.group === g) })).filter((x) => x.items.length)
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Allergen menu</title><style>@page{margin:16mm}body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#16181d}h1{font-size:22px}h2{font-size:14px;margin:18px 0 8px;color:#1f7a52}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:7px 8px;border-bottom:1px solid #eee;font-size:12px}th{color:#8a9099;text-transform:uppercase;font-size:10px;letter-spacing:.05em}.a{color:#a1493f}.s{font-size:10px;color:#8a9099}</style></head><body><h1>${esc(business?.name ?? 'Menu')} · Allergen menu</h1>${byGroup.map((x) => `<h2>${x.g}</h2><table><thead><tr><th>Dish</th><th>Allergens</th><th>Source</th></tr></thead><tbody>${x.items.map((d) => `<tr><td>${esc(d.name)}</td><td class="a">${d.allergens.length ? d.allergens.map((a) => esc(allergenLabel(a))).join(', ') : 'None declared'}</td><td class="s">${esc(d.meta)}</td></tr>`).join('')}</tbody></table>`).join('')}</body></html>`
    const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 300) }
    toast.success('Print-ready menu opened')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: '-.02em' }}>Menu</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: '#6b7280' }}>Every dish and where its allergen information comes from.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div ref={exportRef} style={{ position: 'relative' }}>
            <button onClick={() => setExportOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e2e4e8', color: '#41464d', font: "600 13.5px 'Geist'", padding: '10px 15px', borderRadius: 10, cursor: 'pointer' }}>
              <Download className="h-4 w-4" strokeWidth={1.8} /> Export <ChevronDown className="h-3.5 w-3.5" style={{ color: '#9aa0a8' }} strokeWidth={1.8} />
            </button>
            {exportOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 250, background: '#fff', border: '1px solid #e5e7ea', borderRadius: 13, boxShadow: '0 4px 8px rgba(16,24,40,.06),0 18px 44px -18px rgba(16,24,40,.28)', padding: 6, zIndex: 30 }}>
                <ExportOpt icon={<FileSpreadsheet className="h-4 w-4" />} bg="#eef4f0" fg="#1f7a52" title="CSV spreadsheet" sub="Dishes, source, allergens & dietary" onClick={exportCSV} />
                <ExportOpt icon={<FileText className="h-4 w-4" />} bg="#f1f0f4" fg="#6b6580" title="Print-ready PDF" sub="Allergen menu for front of house" onClick={exportPDF} />
              </div>
            )}
          </div>
          <button onClick={() => setAddOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1f9d63', border: 'none', color: '#fff', font: "600 13.5px 'Geist'", padding: '10px 16px', borderRadius: 10, cursor: 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#1c8e5a')} onMouseLeave={(e) => (e.currentTarget.style.background = '#1f9d63')}>
            <Plus className="h-[15px] w-[15px]" strokeWidth={2.4} /> New dish
          </button>
        </div>
      </div>

      {/* allergen source summary — each card is a filter */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 760 }}>
        <SourceCard on={srcFilter === 'recipe'} onClick={() => setSrcFilter((s) => (s === 'recipe' ? null : 'recipe'))}
          icon={<ShieldCheck className="h-[17px] w-[17px]" strokeWidth={1.9} />} iconBg="#eaf4ee" iconFg="#1f7a52"
          onBg="#f5faf7" onBorder="#1f9d63" count={recipeCount} label="from recipes" sub="Allergens traced from ingredients" />
        <SourceCard on={srcFilter === 'manual'} onClick={() => setSrcFilter((s) => (s === 'manual' ? null : 'manual'))}
          icon={<PencilLine className="h-4 w-4" strokeWidth={1.9} />} iconBg="#fbf1e1" iconFg="#b07d1e"
          onBg="#fbf7ee" onBorder="#d98a1a" count={manualCount} label="declared by hand" sub="Drinks & bought-in — signed by a team member" />
      </div>

      {/* controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220, maxWidth: 360, position: 'relative' }}>
          <Search className="h-4 w-4" strokeWidth={1.8} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#9aa0a8' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search dishes…"
            style={{ width: '100%', border: '1px solid #e7e9ec', background: '#fff', borderRadius: 10, padding: '10px 12px 10px 38px', font: "500 13.5px 'Geist'", color: '#16181d', outline: 'none' }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.1)' }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#e7e9ec'; e.currentTarget.style.boxShadow = 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: 3, background: '#eceef1', padding: 4, borderRadius: 11 }}>
          {['All', ...DISH_CATS].map((c) => {
            const on = cat === c
            return (
              <button key={c} onClick={() => setCat(c)}
                style={{ border: 'none', cursor: 'pointer', background: on ? '#fff' : 'none', color: on ? '#1c1f24' : '#5c626b', font: "600 13px 'Geist'", padding: '7px 13px', borderRadius: 8, whiteSpace: 'nowrap', boxShadow: on ? '0 1px 2px rgba(16,24,40,.08)' : 'none' }}>{c}</button>
            )
          })}
        </div>
        <span style={{ marginLeft: 'auto', font: "500 12.5px 'Geist'", color: '#9aa0a8', whiteSpace: 'nowrap' }}>{shown.length} of {dishes.length} dishes</span>
      </div>

      {/* table */}
      <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -30px rgba(16,24,40,.16)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 820 }}>
            <div style={{ ...GRID, padding: '12px 22px', borderBottom: '1px solid #eef0f2', background: '#fbfbfc' }}>
              {['Dish', 'Allergen source', 'Allergens', 'Dietary'].map((h) => (
                <div key={h} style={{ font: "600 10.5px 'Geist'", letterSpacing: '.06em', textTransform: 'uppercase', color: '#9aa0a8' }}>{h}</div>
              ))}
            </div>

            {isLoading ? (
              <div style={{ padding: 44, textAlign: 'center', color: '#9aa0a8', font: "500 14px 'Geist'" }}>Loading…</div>
            ) : sections.length === 0 ? (
              <div style={{ padding: 44, textAlign: 'center', color: '#9aa0a8', font: "500 14px 'Geist'" }}>{dishes.length === 0 ? 'No dishes on the menu yet.' : 'No dishes match.'}</div>
            ) : sections.map((sec) => (
              <div key={sec.name}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 22px', background: '#f8f9fa', borderBottom: '1px solid #eef0f2' }}>
                  <span style={{ font: "600 10.5px 'Geist'", letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a9099' }}>{sec.name}</span>
                  <span style={{ font: "600 10.5px 'Geist'", color: '#b8bdc4', background: '#eceef1', borderRadius: 10, padding: '1px 7px' }}>{sec.rows.length}</span>
                </div>
                {sec.rows.map((r) => (
                  <div key={r.dish.id} style={{ ...GRID, alignItems: 'center', padding: '13px 22px', borderBottom: '1px solid #f4f5f6', transition: 'background .14s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: "600 14px 'Geist'", color: '#1c1f24', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                      <div style={{ font: "500 12px 'Geist'", color: '#a3a8b0', marginTop: 2 }}>{r.meta}</div>
                    </div>
                    <div>
                      {r.fromRecipe ? (
                        <span title="Allergens derived from the linked recipe's ingredients" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: "600 11.5px 'Geist'", padding: '5px 10px', borderRadius: 8, background: '#eaf4ee', color: '#1f7a52', whiteSpace: 'nowrap' }}>
                          <ShieldCheck className="h-3 w-3" strokeWidth={2} /> From recipe
                        </span>
                      ) : (
                        <span title="Manually declared — attested but not traceable to ingredients" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: "600 11.5px 'Geist'", padding: '5px 10px', borderRadius: 8, background: '#fbf1e1', color: '#b07d1e', whiteSpace: 'nowrap' }}>
                          <PencilLine className="h-3 w-3" strokeWidth={2} /> Declared
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      {r.allergens.length === 0 ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: "600 12px 'Geist'", color: '#5c7568' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1f9d63' }} /> None declared
                        </span>
                      ) : r.allergens.map((a) => (
                        <span key={a} style={{ font: "600 11.5px 'Geist'", padding: '4px 9px', borderRadius: 7, background: '#fbeae7', color: '#c0503f', whiteSpace: 'nowrap' }}>{allergenLabel(a)}</span>
                      ))}
                      {r.dish.may_contain.length > 0 && (
                        <span title={`May contain: ${r.dish.may_contain.map(allergenLabel).join(', ')}`} style={{ font: "600 11.5px 'Geist'", padding: '4px 9px', borderRadius: 7, background: '#fdf6ec', color: '#b07d1e', border: '1px dashed #e8cfa3', whiteSpace: 'nowrap' }}>
                          May contain: {r.dish.may_contain.map(allergenLabel).join(', ')}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {r.dietary.map((v) => (
                        <span key={v} style={{ font: "600 11.5px 'Geist'", padding: '4px 9px', borderRadius: 7, background: '#e9f6ef', color: '#1f7a52', whiteSpace: 'nowrap' }}>{v}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {addOpen && <AddDishDrawer bid={bid!} recipes={recipes} onClose={() => setAddOpen(false)} onAdded={() => qc.invalidateQueries({ queryKey: ['dishes', bid] })} />}
    </div>
  )
}

const GRID: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(220px,2.2fr) 150px minmax(200px,2.4fr) minmax(150px,1.4fr)', gap: 16 }

function SourceCard({ on, onClick, icon, iconBg, iconFg, onBg, onBorder, count, label, sub }: { on: boolean; onClick: () => void; icon: React.ReactNode; iconBg: string; iconFg: string; onBg: string; onBorder: string; count: number; label: string; sub: string }) {
  return (
    <button onClick={onClick}
      style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 13, background: on ? onBg : '#fff', border: on ? `1.5px solid ${onBorder}` : '1px solid #e9eaed', borderRadius: 13, padding: on ? '12.5px 15.5px' : '13px 16px', cursor: 'pointer', boxShadow: on ? 'none' : '0 1px 2px rgba(16,24,40,.03)' }}>
      <span style={{ width: 34, height: 34, borderRadius: 10, background: iconBg, color: iconFg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', font: "700 14px 'Geist'", color: '#16181d' }}>{count} {label}</span>
        <span style={{ display: 'block', font: "400 12px 'Geist'", color: '#6b7280', marginTop: 2 }}>{sub}</span>
      </span>
    </button>
  )
}

function ExportOpt({ icon, bg, fg, title, sub, onClick }: { icon: React.ReactNode; bg: string; fg: string; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', border: 'none', background: 'none', padding: 8, borderRadius: 9, cursor: 'pointer', textAlign: 'left' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#f7f8f9')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
      <span style={{ width: 32, height: 32, borderRadius: 9, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{icon}</span>
      <span><span style={{ display: 'block', font: "600 13.5px 'Geist'", color: '#16181d' }}>{title}</span><span style={{ display: 'block', font: "400 12px 'Geist'", color: '#9aa0a8', marginTop: 1 }}>{sub}</span></span>
    </button>
  )
}

// ── New dish drawer ─────────────────────────────────────────────────
function AddDishDrawer({ bid, recipes, onClose, onAdded }: { bid: string; recipes: RecipeRow[]; onClose: () => void; onAdded: () => void }) {
  const profile = useAuthStore((s) => s.profile)
  const [shown, setShown] = useState(false)
  const [mode, setMode] = useState<'recipe' | 'manual'>('recipe')
  const [rQuery, setRQuery] = useState('')
  const [rSel, setRSel] = useState<string | null>(null)
  const [qName, setQName] = useState('')
  const [qCat, setQCat] = useState<string>('Other')
  const [qAllergens, setQAllergens] = useState<Set<string>>(new Set())
  const [qDietary, setQDietary] = useState<Set<string>>(new Set())
  const [attest, setAttest] = useState(false)

  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t) }, [])
  function close() { setShown(false); setTimeout(onClose, 240) }

  const opts = recipes.filter((r) => !rQuery || r.name.toLowerCase().includes(rQuery.toLowerCase()))
  const selected = recipes.find((r) => r.id === rSel) ?? null
  const selAllergens = selected ? recipeAllergens(selected) : []

  const canAdd = mode === 'recipe' ? !!rSel : qName.trim().length > 0 && attest

  const add = useMutation({
    mutationFn: async () => {
      if (mode === 'recipe') {
        const r = recipes.find((x) => x.id === rSel)!
        const { error } = await supabase.from('menu_items').insert({
          business_id: bid, name: r.name, category: catSlug(catLabel(r.category)),
          recipe_id: r.id, allergen_source: 'recipe', active: true, display_order: 0,
        })
        if (error) throw error
        return r.name
      }
      // The attestation is the due-diligence record: without a name and date the
      // DB check constraint rejects the row, so never let it be implicit.
      const { error } = await supabase.from('menu_items').insert({
        business_id: bid, name: qName.trim(), category: catSlug(qCat),
        allergen_source: 'manual',
        declared_allergens: EU_ALLERGENS.filter((a) => qAllergens.has(a)),
        dietary: DIETARY_FLAGS.filter((f) => qDietary.has(f.label)).map((f) => f.label),
        attested_by: profile?.id ?? null,
        attested_by_name: profile?.full_name ?? profile?.email ?? 'Unknown',
        attested_at: new Date().toISOString(),
        active: true, display_order: 0,
      })
      if (error) throw error
      return qName.trim()
    },
    onSuccess: (name) => { onAdded(); toast.success(`${name} added to the menu`); close() },
    onError: (e: Error) => toast.error(e.message),
  })

  const label: React.CSSProperties = { font: "600 12.5px 'Geist'", color: '#41464d', display: 'block', marginBottom: 7 }

  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(20,22,27,.4)', zIndex: 60, display: 'flex', justifyContent: 'flex-end', opacity: shown ? 1 : 0, transition: 'opacity .24s ease-out' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 500, maxWidth: '96vw', height: '100%', background: '#fff', boxShadow: '-24px 0 64px -32px rgba(16,24,40,.45)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: shown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .24s cubic-bezier(.22,.61,.36,1)' }}>
        <div style={{ padding: '22px 24px 16px', borderBottom: '1px solid #eef0f2', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-.01em' }}>New dish</h2>
            <div style={{ fontSize: 13, color: '#8a9099', marginTop: 3 }}>Add it to the menu — from a recipe, or declare a quick dish.</div>
          </div>
          <button onClick={close} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: '#f1f2f4', color: '#5c626b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#e7e9ec')} onMouseLeave={(e) => (e.currentTarget.style.background = '#f1f2f4')}>
            <X className="h-[17px] w-[17px]" strokeWidth={2} />
          </button>
        </div>

        <div style={{ padding: '16px 24px 4px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <ModeCard on={mode === 'recipe'} onClick={() => setMode('recipe')} icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.9} />}
              title="From a recipe" sub="Allergens auto-filled & traceable" onBorder="#1f9d63" onBg="#f5faf7" onFg="#1a6e49" onSubFg="#5c7568" />
            <ModeCard on={mode === 'manual'} onClick={() => setMode('manual')} icon={<PencilLine className="h-4 w-4" strokeWidth={1.9} />}
              title="Quick dish" sub="Declare allergens by hand" onBorder="#d98a1a" onBg="#fbf7ee" onFg="#b07d1e" onSubFg="#a5813e" />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 8px' }}>
          {mode === 'recipe' ? (
            <>
              <div style={{ position: 'relative', marginBottom: 12 }}>
                <Search className="h-[15px] w-[15px]" strokeWidth={1.8} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9aa0a8' }} />
                <input value={rQuery} onChange={(e) => setRQuery(e.target.value)} placeholder="Search recipes…"
                  style={{ width: '100%', border: '1px solid #e2e4e8', borderRadius: 10, padding: '10px 12px 10px 36px', font: "500 13.5px 'Geist'", outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {opts.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#9aa0a8', fontSize: 13 }}>No recipes match.</div>}
                {opts.map((r) => {
                  const on = rSel === r.id
                  const al = recipeAllergens(r)
                  return (
                    <button key={r.id} onClick={() => setRSel(r.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: `1.5px solid ${on ? '#1f9d63' : '#e9eaed'}`, background: on ? '#f5faf7' : '#fff', borderRadius: 12, padding: '12px 14px', cursor: 'pointer' }}>
                      <span style={{ width: 34, height: 34, borderRadius: 9, background: '#f1f2f4', color: '#8a9099', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11h16" /><path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="4" x2="12" y2="7" /></svg>
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', font: "600 13.5px 'Geist'", color: '#1c1f24' }}>{r.name}</span>
                        <span style={{ display: 'block', font: "500 11.5px 'Geist'", color: '#9aa0a8', marginTop: 2 }}>{catLabel(r.category)} · {al.length ? `${al.length} allergens` : 'No allergens'}</span>
                      </span>
                      {on && <span style={{ color: '#1f9d63', display: 'flex' }}><Check className="h-[18px] w-[18px]" strokeWidth={2.4} /></span>}
                    </button>
                  )
                })}
              </div>
              {selected && (
                <div style={{ marginTop: 16, background: '#f5faf7', border: '1px solid #cfe8db', borderRadius: 12, padding: 14 }}>
                  <div style={{ font: "600 11px 'Geist'", letterSpacing: '.05em', textTransform: 'uppercase', color: '#1f7a52', marginBottom: 9 }}>Auto-filled from recipe · traceable</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {selAllergens.length === 0 ? <span style={{ font: "600 12px 'Geist'", color: '#5c7568' }}>No allergens in this recipe</span>
                      : selAllergens.map((a) => <span key={a} style={{ font: "600 11.5px 'Geist'", padding: '4px 9px', borderRadius: 7, background: '#fbeae7', color: '#c0503f' }}>{allergenLabel(a)}</span>)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={label}>Dish name <span style={{ color: '#d2453f' }}>*</span></label>
                <input autoFocus value={qName} onChange={(e) => setQName(e.target.value)} placeholder="e.g. House lemonade"
                  style={{ width: '100%', border: '1px solid #e2e4e8', borderRadius: 10, padding: '11px 13px', font: "500 14px 'Geist'", outline: 'none' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#1f9d63'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,157,99,.1)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e4e8'; e.currentTarget.style.boxShadow = 'none' }} />
              </div>
              <div>
                <label style={label}>Category</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {DISH_CATS.map((c) => {
                    const on = qCat === c
                    return <button key={c} onClick={() => setQCat(c)} style={{ border: on ? '1.5px solid #1f9d63' : '1px solid #e2e4e8', background: on ? '#f5faf7' : '#fff', color: on ? '#1a6e49' : '#5c626b', font: "600 12.5px 'Geist'", padding: '7px 13px', borderRadius: 9, cursor: 'pointer' }}>{c}</button>
                  })}
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ font: "600 12.5px 'Geist'", color: '#41464d' }}>Allergens present</label>
                  <button onClick={() => setQAllergens(new Set())} style={{ border: 'none', background: 'none', color: '#1f7a52', font: "600 12px 'Geist'", cursor: 'pointer', padding: 0 }}>Mark none</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {EU_ALLERGENS.map((a) => {
                    const on = qAllergens.has(a)
                    return (
                      <button key={a} onClick={() => setQAllergens((s) => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n })}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: on ? '1.5px solid #e0a99b' : '1px solid #e2e4e8', background: on ? '#fbeae7' : '#fff', color: on ? '#c0503f' : '#5c626b', font: "600 12.5px 'Geist'", padding: '7px 11px', borderRadius: 9, cursor: 'pointer' }}>
                        {on && <Check className="h-3 w-3" strokeWidth={3} />}{allergenLabel(a)}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label style={label}>Dietary</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {DIETARY_FLAGS.map((f) => {
                    const on = qDietary.has(f.label)
                    return (
                      <button key={f.label} onClick={() => setQDietary((s) => { const n = new Set(s); if (n.has(f.label)) n.delete(f.label); else n.add(f.label); return n })}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: on ? '1.5px solid #9dcbb4' : '1px solid #e2e4e8', background: on ? '#e9f6ef' : '#fff', color: on ? '#1f7a52' : '#5c626b', font: "600 12.5px 'Geist'", padding: '7px 11px', borderRadius: 9, cursor: 'pointer' }}>
                        {on && <Check className="h-3 w-3" strokeWidth={3} />}{f.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div onClick={() => setAttest((v) => !v)} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, background: '#fbf7ee', border: '1px solid #f2e6cf', borderRadius: 12, padding: '13px 14px', cursor: 'pointer' }}>
                {attest ? (
                  <span style={{ width: 20, height: 20, borderRadius: 6, background: '#1f9d63', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', marginTop: 1 }}>
                    <Check className="h-3 w-3" style={{ color: '#fff' }} strokeWidth={3.2} />
                  </span>
                ) : <span style={{ width: 20, height: 20, borderRadius: 6, border: '1.8px solid #d4b483', background: '#fff', flex: 'none', marginTop: 1 }} />}
                <span style={{ font: "500 12.5px/1.5 'Geist'", color: '#8a6a2e' }}>
                  I confirm these allergens are accurate for this dish. <b style={{ fontWeight: 600 }}>Required</b> for menu &amp; EHO — recorded against your name and today&apos;s date.
                </span>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #eef0f2', display: 'flex', gap: 10 }}>
          <button onClick={close} style={{ flex: 1, background: '#fff', border: '1px solid #e2e4e8', color: '#5c626b', font: "600 13.5px 'Geist'", padding: 12, borderRadius: 11, cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f4f5f6')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>Cancel</button>
          <button onClick={() => add.mutate()} disabled={!canAdd || add.isPending}
            style={{ flex: 1.5, background: canAdd ? '#1f9d63' : '#cfe6da', border: 'none', color: canAdd ? '#fff' : '#8fb9a4', font: "600 13.5px 'Geist'", padding: 12, borderRadius: 11, cursor: canAdd ? 'pointer' : 'not-allowed' }}>
            {add.isPending ? 'Adding…' : mode === 'recipe' ? 'Add to menu' : 'Declare & add'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModeCard({ on, onClick, icon, title, sub, onBorder, onBg, onFg, onSubFg }: { on: boolean; onClick: () => void; icon: React.ReactNode; title: string; sub: string; onBorder: string; onBg: string; onFg: string; onSubFg: string }) {
  return (
    <button onClick={onClick} style={{ textAlign: 'left', border: on ? `1.5px solid ${onBorder}` : '1px solid #e2e4e8', background: on ? onBg : '#fff', borderRadius: 13, padding: on ? '12.5px 13.5px' : '13px 14px', cursor: 'pointer' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: "700 13.5px 'Geist'", color: on ? onFg : '#41464d' }}>{icon}{title}</span>
      <span style={{ display: 'block', font: "500 11.5px/1.4 'Geist'", color: on ? onSubFg : '#9aa0a8', marginTop: 5 }}>{sub}</span>
    </button>
  )
}
