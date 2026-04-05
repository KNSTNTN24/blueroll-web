'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  RECIPE_CATEGORIES,
  RECIPE_CATEGORY_LABELS,
  EU_ALLERGENS,
  ALLERGEN_LABELS,
} from '@/lib/constants'
import { cn } from '@/lib/utils'
import { ArrowLeft, Plus, Trash2, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface IngredientRow {
  name: string
  quantity: string
  unit: string
  allergens: string[]
}

const EMPTY_INGREDIENT: IngredientRow = {
  name: '',
  quantity: '',
  unit: '',
  allergens: [],
}

export default function NewRecipePage() {
  const { profile, business } = useAuthStore()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<string>('')
  const [instructions, setInstructions] = useState('')
  const [cookingMethod, setCookingMethod] = useState('')
  const [cookingTemp, setCookingTemp] = useState('')
  const [cookingTime, setCookingTime] = useState('')
  const [cookingTimeUnit, setCookingTimeUnit] = useState('mins')
  const [ingredients, setIngredients] = useState<IngredientRow[]>([
    { ...EMPTY_INGREDIENT },
  ])

  const addIngredient = () => {
    setIngredients((prev) => [...prev, { ...EMPTY_INGREDIENT }])
  }

  const removeIngredient = (index: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== index))
  }

  const updateIngredient = (
    index: number,
    field: keyof IngredientRow,
    value: string | string[]
  ) => {
    setIngredients((prev) =>
      prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing))
    )
  }

  const toggleAllergen = (index: number, allergen: string) => {
    setIngredients((prev) =>
      prev.map((ing, i) => {
        if (i !== index) return ing
        const has = ing.allergens.includes(allergen)
        return {
          ...ing,
          allergens: has
            ? ing.allergens.filter((a) => a !== allergen)
            : [...ing.allergens, allergen],
        }
      })
    )
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!business?.id || !profile?.id) throw new Error('Not authenticated')
      if (!name.trim()) throw new Error('Name is required')
      if (!category) throw new Error('Category is required')

      const validIngredients = ingredients.filter((i) => i.name.trim())

      // Upsert ingredients: check if they exist by name for this business, create if not
      const ingredientIds: string[] = []
      for (const ing of validIngredients) {
        const normalizedName = ing.name.trim().toLowerCase()

        // Check if ingredient exists
        const { data: existing } = await supabase
          .from('ingredients')
          .select('id')
          .eq('business_id', business.id)
          .ilike('name', normalizedName)
          .limit(1)
          .maybeSingle()

        if (existing) {
          // Update allergens if they changed
          await supabase
            .from('ingredients')
            .update({ allergens: ing.allergens })
            .eq('id', existing.id)
          ingredientIds.push(existing.id)
        } else {
          // Create new ingredient
          const { data: created, error } = await supabase
            .from('ingredients')
            .insert({
              name: ing.name.trim(),
              allergens: ing.allergens,
              business_id: business.id,
            })
            .select('id')
            .single()
          if (error) throw error
          ingredientIds.push(created.id)
        }
      }

      // Create recipe
      const { data: recipe, error: recipeError } = await supabase
        .from('recipes')
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          category,
          instructions: instructions.trim(),
          cooking_method: cookingMethod.trim() || null,
          cooking_temp: cookingTemp ? parseFloat(cookingTemp) : null,
          cooking_time: cookingTime ? parseInt(cookingTime, 10) : null,
          cooking_time_unit: cookingTimeUnit || null,
          business_id: business.id,
          created_by: profile.id,
        })
        .select('id')
        .single()

      if (recipeError) throw recipeError

      // Link ingredients
      if (ingredientIds.length > 0) {
        const links = validIngredients.map((ing, idx) => ({
          recipe_id: recipe.id,
          ingredient_id: ingredientIds[idx],
          quantity: ing.quantity.trim() || null,
          unit: ing.unit.trim() || null,
        }))
        const { error: linkError } = await supabase
          .from('recipe_ingredients')
          .insert(links)
        if (linkError) throw linkError
      }

      return recipe.id
    },
    onSuccess: (recipeId) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      toast.success('Recipe created')
      router.push(`/recipes/${recipeId}`)
    },
    onError: (err) => toast.error(err.message),
  })

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
          title="New Recipe"
          description="Add a new recipe with ingredients and allergen information"
        />
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* Basic info */}
        <div className="rounded-lg border border-border bg-white p-4 space-y-4">
          <h3 className="text-[14px] font-medium">Basic Information</h3>
          <div className="space-y-3">
            <div>
              <Label className="text-[13px]">Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Chicken Caesar Salad"
                className="mt-1 text-[13px]"
              />
            </div>
            <div>
              <Label className="text-[13px]">Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description..."
                className="mt-1 text-[13px]"
              />
            </div>
            <div>
              <Label className="text-[13px]">Category *</Label>
              <div className="mt-1">
                <Select value={category} onValueChange={(v) => setCategory(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {RECIPE_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {RECIPE_CATEGORY_LABELS[cat]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-[13px]">Instructions</Label>
              <Textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Step-by-step cooking instructions..."
                className="mt-1 min-h-[120px] text-[13px]"
              />
            </div>
          </div>
        </div>

        {/* Cooking details */}
        <div className="rounded-lg border border-border bg-white p-4 space-y-4">
          <h3 className="text-[14px] font-medium">Cooking Details</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[13px]">Cooking Method</Label>
              <Input
                value={cookingMethod}
                onChange={(e) => setCookingMethod(e.target.value)}
                placeholder="e.g. Oven, Grill, Fry"
                className="mt-1 text-[13px]"
              />
            </div>
            <div>
              <Label className="text-[13px]">Temperature (&deg;C)</Label>
              <Input
                type="number"
                value={cookingTemp}
                onChange={(e) => setCookingTemp(e.target.value)}
                placeholder="e.g. 180"
                className="mt-1 text-[13px]"
              />
            </div>
            <div>
              <Label className="text-[13px]">Cooking Time</Label>
              <Input
                type="number"
                value={cookingTime}
                onChange={(e) => setCookingTime(e.target.value)}
                placeholder="e.g. 30"
                className="mt-1 text-[13px]"
              />
            </div>
            <div>
              <Label className="text-[13px]">Time Unit</Label>
              <div className="mt-1">
                <Select value={cookingTimeUnit} onValueChange={(v) => setCookingTimeUnit(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mins">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="secs">Seconds</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Ingredients */}
        <div className="rounded-lg border border-border bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-medium">Ingredients</h3>
            <Button
              type="button"
              onClick={addIngredient}
              size="sm"
              variant="outline"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Ingredient
            </Button>
          </div>

          <div className="space-y-4">
            {ingredients.map((ing, index) => (
              <div
                key={index}
                className="rounded-md border border-border p-3 space-y-3"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label className="text-[12px] text-muted-foreground">
                        Name
                      </Label>
                      <Input
                        value={ing.name}
                        onChange={(e) =>
                          updateIngredient(index, 'name', e.target.value)
                        }
                        placeholder="e.g. Chicken breast"
                        className="mt-1 text-[13px]"
                      />
                    </div>
                    <div>
                      <Label className="text-[12px] text-muted-foreground">
                        Quantity
                      </Label>
                      <Input
                        value={ing.quantity}
                        onChange={(e) =>
                          updateIngredient(index, 'quantity', e.target.value)
                        }
                        placeholder="e.g. 200"
                        className="mt-1 text-[13px]"
                      />
                    </div>
                    <div>
                      <Label className="text-[12px] text-muted-foreground">
                        Unit
                      </Label>
                      <Input
                        value={ing.unit}
                        onChange={(e) =>
                          updateIngredient(index, 'unit', e.target.value)
                        }
                        placeholder="e.g. g, ml, pcs"
                        className="mt-1 text-[13px]"
                      />
                    </div>
                  </div>
                  {ingredients.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeIngredient(index)}
                      className="mt-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Allergens multi-select */}
                <div>
                  <Label className="text-[12px] text-muted-foreground">
                    Allergens
                  </Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {EU_ALLERGENS.map((allergen) => {
                      const selected = ing.allergens.includes(allergen)
                      return (
                        <button
                          key={allergen}
                          type="button"
                          onClick={() => toggleAllergen(index, allergen)}
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                            selected
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                          )}
                        >
                          {ALLERGEN_LABELS[allergen]}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => router.push('/recipes')}
          >
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !name.trim() || !category}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {saveMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create Recipe
          </Button>
        </div>
      </div>
    </div>
  )
}
