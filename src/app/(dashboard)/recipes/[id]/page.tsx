'use client'

import { use } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  ArrowLeft, Pencil, Trash2, Power, Thermometer, Clock,
  Flame, Snowflake, AlertTriangle, ChefHat,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import {
  RECIPE_CATEGORY_LABELS,
  ALLERGEN_LABELS,
  type EUAllergen,
} from '@/lib/constants'
import { HACCP_RECIPE_METHODS } from '@/lib/haccp-methods'

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

const EXTRA_CARE_LABELS: Record<string, string> = {
  eggs: 'Eggs', rice: 'Rice', pulses: 'Pulses', shellfish: 'Shellfish',
}

export default function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const queryClient = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const { data: recipe, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select(`
          *,
          recipe_ingredients (
            quantity,
            unit,
            ingredient:ingredients (id, name, allergens)
          )
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
    recipe.recipe_ingredients?.forEach((ri: any) => {
      ri.ingredient?.allergens?.forEach((a: string) => set.add(a))
    })
    return Array.from(set)
  }

  async function handleToggleActive() {
    if (!recipe) return
    const { error } = await supabase
      .from('recipes')
      .update({ active: !recipe.active })
      .eq('id', recipe.id)
    if (error) {
      toast.error('Failed to update status')
    } else {
      toast.success(recipe.active ? 'Recipe deactivated' : 'Recipe activated')
      queryClient.invalidateQueries({ queryKey: ['recipe', id] })
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this recipe? This cannot be undone.')) return
    const { error } = await supabase.from('recipes').delete().eq('id', recipe!.id)
    if (error) {
      toast.error('Failed to delete recipe')
    } else {
      toast.success('Recipe deleted')
      router.push('/recipes')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">
        Loading recipe...
      </div>
    )
  }

  if (!recipe) {
    return (
      <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">
        Recipe not found
      </div>
    )
  }

  const allergens = getAllergens()
  const dietary = computeDietary(allergens)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="mt-0.5 h-7 w-7 p-0"
            onClick={() => router.push('/recipes')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {recipe.name}
              </h1>
              <StatusBadge
                status={recipe.active ? 'success' : 'neutral'}
                label={recipe.active ? 'Active' : 'Inactive'}
              />
            </div>
            {recipe.description && (
              <p className="mt-1 text-[13px] text-muted-foreground">{recipe.description}</p>
            )}
          </div>
        </div>
        {isManager && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleActive}
              className="gap-1.5"
            >
              <Power className="h-3.5 w-3.5" />
              {recipe.active ? 'Deactivate' : 'Activate'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/recipes/edit/${recipe.id}`)}
              className="gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              className="gap-1.5 text-red-600 hover:text-red-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        )}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="Category" value={RECIPE_CATEGORY_LABELS[recipe.category] ?? recipe.category} />
        {recipe.cooking_method && (
          <InfoCard
            icon={Flame}
            label="Cooking Method"
            value={recipe.cooking_method}
          />
        )}
        {recipe.cooking_temp && (
          <InfoCard
            icon={Thermometer}
            label="Temperature"
            value={`${recipe.cooking_temp}${recipe.cooking_temp_unit === 'fahrenheit' ? ' °F' : ' °C'}`}
          />
        )}
        {recipe.cooking_time && (
          <InfoCard
            icon={Clock}
            label="Cooking Time"
            value={`${recipe.cooking_time} ${recipe.cooking_time_unit ?? 'min'}`}
          />
        )}
      </div>

      {/* Allergens + Dietary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-[13px] font-medium text-foreground mb-2">Allergens</h3>
          <div className="flex flex-wrap gap-1.5">
            {allergens.length === 0 ? (
              <span className="text-[13px] text-muted-foreground">No allergens</span>
            ) : (
              allergens.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-medium text-red-700 border border-red-200"
                >
                  {ALLERGEN_LABELS[a as EUAllergen] ?? a}
                </span>
              ))
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-[13px] font-medium text-foreground mb-2">Dietary Labels</h3>
          <div className="flex flex-wrap gap-1.5">
            {dietary.length === 0 ? (
              <span className="text-[13px] text-muted-foreground">None</span>
            ) : (
              dietary.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200"
                >
                  {d}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Instructions */}
      {recipe.instructions && (
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-[13px] font-medium text-foreground mb-2">Instructions</h3>
          <p className="text-[13px] text-muted-foreground whitespace-pre-wrap">
            {recipe.instructions}
          </p>
        </div>
      )}

      {/* Ingredients table */}
      {recipe.recipe_ingredients && recipe.recipe_ingredients.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/50">
            <h3 className="text-[13px] font-medium text-foreground">Ingredients</h3>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Quantity</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Unit</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Allergens</th>
              </tr>
            </thead>
            <tbody>
              {recipe.recipe_ingredients.map((ri: any, idx: number) => (
                <tr key={idx} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 text-foreground">{ri.ingredient?.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{ri.quantity ?? '-'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{ri.unit ?? '-'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(ri.ingredient?.allergens ?? []).map((a: string) => (
                        <span
                          key={a}
                          className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 border border-red-200"
                        >
                          {ALLERGEN_LABELS[a as EUAllergen] ?? a}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* HACCP control methods */}
      {recipe.haccp_methods && recipe.haccp_methods.length > 0 && (
        <div className="rounded-lg border border-border bg-white p-4">
          <h3 className="mb-2 text-[13px] font-medium text-foreground">HACCP Control Methods</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['Chilling', 'Cooking'] as const).map((section) => {
              const selected = HACCP_RECIPE_METHODS.filter(
                (m) => m.section === section && recipe.haccp_methods.includes(m.id),
              )
              if (selected.length === 0) return null
              return (
                <div key={section}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{section}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.map((m) => (
                      <span
                        key={m.id}
                        title={m.description}
                        className={
                          section === 'Cooking'
                            ? 'inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[11px] font-medium text-orange-800'
                            : 'inline-flex items-center rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-0.5 text-[11px] font-medium text-cyan-800'
                        }
                      >
                        {m.label}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Extra care flags */}
      {recipe.extra_care_flags && recipe.extra_care_flags.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h3 className="text-[13px] font-medium text-amber-800">Extra Care Required</h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recipe.extra_care_flags.map((flag: string) => (
              <span
                key={flag}
                className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-300"
              >
                {EXTRA_CARE_LABELS[flag] ?? flag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Additional info */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {recipe.reheating_instructions && (
          <div className="rounded-lg border border-border p-4">
            <h3 className="text-[13px] font-medium text-foreground mb-2">Reheating Instructions</h3>
            <p className="text-[13px] text-muted-foreground whitespace-pre-wrap">
              {recipe.reheating_instructions}
            </p>
          </div>
        )}
        {recipe.chilling_method && (
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Snowflake className="h-3.5 w-3.5 text-blue-500" />
              <h3 className="text-[13px] font-medium text-foreground">Chilling Method</h3>
            </div>
            <p className="text-[13px] text-muted-foreground whitespace-pre-wrap">
              {recipe.chilling_method}
            </p>
          </div>
        )}
        {recipe.freezing_instructions && (
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Snowflake className="h-3.5 w-3.5 text-cyan-500" />
              <h3 className="text-[13px] font-medium text-foreground">Freezing Instructions</h3>
            </div>
            <p className="text-[13px] text-muted-foreground whitespace-pre-wrap">
              {recipe.freezing_instructions}
            </p>
          </div>
        )}
        {recipe.defrosting_instructions && (
          <div className="rounded-lg border border-border p-4">
            <h3 className="text-[13px] font-medium text-foreground mb-2">Defrosting Instructions</h3>
            <p className="text-[13px] text-muted-foreground whitespace-pre-wrap">
              {recipe.defrosting_instructions}
            </p>
          </div>
        )}
        {recipe.hot_holding_required && (
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Flame className="h-3.5 w-3.5 text-orange-500" />
              <h3 className="text-[13px] font-medium text-foreground">Hot Holding</h3>
            </div>
            <p className="text-[13px] text-muted-foreground">
              This recipe requires hot holding at safe temperatures.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Small info card component ── */
function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon?: any
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="text-[14px] font-medium text-foreground">{value}</p>
    </div>
  )
}
