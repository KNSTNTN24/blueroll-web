'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  UtensilsCrossed, Download, Printer, Power, Check, X,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import {
  RECIPE_CATEGORY_LABELS,
  EU_ALLERGENS,
  ALLERGEN_LABELS,
  type EUAllergen,
} from '@/lib/constants'

type TabId = 'recipes' | 'allergens'

/* ── dietary helpers ── */
const DIETARY_RULES: Record<string, (allergens: string[]) => boolean> = {
  Vegan: (a) => !a.some((x) => ['milk', 'eggs', 'fish', 'crustaceans', 'molluscs'].includes(x)),
  Vegetarian: (a) => !a.some((x) => ['fish', 'crustaceans', 'molluscs'].includes(x)),
  'Gluten-Free': (a) => !a.includes('gluten'),
  'Dairy-Free': (a) => !a.includes('milk'),
}

function computeDietary(allergens: string[]): string[] {
  return Object.entries(DIETARY_RULES)
    .filter(([, fn]) => fn(allergens))
    .map(([label]) => label)
}

function getAllergens(recipe: any): string[] {
  const set = new Set<string>()
  recipe.recipe_ingredients?.forEach((ri: any) => {
    ri.ingredient?.allergens?.forEach((a: string) => set.add(a))
  })
  return Array.from(set)
}

