'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import {
  EU_ALLERGENS,
  ALLERGEN_LABELS,
  ALLERGEN_EMOJI,
  RECIPE_CATEGORY_LABELS,
  type EUAllergen,
} from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  ShieldAlert,
  Download,
  FileDown,
  Search,
  Check,
  Wheat,
  Leaf,
  Milk,
  ArrowUpDown,
} from 'lucide-react'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Allergen helper functions
// ---------------------------------------------------------------------------

type IngredientRow = { allergens: string[] }
type RecipeIngredientWithIngredient = { ingredients: IngredientRow | null }

function collectAllergens(
  recipeIngredients: RecipeIngredientWithIngredient[]
): Set<EUAllergen> {
  const set = new Set<EUAllergen>()
  for (const ri of recipeIngredients) {
    if (ri.ingredients?.allergens) {
      for (const a of ri.ingredients.allergens) {
        if ((EU_ALLERGENS as readonly string[]).includes(a)) {
          set.add(a as EUAllergen)
        }
      }
    }
  }
  return set
}

function isVegetarian(allergens: Set<EUAllergen>): boolean {
  // No fish, crustaceans, or molluscs
  return !allergens.has('fish') && !allergens.has('crustaceans') && !allergens.has('molluscs')
}

function isVegan(allergens: Set<EUAllergen>): boolean {
  // No animal-derived allergens
  return (
    isVegetarian(allergens) &&
    !allergens.has('milk') &&
    !allergens.has('eggs')
  )
}

function isGlutenFree(allergens: Set<EUAllergen>): boolean {
  return !allergens.has('gluten')
}

