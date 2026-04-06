'use client'

import { use, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  Search, Plus, Sparkles, MoreHorizontal, Eye, Pencil, Trash2,
  ChefHat, Filter,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  RECIPE_CATEGORIES,
  RECIPE_CATEGORY_LABELS,
  ALLERGEN_LABELS,
  type EUAllergen,
} from '@/lib/constants'

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

export default function RecipesPage() {
  const router = useRouter()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ['recipes', business?.id],
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

  const filtered = recipes.filter((r: any) => {
    const matchSearch =
      !search || r.name.toLowerCase().includes(search.toLowerCase())
    const matchCategory = !category || r.category === category
    return matchSearch && matchCategory
  })

  function getAllergens(recipe: any): string[] {
    const set = new Set<string>()
    recipe.recipe_ingredients?.forEach((ri: any) => {
      ri.ingredient?.allergens?.forEach((a: string) => set.add(a))
    })
    return Array.from(set)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this recipe? This cannot be undone.')) return
    const { error } = await supabase.from('recipes').delete().eq('id', id)
    if (error) {
      toast.error('Failed to delete recipe')
    } else {
      toast.success('Recipe deleted')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Recipes" description="Manage your recipe collection">
        {isManager && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push('/recipes/import')}
              className="gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI Import
            </Button>
            <Button
              size="sm"
              onClick={() => router.push('/recipes/new')}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" />
              New Recipe
            </Button>
          </>
        )}
      </PageHeader>

      {/* Filters */}
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
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none"
        >
          <option value="">All Categories</option>
          {RECIPE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {RECIPE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">
          Loading recipes...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ChefHat}
          title="No recipes found"
          description={search || category ? 'Try adjusting your filters' : 'Add your first recipe to get started'}
          action={
            isManager && !search && !category
              ? { label: 'New Recipe', onClick: () => router.push('/recipes/new') }
              : undefined
          }
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
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((recipe: any) => {
                const allergens = getAllergens(recipe)
                const dietary = computeDietary(allergens)
                return (
                  <tr
                    key={recipe.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => router.push(`/recipes/${recipe.id}`)}
                  >
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
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => router.push(`/recipes/${recipe.id}`)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {isManager && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => router.push(`/recipes/edit/${recipe.id}`)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                              onClick={() => handleDelete(recipe.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
