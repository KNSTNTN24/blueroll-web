'use client'

import { use } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { RECIPE_CATEGORY_LABELS, ALLERGEN_LABELS, type EUAllergen } from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  ChefHat,
  Pencil,
  Trash2,
  Power,
  Thermometer,
  Clock,
  AlertTriangle,
  Flame,
  Snowflake,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

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

interface RecipeDetailPageProps {
  params: Promise<{ id: string }>
}

export default function RecipeDetailPage({ params }: RecipeDetailPageProps) {
  const { id } = use(params)
  const { profile } = useAuthStore()
  const router = useRouter()
  const queryClient = useQueryClient()
  const isManager =
    profile?.role === 'owner' ||
    profile?.role === 'manager' ||
    profile?.role === 'chef'

  const { data: recipe, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('recipes')
        .select('*, recipe_ingredients(*, ingredients(*))')
        .eq('id', id)
        .single()
      return data
    },
  })

  const toggleActive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('recipes')
        .update({ active: !recipe?.active })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipe', id] })
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      toast.success(recipe?.active ? 'Recipe deactivated' : 'Recipe activated')
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteRecipe = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('recipes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      toast.success('Recipe deleted')
      router.push('/recipes')
    },
    onError: (err) => toast.error(err.message),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (!recipe) {
    return (
      <div className="space-y-6">
        <Link
          href="/recipes"
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Recipes
        </Link>
        <p className="text-[13px] text-muted-foreground">Recipe not found.</p>
      </div>
    )
  }

  const ingredients = (recipe.recipe_ingredients as Array<{
    id: string
    quantity: string | null
    unit: string | null
    notes: string | null
    ingredients: { id: string; name: string; allergens: string[] } | null
  }>) ?? []

  const allAllergens = new Set<string>()
  ingredients.forEach((ri) => {
    ri.ingredients?.allergens?.forEach((a) => allAllergens.add(a))
  })
  const allergenList = Array.from(allAllergens).sort()

  const isVegetarian =
    !allAllergens.has('fish') &&
    !allAllergens.has('crustaceans') &&
    !allAllergens.has('molluscs')
  const isVegan =
    isVegetarian &&
    !allAllergens.has('milk') &&
    !allAllergens.has('eggs')
  const isGlutenFree = !allAllergens.has('gluten')
  const isDairyFree = !allAllergens.has('milk')

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/recipes"
          className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Recipes
        </Link>
        <PageHeader
          title={recipe.name}
          description={recipe.description ?? undefined}
        >
          {isManager && (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => toggleActive.mutate()}
                disabled={toggleActive.isPending}
                size="sm"
                variant="outline"
              >
                <Power className="mr-1.5 h-3.5 w-3.5" />
                {recipe.active ? 'Deactivate' : 'Activate'}
              </Button>
              <Button
                onClick={() => router.push(`/recipes/${id}/edit`)}
                size="sm"
                variant="outline"
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit
              </Button>
              <Button
                onClick={() => {
                  if (confirm('Are you sure you want to delete this recipe?')) {
                    deleteRecipe.mutate()
                  }
                }}
                disabled={deleteRecipe.isPending}
                size="sm"
                variant="outline"
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                {deleteRecipe.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Delete
              </Button>
            </div>
          )}
        </PageHeader>
      </div>

      {/* Status and category */}
      <div className="flex items-center gap-3">
        <StatusBadge
          status={recipe.active ? 'success' : 'neutral'}
          label={recipe.active ? 'Active' : 'Inactive'}
        />
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground">
          {RECIPE_CATEGORY_LABELS[recipe.category] ?? recipe.category}
        </span>
      </div>

      {/* Dietary labels */}
      <div className="flex flex-wrap gap-2">
        {isVegan && (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Vegan
          </span>
        )}
        {isVegetarian && !isVegan && (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Vegetarian
          </span>
        )}
        {isGlutenFree && (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Gluten-Free
          </span>
        )}
        {isDairyFree && (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Dairy-Free
          </span>
        )}
      </div>

      {/* Allergens summary */}
      {allergenList.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="text-[13px] font-medium text-amber-800">Allergens</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allergenList.map((allergen) => (
              <span
                key={allergen}
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  ALLERGEN_COLORS[allergen] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                )}
              >
                {ALLERGEN_LABELS[allergen as EUAllergen] ?? allergen}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Cooking info */}
      {(recipe.cooking_method || recipe.cooking_temp || recipe.cooking_time) && (
        <div className="grid gap-4 sm:grid-cols-3">
          {recipe.cooking_method && (
            <div className="rounded-lg border border-border bg-white p-4">
              <div className="flex items-center gap-2 mb-1">
                <ChefHat className="h-4 w-4 text-muted-foreground" />
                <p className="text-[12px] text-muted-foreground">Cooking Method</p>
              </div>
              <p className="text-[13px] font-medium">{recipe.cooking_method}</p>
            </div>
          )}
          {recipe.cooking_temp && (
            <div className="rounded-lg border border-border bg-white p-4">
              <div className="flex items-center gap-2 mb-1">
                <Thermometer className="h-4 w-4 text-muted-foreground" />
                <p className="text-[12px] text-muted-foreground">Temperature</p>
              </div>
              <p className="text-[13px] font-medium">{recipe.cooking_temp}&deg;C</p>
            </div>
          )}
          {recipe.cooking_time && (
            <div className="rounded-lg border border-border bg-white p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <p className="text-[12px] text-muted-foreground">Cooking Time</p>
              </div>
              <p className="text-[13px] font-medium">
                {recipe.cooking_time} {recipe.cooking_time_unit ?? 'mins'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      {recipe.instructions && (
        <div className="rounded-lg border border-border bg-white p-4">
          <h3 className="mb-2 text-[13px] font-medium">Instructions</h3>
          <p className="whitespace-pre-wrap text-[13px] text-muted-foreground leading-relaxed">
            {recipe.instructions}
          </p>
        </div>
      )}

      {/* Ingredients table */}
      {ingredients.length > 0 && (
        <div>
          <h3 className="mb-3 text-[14px] font-medium">Ingredients</h3>
          <div className="rounded-lg border border-border bg-white">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                    Ingredient
                  </th>
                  <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                    Quantity
                  </th>
                  <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">
                    Allergens
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ingredients.map((ri) => (
                  <tr key={ri.id} className="transition-colors hover:bg-accent/50">
                    <td className="px-4 py-3 text-[13px] font-medium">
                      {ri.ingredients?.name ?? 'Unknown'}
                      {ri.notes && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          ({ri.notes})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground">
                      {ri.quantity ? `${ri.quantity}${ri.unit ? ` ${ri.unit}` : ''}` : '--'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(!ri.ingredients?.allergens || ri.ingredients.allergens.length === 0) ? (
                          <span className="text-[11px] text-muted-foreground">None</span>
                        ) : (
                          ri.ingredients.allergens.map((a) => (
                            <span
                              key={a}
                              className={cn(
                                'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                                ALLERGEN_COLORS[a] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                              )}
                            >
                              {ALLERGEN_LABELS[a as EUAllergen] ?? a}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Extra care flags */}
      {recipe.extra_care_flags && recipe.extra_care_flags.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <p className="text-[13px] font-medium text-red-800">Extra Care Required</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recipe.extra_care_flags.map((flag) => (
              <span
                key={flag}
                className="inline-flex items-center rounded-full border border-red-200 bg-white px-2 py-0.5 text-[11px] font-medium text-red-700"
              >
                {flag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* HACCP details */}
      {(recipe.reheating_instructions || recipe.hot_holding_required || recipe.chilling_method) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {recipe.reheating_instructions && (
            <div className="rounded-lg border border-border bg-white p-4">
              <div className="flex items-center gap-2 mb-1">
                <Flame className="h-4 w-4 text-orange-500" />
                <p className="text-[12px] text-muted-foreground">Reheating Instructions</p>
              </div>
              <p className="text-[13px] whitespace-pre-wrap">{recipe.reheating_instructions}</p>
            </div>
          )}
          {recipe.hot_holding_required && (
            <div className="rounded-lg border border-border bg-white p-4">
              <div className="flex items-center gap-2 mb-1">
                <Thermometer className="h-4 w-4 text-red-500" />
                <p className="text-[12px] text-muted-foreground">Hot Holding</p>
              </div>
              <p className="text-[13px] font-medium">Required -- must be held at 63&deg;C or above</p>
            </div>
          )}
          {recipe.chilling_method && (
            <div className="rounded-lg border border-border bg-white p-4">
              <div className="flex items-center gap-2 mb-1">
                <Snowflake className="h-4 w-4 text-blue-500" />
                <p className="text-[12px] text-muted-foreground">Chilling Method</p>
              </div>
              <p className="text-[13px]">{recipe.chilling_method}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
