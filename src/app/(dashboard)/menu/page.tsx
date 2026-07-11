'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Download, Plus, Check, X, ChevronDown, FileSpreadsheet, FileText, Search } from 'lucide-react'

const CAT_MAP: Record<string, string> = { starter: 'Starters', starters: 'Starters', main: 'Mains', mains: 'Mains', side: 'Sides', sides: 'Sides', dessert: 'Desserts', desserts: 'Desserts' }
const CAT_ORDER = ['Starters', 'Mains', 'Sides', 'Desserts', 'Other']
const catLabel = (c: string | null) => CAT_MAP[(c || '').toLowerCase()] ?? 'Other'

const ALLERGEN_LABELS: Record<string, string> = {
  gluten: 'Gluten', crustaceans: 'Crustaceans', eggs: 'Eggs', fish: 'Fish', peanuts: 'Peanuts', soybeans: 'Soya', milk: 'Milk',
  nuts: 'Nuts', celery: 'Celery', mustard: 'Mustard', sesame: 'Sesame', sulphites: 'Sulphites', lupin: 'Lupin', molluscs: 'Molluscs',
}
const DIETARY: [string, (a: string[]) => boolean][] = [
  ['Vegan', (a) => !a.some((x) => ['milk', 'eggs', 'fish', 'crustaceans', 'molluscs'].includes(x))],
  ['Vegetarian', (a) => !a.some((x) => ['fish', 'crustaceans', 'molluscs'].includes(x))],
  ['Gluten-free', (a) => !a.includes('gluten')],
  ['Dairy-free', (a) => !a.includes('milk')],
]
const allergensOf = (recipe: any): string[] => {
  const set = new Set<string>()
  recipe?.recipe_ingredients?.forEach((ri: any) => ri.ingredient?.allergens?.forEach((a: string) => set.add(a)))
  return [...set]
}