export default function MenuPage() {
  const queryClient = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [tab, setTab] = useState<TabId>('recipes')

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ['menu-recipes', business?.id],
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
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const activeRecipes = recipes.filter((r: any) => r.active)

  async function handleToggle(recipe: any) {
    const { error } = await supabase
      .from('recipes')
      .update({ active: !recipe.active })
      .eq('id', recipe.id)
    if (error) {
      toast.error('Failed to update')
    } else {
      toast.success(recipe.active ? 'Removed from menu' : 'Added to menu')
      queryClient.invalidateQueries({ queryKey: ['menu-recipes'] })
    }
  }

  function exportCSV() {
    const header = ['Recipe', 'Category', ...EU_ALLERGENS.map((a) => ALLERGEN_LABELS[a])]
    const rows = activeRecipes.map((r: any) => {
      const allergens = getAllergens(r)
      return [
        r.name,
        RECIPE_CATEGORY_LABELS[r.category] ?? r.category,
        ...EU_ALLERGENS.map((a) => (allergens.includes(a) ? 'Y' : '')),
      ]
    })
    const csv = [header, ...rows].map((row) => row.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'menu-allergens.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handlePrint() {
    // Group active recipes by category
    const grouped: Record<string, any[]> = {}
    for (const r of activeRecipes) {
      const cat = r.category ?? 'other'
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(r)
    }

    // Count dietary totals
    const dietaryCounts: Record<string, number> = {}
    activeRecipes.forEach((r: any) => {
      const dietary = computeDietary(getAllergens(r))
      dietary.forEach((d) => { dietaryCounts[d] = (dietaryCounts[d] || 0) + 1 })
    })

    const categoryOrder = ['starter','main','dessert','side','sauce','drink','cocktail','beverage','other']
    const sortedCategories = Object.keys(grouped).sort(
      (a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b)
    )

    let html = `<!DOCTYPE html><html><head><title>${business?.name ?? 'Blueroll'} — Menu</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 11px; color: #1a1a1a; padding: 24px; }
      h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
      .subtitle { font-size: 11px; color: #6b7280; margin-bottom: 16px; }
      h2 { font-size: 13px; font-weight: 600; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: 0.5px; color: #047857; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
      th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
      td { padding: 5px 6px; border-bottom: 1px solid #f3f4f6; font-size: 11px; }
      .allergen { display: inline-block; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 3px; padding: 1px 4px; font-size: 8px; font-weight: 600; margin: 0 2px 2px 0; }
      .dietary { display: inline-block; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; border-radius: 3px; padding: 1px 4px; font-size: 8px; font-weight: 600; margin: 0 2px 2px 0; }
      .summary { margin-top: 16px; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; }
      .summary-title { font-size: 11px; font-weight: 600; margin-bottom: 6px; }
      .summary-row { display: flex; justify-content: space-between; font-size: 10px; padding: 2px 0; }
      .footer { margin-top: 20px; font-size: 9px; color: #9ca3af; text-align: center; }
      @media print { body { padding: 12px; } }
    </style></head><body>`

    html += `<h1>${business?.name ?? 'Menu'}</h1>`
    html += `<div class="subtitle">${activeRecipes.length} dishes · Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>`

    for (const cat of sortedCategories) {
      const items = grouped[cat]
      html += `<h2>${RECIPE_CATEGORY_LABELS[cat] ?? cat} (${items.length})</h2>`
      html += `<table><tr><th>Dish</th><th>Allergens</th><th>Dietary</th></tr>`
      for (const r of items) {
        const allergens = getAllergens(r)
        const dietary = computeDietary(allergens)
        const allergenBadges = allergens.length > 0
          ? allergens.map((a) => `<span class="allergen">${ALLERGEN_LABELS[a as keyof typeof ALLERGEN_LABELS] ?? a}</span>`).join('')
          : '<span style="color:#9ca3af">None</span>'
        const dietaryBadges = dietary.length > 0
          ? dietary.map((d) => `<span class="dietary">${d}</span>`).join('')
          : ''
        html += `<tr><td><strong>${r.name}</strong>${r.description ? `<br><span style="color:#6b7280;font-size:10px">${r.description}</span>` : ''}</td><td>${allergenBadges}</td><td>${dietaryBadges}</td></tr>`
      }
      html += `</table>`
    }

    // Dietary summary
    if (Object.keys(dietaryCounts).length > 0) {
      html += `<div class="summary"><div class="summary-title">Dietary Summary</div>`
      for (const [label, count] of Object.entries(dietaryCounts)) {
        html += `<div class="summary-row"><span>${label}</span><span>${count} dish${count !== 1 ? 'es' : ''}</span></div>`
      }
      html += `</div>`
    }

    html += `<div class="footer">Generated by Blueroll · blueroll.app</div></body></html>`

    const w = window.open('', '_blank')
    if (w) {
      w.document.write(html)
      w.document.close()
      w.print()
    }
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'recipes', label: 'Recipes' },
    { id: 'allergens', label: 'Allergens' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Menu" description="Active recipes on your menu">
        <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          CSV
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
          <Printer className="h-3.5 w-3.5" />
          PDF
        </Button>
      </PageHeader>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-2 text-[13px] font-medium transition-colors ${
              tab === t.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">
          Loading menu...
        </div>
      ) : tab === 'recipes' ? (
        /* ── Recipes Tab ── */
        recipes.length === 0 ? (
          <EmptyState
            icon={UtensilsCrossed}
            title="No recipes yet"
            description="Create recipes first, then activate them to build your menu"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Category</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Allergens</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Dietary</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                  {isManager && (
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {recipes.map((recipe: any) => {
                  const allergens = getAllergens(recipe)
                  const dietary = computeDietary(allergens)
                  return (
                    <tr key={recipe.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-foreground">{recipe.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {RECIPE_CATEGORY_LABELS[recipe.category] ?? recipe.category}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {allergens.length === 0 ? (
                            <span className="text-muted-foreground">None</span>
                          ) : (
                            allergens.map((a) => (
                              <span
                                key={a}
                                className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 border border-red-200"
                              >
                                {ALLERGEN_LABELS[a as EUAllergen] ?? a}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {dietary.map((d) => (
                            <span
                              key={d}
                              className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200"
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={recipe.active ? 'success' : 'neutral'}
                          label={recipe.active ? 'Active' : 'Inactive'}
                        />
                      </td>
                      {isManager && (
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggle(recipe)}
                            className="gap-1.5 text-[12px]"
                          >
                            <Power className="h-3 w-3" />
                            {recipe.active ? 'Deactivate' : 'Activate'}
                          </Button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* ── Allergens Matrix Tab ── */
        activeRecipes.length === 0 ? (
          <EmptyState
            icon={UtensilsCrossed}
            title="No active recipes"
            description="Activate recipes to see the allergen matrix"
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="sticky left-0 bg-muted/50 px-4 py-2.5 text-left font-medium text-muted-foreground min-w-[180px]">
                    Recipe
                  </th>
                  {EU_ALLERGENS.map((a) => (
                    <th
                      key={a}
                      className="px-2 py-2.5 text-center font-medium text-muted-foreground min-w-[70px]"
                    >
                      <span className="text-[11px]">{ALLERGEN_LABELS[a]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeRecipes.map((recipe: any) => {
                  const allergens = getAllergens(recipe)
                  return (
                    <tr key={recipe.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="sticky left-0 bg-background px-4 py-2.5 font-medium text-foreground">
                        {recipe.name}
                      </td>
                      {EU_ALLERGENS.map((a) => (
                        <td key={a} className="px-2 py-2.5 text-center">
                          {allergens.includes(a) ? (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-700">
                              <Check className="h-3 w-3" />
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
