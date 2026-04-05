'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RECIPE_CATEGORY_LABELS, ALLERGEN_LABELS, type EUAllergen } from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  ChefHat,
  Plus,
  Sparkles,
  Search,
  ChevronRight,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const ALLERGEN_COLORS: Record<string, string> = {
  gluten: 'bg-amber-100 text-amber-800 border-amber-200',
  crustaceans: 'bg-red-100 text-red-800 border-red-200',
  eggs: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  fish: 'bg-blue-100 text-blue-800 border-blue-200',
  peanuts: 'bg-orange-100 text-orange-800 border-orange-200',
  soybeans: 'bg-lime-100 text-lime-800 border-lime-200',
  milk: 'bg-sky-100 text-sky-800 border-sky-200',
  nuts: 'bg-amber-100 text-amber-800 border-amber-200',
  celery: 'bg-green-100 text-green-800 border-green-200',
  mustard: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  sesame: 'bg-stone-100 text-stone-800 border-stone-200',
  sulphites: 'bg-purple-100 text-purple-800 border-purple-200',
  lupin: 'bg-pink-100 text-pink-800 border-pink-200',
  molluscs: 'bg-teal-100 text-teal-800 border-teal-200',
}

export default function RecipesPage() {
  const { profile, business } = useAuthStore()
  const router = useRouter()
  const isManager =
    profile?.role === 'owner' ||
    profile?.role === 'manager' ||
    profile?.role === 'chef'

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const { data: recipes, isLoading } = useQuery({
    queryKey: ['recipes', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('recipes')
        .select('*, recipe_ingredients(*, ingredients(*))')
        .eq('business_id', business!.id)
        .order('name')
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const filteredRecipes = (recipes ?? []).filter((recipe) => {
    const matchesSearch =
      !search ||
      recipe.name.toLowerCase().includes(search.toLowerCase()) ||
      recipe.description?.toLowerCase().includes(search.toLowerCase())
    const matchesCategory =
      categoryFilter === 'all' || recipe.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  const getAllergens = (recipe: any) => {
    const allergenSet = new Set<string>()
    const ri = recipe.recipe_ingredients as Array<{
      ingredients: { allergens: string[] } | null
    }>
    ri?.forEach((item) => {
      item.ingredients?.allergens?.forEach((a) => allergenSet.add(a))
    })
    return Array.from(allergenSet).sort()
  }

  const getDietaryLabels = (allergens: string[]) => {
    const labels: string[] = []
    if (!allergens.includes('milk')) labels.push('Dairy-Free')
    if (!allergens.includes('gluten')) labels.push('Gluten-Free')
    if (
      !allergens.includes('milk') &&
      !allergens.includes('eggs') &&
      !allergens.includes('fish') &&
      !allergens.includes('crustaceans') &&
      !allergens.includes('molluscs')
    ) {
      labels.push('Vegan')
    } else if (
      !allergens.includes('fish') &&
      !allergens.includes('crustaceans') &&
      !allergens.includes('molluscs')
    ) {
      labels.push('Vegetarian')
    }
    return labels
  }

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
        title="Recipes"
        description="Manage recipes, allergens, and dietary information"
      >
        {isManager && (
          <div className="flex items-center gap-2">
            <Button
              onClick={() => router.push('/recipes/import')}
              size="sm"
              variant="outline"
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              AI Import
            </Button>
            <Button
              onClick={() => router.push('/recipes/new')}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Recipe
            </Button>
          </div>
        )}
      </PageHeader>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes..."
            className="pl-8 text-[13px]"
          />
        </div>
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? "")}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(RECIPE_CATEGORY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Recipes table */}
      {filteredRecipes.length === 0 ? (
        <EmptyState
          icon={ChefHat}
          title={recipes?.length === 0 ? 'No recipes yet' : 'No recipes match your filters'}
          description={
            recipes?.length === 0
              ? 'Add your first recipe to start tracking allergens and dietary information.'
              : 'Try changing your search or category filter.'
          }
          action={
            recipes?.length === 0 && isManager
              ? {
                  label: 'New Recipe',
                  onClick: () => router.push('/recipes/new'),
                }
              : undefined
          }
        />
      ) : (
        <div className="rounded-lg border border-border bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                  Category
                </th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                  Allergens
                </th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                  Dietary
                </th>
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRecipes.map((recipe) => {
                const allergens = getAllergens(recipe)
                const dietaryLabels = getDietaryLabels(allergens)
                return (
                  <tr
                    key={recipe.id}
                    className="transition-colors hover:bg-accent/50"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-[13px] font-medium">{recipe.name}</p>
                        {recipe.description && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
                            {recipe.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground">
                        {RECIPE_CATEGORY_LABELS[recipe.category] ?? recipe.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {allergens.length === 0 ? (
                          <span className="text-[11px] text-muted-foreground">None</span>
                        ) : (
                          allergens.map((allergen) => (
                            <span
                              key={allergen}
                              className={cn(
                                'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                                ALLERGEN_COLORS[allergen] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                              )}
                            >
                              {ALLERGEN_LABELS[allergen as EUAllergen] ?? allergen}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {dietaryLabels.length === 0 ? (
                          <span className="text-[11px] text-muted-foreground">--</span>
                        ) : (
                          dietaryLabels.map((label) => (
                            <span
                              key={label}
                              className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                            >
                              {label}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={recipe.active ? 'success' : 'neutral'}
                        label={recipe.active ? 'Active' : 'Inactive'}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/recipes/${recipe.id}`}
                        className="inline-flex items-center gap-0.5 text-[12px] font-medium text-emerald-600 hover:text-emerald-700"
                      >
                        View
                        <ChevronRight className="h-3 w-3" />
                      </Link>
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
