'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { RECIPE_CATEGORY_LABELS, EU_ALLERGENS, ALLERGEN_LABELS } from '@/lib/constants'
import {
  UtensilsCrossed,
  ChefHat,
  Search,
  Check,
  AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

export default function MenuPage() {
  const { profile, business } = useAuthStore()
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const [search, setSearch] = useState('')

  const { data: recipes, isLoading } = useQuery({
    queryKey: ['recipes-menu', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('recipes')
        .select('*, recipe_ingredients(*, ingredients(name, allergens))')
        .eq('business_id', business!.id)
        .order('name')
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const activeRecipes = recipes?.filter((r: any) => r.active) ?? []

  const filtered = useMemo(() => {
    if (!search.trim()) return activeRecipes
    const q = search.toLowerCase()
    return activeRecipes.filter((r: any) =>
      r.name.toLowerCase().includes(q) ||
      r.category?.toLowerCase().includes(q)
    )
  }, [activeRecipes, search])

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {}
    for (const r of filtered) {
      const cat = r.category ?? 'other'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(r)
    }
    return groups
  }, [filtered])

  const getAllergens = (recipe: any): string[] => {
    const set = new Set<string>()
    const ri = recipe.recipe_ingredients as any[] ?? []
    ri.forEach((item: any) => {
      const allergens = item.ingredients?.allergens as string[] ?? []
      allergens.forEach((a: string) => set.add(a))
    })
    return Array.from(set)
  }

  const getDietaryLabels = (recipe: any): string[] => {
    const allergens = getAllergens(recipe)
    const labels: string[] = []
    const hasMeat = allergens.some(a => ['fish', 'crustaceans', 'molluscs'].includes(a))
    const hasDairy = allergens.includes('milk')
    const hasEggs = allergens.includes('eggs')
    const hasGluten = allergens.includes('gluten')

    if (!hasMeat && !hasEggs && !hasDairy) labels.push('Vegan')
    else if (!hasMeat) labels.push('Vegetarian')
    if (!hasGluten) labels.push('Gluten-Free')
    if (!hasDairy) labels.push('Dairy-Free')
    return labels
  }

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('recipes')
        .update({ active })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes-menu'] })
      toast.success('Recipe updated')
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Menu"
        description="Active recipes are shown on your menu and allergen matrix"
      />

      <Tabs defaultValue="recipes">
        <TabsList>
          <TabsTrigger value="recipes">Recipes</TabsTrigger>
          <TabsTrigger value="allergens">Allergens</TabsTrigger>
        </TabsList>

        {/* Recipes tab */}
        <TabsContent value="recipes" className="mt-4">
          {activeRecipes.length === 0 ? (
            <EmptyState
              icon={ChefHat}
              title="No active recipes"
              description="Activate recipes to show them on your menu. Go to Recipes to create or manage your dishes."
              action={{ label: 'Go to Recipes', onClick: () => window.location.href = '/recipes' }}
            />
          ) : (
            <div className="space-y-4">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search menu..."
                  className="pl-9 text-[13px]"
                />
              </div>

              {Object.entries(grouped).map(([category, items]) => (
                <div key={category}>
                  <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                    {RECIPE_CATEGORY_LABELS[category] ?? category} ({items.length})
                  </h3>
                  <div className="rounded-lg border border-border bg-white">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground">Name</th>
                          <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground">Allergens</th>
                          <th className="px-4 py-2 text-left text-[11px] font-medium text-muted-foreground">Dietary</th>
                          {isManager && (
                            <th className="px-4 py-2 text-center text-[11px] font-medium text-muted-foreground">Active</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {items.map((recipe: any) => {
                          const allergens = getAllergens(recipe)
                          const dietary = getDietaryLabels(recipe)
                          return (
                            <tr key={recipe.id} className="transition-colors hover:bg-accent/50">
                              <td className="px-4 py-2.5">
                                <Link href={`/recipes/${recipe.id}`} className="text-[13px] font-medium hover:text-emerald-600">
                                  {recipe.name}
                                </Link>
                                {recipe.description && (
                                  <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">{recipe.description}</p>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex flex-wrap gap-1">
                                  {allergens.length === 0 ? (
                                    <span className="text-[11px] text-muted-foreground">None</span>
                                  ) : (
                                    allergens.map((a) => (
                                      <span key={a} className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 border border-red-200">
                                        {ALLERGEN_LABELS[a as keyof typeof ALLERGEN_LABELS] ?? a}
                                      </span>
                                    ))
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex flex-wrap gap-1">
                                  {dietary.map((d) => (
                                    <span key={d} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
                                      {d}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              {isManager && (
                                <td className="px-4 py-2.5 text-center">
                                  <Switch
                                    checked={recipe.active}
                                    onCheckedChange={(checked) =>
                                      toggleActive.mutate({ id: recipe.id, active: checked })
                                    }
                                  />
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Allergens tab — matrix of active recipes vs 14 EU allergens */}
        <TabsContent value="allergens" className="mt-4">
          {activeRecipes.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="No active recipes"
              description="Activate recipes to see the allergen matrix."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-white">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-medium text-muted-foreground">
                      Recipe
                    </th>
                    {EU_ALLERGENS.map((a) => (
                      <th key={a} className="px-2 py-2 text-center font-medium text-muted-foreground" title={ALLERGEN_LABELS[a]}>
                        {ALLERGEN_LABELS[a].slice(0, 4)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activeRecipes.map((recipe: any) => {
                    const allergens = getAllergens(recipe)
                    return (
                      <tr key={recipe.id} className="transition-colors hover:bg-accent/50">
                        <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium">
                          {recipe.name}
                        </td>
                        {EU_ALLERGENS.map((a) => (
                          <td key={a} className="px-2 py-2 text-center">
                            {allergens.includes(a) ? (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600">
                                <Check className="h-3 w-3" />
                              </span>
                            ) : (
                              <span className="text-gray-200">&mdash;</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