export default function MenuPage() {
  const qc = useQueryClient()
  const router = useRouter()
  const business = useAuthStore((s) => s.business)
  const currentSiteId = useAuthStore((s) => s.currentSiteId)
  const sites = useAuthStore((s) => s.sites)
  const bid = business?.id
  const siteLabel = currentSiteId ? (sites.find((s) => s.id === currentSiteId)?.name ?? 'site') : (business?.name ?? 'group')

  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('All')
  const [allergensOnly, setAllergensOnly] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [exportOpen, setExportOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const { data: menuItems = [], isLoading } = useQuery({
    queryKey: ['menu-items', bid],
    enabled: !!bid,
    queryFn: async () => (await supabase.from('menu_items')
      .select('id, category, active, display_order, recipe:recipes(id, name, category, updated_at, recipe_ingredients(ingredient:ingredients(name, allergens)))')
      .eq('business_id', bid!).order('display_order')).data as any[] ?? [],
  })
  const { data: allRecipes = [] } = useQuery({
    queryKey: ['menu-all-recipes', bid],
    enabled: !!bid,
    queryFn: async () => (await supabase.from('recipes').select('id, name, category, recipe_ingredients(ingredient:ingredients(name, allergens))').eq('business_id', bid!).order('name')).data as any[] ?? [],
  })

  const dishes = useMemo(() => (menuItems as any[])
    .filter((m) => m.recipe)
    .map((m) => {
      const al = allergensOf(m.recipe)
      return { id: m.id, name: m.recipe.name, group: catLabel(m.category || m.recipe.category), active: m.active, allergens: al, dietary: DIETARY.filter(([, f]) => f(al)).map(([n]) => n), recipeId: m.recipe.id }
    }), [menuItems])

  const liveCount = dishes.filter((d) => d.active).length
  const withAllergens = dishes.filter((d) => d.active && d.allergens.length).length

  const filtered = dishes.filter((d) => {
    if (cat !== 'All' && d.group !== cat) return false
    if (allergensOnly && d.allergens.length === 0) return false
    if (query && !d.name.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })
  const groups = CAT_ORDER.map((g) => ({ name: g, items: filtered.filter((d) => d.group === g) })).filter((g) => g.items.length)

  async function toggle(id: string, active: boolean) {
    qc.setQueryData(['menu-items', bid], (old: any[]) => (old ?? []).map((m) => (m.id === id ? { ...m, active: !active } : m)))
    const { error } = await supabase.from('menu_items').update({ active: !active }).eq('id', id)
    if (error) { toast.error(error.message); qc.invalidateQueries({ queryKey: ['menu-items', bid] }) }
  }

  function exportCSV() {
    const rows = [['Dish', 'Category', 'Allergens', 'Dietary', 'On menu']]
    dishes.forEach((d) => rows.push([d.name, d.group, d.allergens.map((a) => ALLERGEN_LABELS[a] ?? a).join('; '), d.dietary.join('; '), d.active ? 'Yes' : 'No']))
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'menu.csv'; a.click(); URL.revokeObjectURL(url)
    setExportOpen(false); toast.success('CSV downloaded')
  }
  function exportPDF() {
    setExportOpen(false)
    const live = dishes.filter((d) => d.active)
    const byGroup = CAT_ORDER.map((g) => ({ g, items: live.filter((d) => d.group === g) })).filter((x) => x.items.length)
    const esc = (s: string) => String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]!))
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Allergen menu</title><style>@page{margin:16mm}body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#16181d}h1{font-size:22px}h2{font-size:14px;margin:18px 0 8px;color:#1f7a52}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:7px 8px;border-bottom:1px solid #eee;font-size:12px}th{color:#8a9099;text-transform:uppercase;font-size:10px;letter-spacing:.05em}.a{color:#a1493f}</style></head><body><h1>${esc(business?.name ?? 'Menu')} · Allergen menu</h1>${byGroup.map((x) => `<h2>${x.g}</h2><table><thead><tr><th>Dish</th><th>Allergens</th></tr></thead><tbody>${x.items.map((d) => `<tr><td>${esc(d.name)}</td><td class="a">${d.allergens.length ? d.allergens.map((a) => esc(ALLERGEN_LABELS[a] ?? a)).join(', ') : 'None declared'}</td></tr>`).join('')}</tbody></table>`).join('')}</body></html>`
    const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 300) }
    toast.success('Print-ready menu opened')
  }

  const menuRecipeIds = new Set((menuItems as any[]).map((m) => m.recipe?.id).filter(Boolean))
  const CHIP = (on: boolean): React.CSSProperties => ({ border: on ? 'none' : '1px solid #e5e7ea', cursor: 'pointer' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: "'Geist',system-ui,sans-serif", color: '#16181d' }}>
      {/* head */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.025em' }}>Menu</h1>
          <div style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
            {liveCount} dish{liveCount === 1 ? '' : 'es'} live · {withAllergens} with declared allergens · <button onClick={() => router.push('/allergens')} style={{ border: 'none', background: 'none', color: '#1f7a52', fontWeight: 600, fontSize: 14, cursor: 'pointer', padding: 0 }}>Allergen matrix →</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div ref={exportRef} style={{ position: 'relative' }}>
            <button onClick={() => setExportOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #e2e4e8', color: '#41464d', font: "600 13.5px 'Geist'", padding: '9px 14px', borderRadius: 10, cursor: 'pointer' }}>
              <Download className="h-4 w-4" strokeWidth={1.8} /> Export <ChevronDown className="h-3.5 w-3.5" style={{ color: '#9aa0a8' }} strokeWidth={1.8} />
            </button>
            {exportOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 250, background: '#fff', border: '1px solid #e5e7ea', borderRadius: 13, boxShadow: '0 4px 8px rgba(16,24,40,.06),0 18px 44px -18px rgba(16,24,40,.28)', padding: 6, zIndex: 30 }}>
                <ExportOpt icon={<FileSpreadsheet className="h-4 w-4" />} bg="#eef4f0" fg="#1f7a52" title="CSV spreadsheet" sub="Dishes, allergens & dietary tags" onClick={exportCSV} />
                <ExportOpt icon={<FileText className="h-4 w-4" />} bg="#f1f0f4" fg="#6b6580" title="Print-ready PDF" sub="Allergen menu for front of house" onClick={exportPDF} />
              </div>
            )}
          </div>
          <button onClick={() => setModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#1f9d63', border: 'none', color: '#fff', font: "600 14px 'Geist'", padding: '9px 15px', borderRadius: 10, cursor: 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#1a8a56')} onMouseLeave={(e) => (e.currentTarget.style.background = '#1f9d63')}>
            <Plus className="h-4 w-4" strokeWidth={2} /> Add from recipes
          </button>
        </div>
      </div>

      {/* toolbar */}
      {dishes.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: 260 }}>
            <Search className="h-4 w-4" strokeWidth={1.8} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#9aa0a8' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search dishes…" style={{ width: '100%', border: '1px solid #e5e7ea', borderRadius: 10, padding: '9px 12px 9px 34px', font: "500 13.5px 'Geist'", outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: 0, background: '#fff', border: '1px solid #e5e7ea', borderRadius: 11, padding: 4 }}>
            {['All', ...CAT_ORDER.filter((g) => dishes.some((d) => d.group === g))].map((c) => {
              const on = cat === c
              return <button key={c} onClick={() => setCat(c)} style={{ border: 'none', cursor: 'pointer', font: `${on ? 600 : 500} 13px 'Geist'`, padding: '6px 12px', borderRadius: 8, background: on ? '#16181d' : 'transparent', color: on ? '#fff' : '#6b7280' }}>{c}</button>
            })}
          </div>
          <button onClick={() => setAllergensOnly((v) => !v)} style={{ border: allergensOnly ? '1px solid #e8c8c1' : '1px solid #e5e7ea', background: allergensOnly ? '#fbf0ee' : '#fff', color: allergensOnly ? '#a1493f' : '#6b7280', font: "600 13px 'Geist'", padding: '7px 13px', borderRadius: 20, cursor: 'pointer' }}>With allergens</button>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: '#9aa0a8' }}>{filtered.length} of {dishes.length} dishes</span>
        </div>
      )}

      {/* table */}
      <div style={{ background: '#fff', border: '1px solid #e9eaed', borderRadius: 16, boxShadow: '0 1px 2px rgba(16,24,40,.03),0 14px 36px -28px rgba(16,24,40,.16)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.3fr) minmax(160px,1.4fr) minmax(110px,200px) 70px', gap: 16, padding: '12px 20px', borderBottom: '1px solid #f2f3f5' }}>
          {['Dish', 'Allergens', 'Dietary', 'On menu'].map((h, i) => <span key={h} style={{ font: "600 11.5px 'Geist'", letterSpacing: '.06em', textTransform: 'uppercase', color: '#8a9099', textAlign: i === 3 ? 'right' : 'left' }}>{h}</span>)}
        </div>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9aa0a8', fontSize: 13 }}>Loading…</div>
        ) : dishes.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <div style={{ font: "600 15px 'Geist'", color: '#3c414a' }}>No dishes on the menu yet</div>
            <div style={{ fontSize: 13.5, color: '#8a9099', marginTop: 4 }}>Add dishes from your recipe library.</div>
          </div>
        ) : groups.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <div style={{ font: "600 15px 'Geist'", color: '#3c414a' }}>No dishes match</div>
            <div style={{ fontSize: 13.5, color: '#8a9099', marginTop: 4 }}>Try a different category or clear the filters.</div>
          </div>
        ) : groups.map((g) => (
          <div key={g.name}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fafbfb', borderBottom: '1px solid #f2f3f5', padding: '9px 20px 7px' }}>
              <span style={{ font: "600 11px 'Geist'", letterSpacing: '.06em', textTransform: 'uppercase', color: '#6f7580' }}>{g.name}</span>
              <span style={{ font: "600 11px 'Geist'", color: '#8a9099', background: '#eef0f2', padding: '2px 9px', borderRadius: 20 }}>{g.items.length}</span>
            </div>
            {g.items.map((d) => {
              const showAll = expanded.has(d.id)
              const shown = showAll ? d.allergens : d.allergens.slice(0, 4)
              const extra = d.allergens.length - shown.length
              return (
                <div key={d.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.3fr) minmax(160px,1.4fr) minmax(110px,200px) 70px', gap: 16, padding: '13px 20px', borderBottom: '1px solid #f5f6f7', alignItems: 'center', transition: 'background .14s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#fafbfb')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ font: "600 14.5px 'Geist'", color: d.active ? '#1c1f24' : '#a9aeb5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {d.allergens.length === 0 ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#8a9099' }}><Check className="h-3.5 w-3.5" style={{ color: '#1f9d63' }} strokeWidth={2.4} /> None declared</span>
                    ) : <>
                      {shown.map((a) => <span key={a} style={{ font: "600 12px 'Geist'", color: '#a1493f', background: '#fbf0ee', border: '1px solid #f3ddd9', borderRadius: 7, padding: '3px 9px' }}>{ALLERGEN_LABELS[a] ?? a}</span>)}
                      {extra > 0 && <button onClick={() => setExpanded((s) => { const n = new Set(s); n.add(d.id); return n })} style={{ font: "600 12px 'Geist'", color: '#6b7280', background: '#fff', border: '1px solid #e5e7ea', borderRadius: 7, padding: '3px 9px', cursor: 'pointer' }}>+{extra} more</button>}
                    </>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {d.dietary.map((x) => <span key={x} style={{ font: "600 12px 'Geist'", color: '#1a6e49', background: '#e9f2ec', borderRadius: 7, padding: '3px 9px' }}>{x}</span>)}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => toggle(d.id, d.active)} aria-pressed={d.active} style={{ width: 40, height: 23, borderRadius: 20, border: 'none', background: d.active ? '#1f9d63' : '#d4d7db', position: 'relative', cursor: 'pointer', padding: 0, transition: 'background .15s' }}>
                      <span style={{ position: 'absolute', top: 2.5, left: d.active ? 'auto' : 3, right: d.active ? 3 : 'auto', width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(16,24,40,.2)', transition: 'all .15s' }} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {modalOpen && <AddModal bid={bid!} siteLabel={siteLabel} recipes={allRecipes} menuRecipeIds={menuRecipeIds} onClose={() => setModalOpen(false)} onAdded={() => qc.invalidateQueries({ queryKey: ['menu-items', bid] })} />}
    </div>
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

function AddModal({ bid, siteLabel, recipes, menuRecipeIds, onClose, onAdded }: { bid: string; siteLabel: string; recipes: any[]; menuRecipeIds: Set<string>; onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState('')
  const [added, setAdded] = useState<Set<string>>(new Set())
  const available = recipes.filter((r) => !menuRecipeIds.has(r.id) && !added.has(r.id) && (!q || r.name.toLowerCase().includes(q.toLowerCase())))

  async function add(r: any) {
    setAdded((s) => { const n = new Set(s); n.add(r.id); return n })
    const { error } = await supabase.from('menu_items').insert({ business_id: bid, recipe_id: r.id, category: r.category, active: true, display_order: 0 })
    if (error) { toast.error(error.message); setAdded((s) => { const n = new Set(s); n.delete(r.id); return n }); return }
    toast.success(`${r.name} added to the ${siteLabel} menu`)
    onAdded()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,20,26,.42)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: '100%', maxHeight: '82vh', background: '#fff', borderRadius: 18, boxShadow: '0 24px 70px -20px rgba(16,24,40,.45)', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Geist',system-ui,sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '20px 22px 14px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Add from recipes</h2>
            <div style={{ fontSize: 13, color: '#8a9099', marginTop: 3 }}>Recipes not yet on the {siteLabel} menu. Allergens come from the recipe card.</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 9, border: 'none', background: '#f1f2f4', color: '#5c626b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><X className="h-4 w-4" /></button>
        </div>
        <div style={{ padding: '0 22px 12px' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes…" style={{ width: '100%', border: 'none', background: '#f3f4f6', borderRadius: 10, padding: '10px 13px', font: "500 13.5px 'Geist'", outline: 'none' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px' }}>
          {available.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#9aa0a8', fontSize: 13 }}>{recipes.length === 0 ? 'No recipes in your library yet.' : 'Every recipe is already on the menu.'}</div>
          ) : available.map((r) => {
            const al = allergensOf(r)
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "600 14px 'Geist'", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ fontSize: 12.5, color: '#8a9099', marginTop: 1, textTransform: 'capitalize' }}>{catLabel(r.category)} · {al.length ? al.map((a) => ALLERGEN_LABELS[a] ?? a).join(', ') : 'No allergens declared'}</div>
                </div>
                <button onClick={() => add(r)} style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid #cfe0d6', background: '#fff', color: '#1f7a52', font: "600 12.5px 'Geist'", padding: '7px 12px', borderRadius: 9, cursor: 'pointer', flex: 'none' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#eef4f0')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Add
                </button>
              </div>
            )
          })}
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid #f2f3f5', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#16181d', border: 'none', color: '#fff', font: "600 14px 'Geist'", padding: '10px 20px', borderRadius: 10, cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  )
}