function isDairyFree(allergens: Set<EUAllergen>): boolean {
  return !allergens.has('milk')
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecipeWithAllergens {
  id: string
  name: string
  category: string
  allergens: Set<EUAllergen>
}

type SortField = 'name' | 'category' | 'allergenCount'
type SortDir = 'asc' | 'desc'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AllergensPage() {
  const { business } = useAuthStore()
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const { data: recipes, isLoading } = useQuery({
    queryKey: ['recipes-with-allergens', business?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select('id, name, category, recipe_ingredients(ingredient_id, ingredients(name, allergens))')
        .eq('business_id', business!.id)
        .eq('active', true)
        .order('name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data as any[]) ?? []
    },
    enabled: !!business?.id,
  })

  // Compute allergen data for each recipe
  const enriched: RecipeWithAllergens[] = useMemo(() => {
    if (!recipes) return []
    return recipes.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      allergens: collectAllergens(
        (r.recipe_ingredients as unknown as RecipeIngredientWithIngredient[]) ?? []
      ),
    }))
  }, [recipes])

  // Filter
  const filtered = useMemo(() => {
    if (!search.trim()) return enriched
    const q = search.toLowerCase()
    return enriched.filter((r) => r.name.toLowerCase().includes(q))
  }, [enriched, search])

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortField === 'category') cmp = a.category.localeCompare(b.category)
      else cmp = a.allergens.size - b.allergens.size
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortField, sortDir])

  // Group by category for card view
  const grouped = useMemo(() => {
    const map = new Map<string, RecipeWithAllergens[]>()
    for (const r of sorted) {
      const list = map.get(r.category) ?? []
      list.push(r)
      map.set(r.category, list)
    }
    return map
  }, [sorted])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  // ---------------------------------------------------------------------------
  // Export CSV
  // ---------------------------------------------------------------------------
  function exportCSV() {
    const header = ['Recipe', 'Category', ...EU_ALLERGENS.map((a) => ALLERGEN_LABELS[a])]
    const rows = sorted.map((r) => [
      `"${r.name}"`,
      r.category,
      ...EU_ALLERGENS.map((a) => (r.allergens.has(a) ? 'Y' : '')),
    ])
    const csv = [header.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'allergen-matrix.csv'
    link.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exported')
  }

  // ---------------------------------------------------------------------------
  // Export PDF (print-based)
  // ---------------------------------------------------------------------------
  function exportPDF() {
    window.print()
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <PageHeader
        title="Allergen Matrix"
        description="Track allergens across all recipes for EU compliance"
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} className="text-[12px]">
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF} className="text-[12px]">
            <Download className="mr-1.5 h-3.5 w-3.5" />
            PDF
          </Button>
        </div>
      </PageHeader>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search recipes..."
          className="pl-8 text-[13px]"
        />
      </div>

      {enriched.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="No recipes found"
          description="Add recipes with ingredients to see the allergen matrix."
        />
      ) : (
        <Tabs defaultValue="matrix">
          <TabsList>
            <TabsTrigger value="matrix">Matrix</TabsTrigger>
            <TabsTrigger value="cards">Cards</TabsTrigger>
          </TabsList>

          {/* ----------------------------------------------------------------- */}
          {/* MATRIX VIEW                                                        */}
          {/* ----------------------------------------------------------------- */}
          <TabsContent value="matrix" className="mt-4">
            <div className="rounded-lg border border-border bg-white">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th
                        className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort('name')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Recipe
                          <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </th>
                      <th
                        className="px-3 py-2.5 text-left text-[12px] font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort('category')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Category
                          <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </th>
                      {EU_ALLERGENS.map((allergen) => (
                        <th
                          key={allergen}
                          className="px-2 py-2.5 text-center text-[11px] font-medium text-muted-foreground"
                          title={ALLERGEN_LABELS[allergen]}
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <span>{ALLERGEN_EMOJI[allergen]}</span>
                            <span className="max-w-[3.5rem] truncate">
                              {ALLERGEN_LABELS[allergen]}
                            </span>
                          </div>
                        </th>
                      ))}
                      <th
                        className="px-3 py-2.5 text-center text-[12px] font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort('allergenCount')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Total
                          <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sorted.map((recipe) => (
                      <tr
                        key={recipe.id}
                        className="transition-colors hover:bg-accent/50"
                      >
                        <td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium">
                          {recipe.name}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground capitalize">
                          {recipe.category}
                        </td>
                        {EU_ALLERGENS.map((allergen) => (
                          <td key={allergen} className="px-2 py-2.5 text-center">
                            {recipe.allergens.has(allergen) ? (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600">
                                <Check className="h-3 w-3" strokeWidth={2.5} />
                              </span>
                            ) : (
                              <span className="text-gray-200">&mdash;</span>
                            )}
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-center tabular-nums font-medium">
                          {recipe.allergens.size}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ----------------------------------------------------------------- */}
          {/* CARD VIEW                                                          */}
          {/* ----------------------------------------------------------------- */}
          <TabsContent value="cards" className="mt-4">
            <div className="space-y-8">
              {Array.from(grouped.entries()).map(([category, items]) => (
                <div key={category}>
                  <h3 className="mb-3 text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {RECIPE_CATEGORY_LABELS[category] ?? category}
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((recipe) => {
                      const allergenArr = Array.from(recipe.allergens)
                      return (
                        <div
                          key={recipe.id}
                          className="rounded-lg border border-border bg-white p-4 transition-shadow hover:shadow-sm"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-[13px] font-medium">{recipe.name}</p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground capitalize">
                                {recipe.category}
                              </p>
                            </div>
                            <span className="tabular-nums rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {allergenArr.length} allergen{allergenArr.length !== 1 ? 's' : ''}
                            </span>
                          </div>

                          {/* Allergen badges */}
                          {allergenArr.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1">
                              {allergenArr.map((a) => (
                                <span
                                  key={a}
                                  className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 border border-red-200"
                                >
                                  <span>{ALLERGEN_EMOJI[a]}</span>
                                  {ALLERGEN_LABELS[a]}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 text-[11px] text-emerald-600">
                              No known allergens
                            </p>
                          )}

                          {/* Dietary labels */}
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {isVegan(recipe.allergens) && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
                                <Leaf className="h-3 w-3" />
                                Vegan
                              </span>
                            )}
                            {isVegetarian(recipe.allergens) && !isVegan(recipe.allergens) && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 border border-green-200">
                                <Leaf className="h-3 w-3" />
                                Vegetarian
                              </span>
                            )}
                            {isGlutenFree(recipe.allergens) && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                                <Wheat className="h-3 w-3" />
                                Gluten-Free
                              </span>
                            )}
                            {isDairyFree(recipe.allergens) && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200">
                                <Milk className="h-3 w-3" />
                                Dairy-Free
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
