'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import {
  Search, Download, Printer, LayoutGrid, Table2, Check, AlertTriangle,
  ArrowUpDown,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  EU_ALLERGENS,
  ALLERGEN_LABELS,
  RECIPE_CATEGORY_LABELS,
  type EUAllergen,
} from '@/lib/constants'

type ViewMode = 'card' | 'matrix'
type SortKey = 'name' | 'category' | 'allergen_count'

function getAllergens(recipe: any): string[] {
  const set = new Set<string>()
  recipe.recipe_ingredients?.forEach((ri: any) => {
    ri.ingredient?.allergens?.forEach((a: string) => set.add(a))
  })
  return Array.from(set)
}

export default function AllergensPage() {
  const business = useAuthStore((s) => s.business)

  const [view, setView] = useState<ViewMode>('matrix')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ['allergen-recipes', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('recipes')
        .select(`
          *,
          recipe_ingredients (
            ingredient:ingredients (name, allergens)
          )
        `)
        .eq('business_id', business.id)
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const enriched = useMemo(
    () =>
      recipes.map((r: any) => ({
        ...r,
        _allergens: getAllergens(r),
      })),
    [recipes]
  )

  const filtered = useMemo(() => {
    let list = enriched.filter(
      (r: any) => !search || r.name.toLowerCase().includes(search.toLowerCase())
    )
    list.sort((a: any, b: any) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      if (sortKey === 'category') return (a.category ?? '').localeCompare(b.category ?? '')
      return b._allergens.length - a._allergens.length
    })
    return list
  }, [enriched, search, sortKey])

  // Group by category for card view
  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {}
    filtered.forEach((r: any) => {
      const cat = r.category ?? 'other'
      if (!map[cat]) map[cat] = []
      map[cat].push(r)
    })
    return map
  }, [filtered])

  function exportCSV() {
    const header = ['Recipe', 'Category', ...EU_ALLERGENS.map((a) => ALLERGEN_LABELS[a])]
    const rows = filtered.map((r: any) => [
      r.name,
      RECIPE_CATEGORY_LABELS[r.category] ?? r.category,
      ...EU_ALLERGENS.map((a) => (r._allergens.includes(a) ? 'Y' : '')),
    ])
    const csv = [header, ...rows].map((row) => row.map((c: string) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'allergen-matrix.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handlePrint() {
    let html = `<!DOCTYPE html><html><head><title>${business?.name ?? 'Blueroll'} — Allergen Matrix</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 10px; color: #1a1a1a; padding: 16px; }
      h1 { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
      .subtitle { font-size: 10px; color: #6b7280; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th { font-size: 8px; text-transform: uppercase; letter-spacing: 0.3px; color: #6b7280; padding: 4px 3px; border-bottom: 2px solid #e5e7eb; text-align: center; }
      th:first-child { text-align: left; min-width: 120px; }
      td { padding: 4px 3px; border-bottom: 1px solid #f3f4f6; text-align: center; font-size: 10px; }
      td:first-child { text-align: left; font-weight: 500; }
      .yes { background: #fef2f2; color: #b91c1c; font-weight: 700; font-size: 11px; }
      .cat-row td { background: #f9fafb; font-weight: 600; font-size: 10px; color: #047857; text-align: left; padding: 6px 3px; border-bottom: 1px solid #d1d5db; }
      .footer { margin-top: 16px; font-size: 8px; color: #9ca3af; text-align: center; }
      @media print { body { padding: 8px; } @page { size: landscape; margin: 10mm; } }
    </style></head><body>`

    html += `<h1>${business?.name ?? 'Allergen Matrix'}</h1>`
    html += `<div class="subtitle">${filtered.length} recipes · 14 EU allergens · Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>`

    html += `<table><tr><th>Recipe</th>`
    EU_ALLERGENS.forEach((a) => { html += `<th>${ALLERGEN_LABELS[a].substring(0, 5)}</th>` })
    html += `</tr>`

    const categoryOrder = ['starter','main','dessert','side','sauce','drink','cocktail','beverage','other']
    const sortedCats = Object.keys(grouped).sort((a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b))

    for (const cat of sortedCats) {
      const items = grouped[cat]
      html += `<tr class="cat-row"><td colspan="${EU_ALLERGENS.length + 1}">${RECIPE_CATEGORY_LABELS[cat] ?? cat} (${items.length})</td></tr>`
      for (const r of items) {
        html += `<tr><td>${r.name}</td>`
        EU_ALLERGENS.forEach((a) => {
          html += r._allergens.includes(a) ? `<td class="yes">✓</td>` : `<td>—</td>`
        })
        html += `</tr>`
      }
    }
    html += `</table>`
    html += `<div class="footer">Generated by Blueroll · blueroll.app</div></body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Allergen Matrix" description="EU 14 allergens across all active recipes">
        <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          CSV
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
          <Printer className="h-3.5 w-3.5" />
          PDF
        </Button>
      </PageHeader>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search recipes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 text-[13px]"
          />
        </div>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="h-9 rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none"
        >
          <option value="name">Sort by Name</option>
          <option value="category">Sort by Category</option>
          <option value="allergen_count">Sort by Allergen Count</option>
        </select>
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          <button
            onClick={() => setView('card')}
            className={`rounded p-1.5 transition-colors ${
              view === 'card' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView('matrix')}
            className={`rounded p-1.5 transition-colors ${
              view === 'matrix' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Table2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">
          Loading allergen data...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No active recipes"
          description={search ? 'Try adjusting your search' : 'Activate recipes to see allergen data'}
        />
      ) : view === 'matrix' ? (
        /* ── Matrix View ── */
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="sticky left-0 bg-muted/50 px-4 py-2.5 text-left font-medium text-muted-foreground min-w-[200px]">
                  Recipe
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[100px]">
                  Category
                </th>
                {EU_ALLERGENS.map((a) => (
                  <th
                    key={a}
                    className="px-1 py-2.5 text-center font-medium text-muted-foreground min-w-[60px]"
                  >
                    <span className="text-[10px] leading-tight block">
                      {ALLERGEN_LABELS[a]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((recipe: any) => (
                <tr key={recipe.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="sticky left-0 bg-background px-4 py-2.5 font-medium text-foreground">
                    {recipe.name}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {RECIPE_CATEGORY_LABELS[recipe.category] ?? recipe.category}
                  </td>
                  {EU_ALLERGENS.map((a) => (
                    <td key={a} className="px-1 py-2.5 text-center">
                      {recipe._allergens.includes(a) ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-700">
                          <Check className="h-3 w-3" />
                        </span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Card View ── */
        <div className="space-y-8">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <h2 className="text-[14px] font-semibold text-foreground mb-3">
                {RECIPE_CATEGORY_LABELS[cat] ?? cat}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((recipe: any) => (
                  <div
                    key={recipe.id}
                    className="rounded-lg border border-border p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <h3 className="text-[13px] font-medium text-foreground">{recipe.name}</h3>
                      {recipe._allergens.length > 0 && (
                        <span className="text-[11px] font-medium text-red-600 bg-red-50 rounded-full px-2 py-0.5 border border-red-200">
                          {recipe._allergens.length} allergen{recipe._allergens.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {recipe._allergens.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {recipe._allergens.map((a: string) => (
                          <span
                            key={a}
                            className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 border border-red-200"
                          >
                            {ALLERGEN_LABELS[a as EUAllergen] ?? a}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-muted-foreground">No allergens</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
