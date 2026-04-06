'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  RECIPE_CATEGORIES,
  RECIPE_CATEGORY_LABELS,
  EU_ALLERGENS,
  ALLERGEN_LABELS,
} from '@/lib/constants'

interface IngredientRow {
  name: string
  quantity: string
  unit: string
  allergens: string[]
}

const EXTRA_CARE_OPTIONS = [
  { value: 'eggs', label: 'Eggs' },
  { value: 'rice', label: 'Rice' },
  { value: 'pulses', label: 'Pulses' },
  { value: 'shellfish', label: 'Shellfish' },
]

export default function NewRecipePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)

  const [saving, setSaving] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('main')
  const [instructions, setInstructions] = useState('')
  const [cookingMethod, setCookingMethod] = useState('')
  const [cookingTemp, setCookingTemp] = useState('')
  const [cookingTime, setCookingTime] = useState('')
  const [cookingTimeUnit, setCookingTimeUnit] = useState('minutes')
  const [chillingMethod, setChillingMethod] = useState('')
  const [freezingInstructions, setFreezingInstructions] = useState('')
  const [defrostingInstructions, setDefrostingInstructions] = useState('')
  const [reheatingInstructions, setReheatingInstructions] = useState('')
  const [hotHoldingRequired, setHotHoldingRequired] = useState(false)
  const [extraCareFlags, setExtraCareFlags] = useState<string[]>([])
  const [ingredients, setIngredients] = useState<IngredientRow[]>([
    { name: '', quantity: '', unit: '', allergens: [] },
  ])

  function addIngredient() {
    setIngredients([...ingredients, { name: '', quantity: '', unit: '', allergens: [] }])
  }

  function removeIngredient(idx: number) {
    setIngredients(ingredients.filter((_, i) => i !== idx))
  }

  function updateIngredient(idx: number, field: keyof IngredientRow, value: any) {
    setIngredients(ingredients.map((ing, i) => (i === idx ? { ...ing, [field]: value } : ing)))
  }

  function toggleAllergen(idx: number, allergen: string) {
    const ing = ingredients[idx]
    const has = ing.allergens.includes(allergen)
    updateIngredient(
      idx,
      'allergens',
      has ? ing.allergens.filter((a) => a !== allergen) : [...ing.allergens, allergen]
    )
  }

  function toggleExtraCare(flag: string) {
    setExtraCareFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]
    )
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Recipe name is required')
      return
    }
    if (!business?.id) {
      toast.error('No business found')
      return
    }

    setSaving(true)
    try {
      // 1. Upsert ingredients by name
      const validIngredients = ingredients.filter((i) => i.name.trim())
      const ingredientIds: Record<string, string> = {}

      for (const ing of validIngredients) {
        // Check if ingredient exists
        const { data: existing } = await supabase
          .from('ingredients')
          .select('id')
          .eq('business_id', business.id)
          .ilike('name', ing.name.trim())
          .single()

        if (existing) {
          // Update allergens
          await supabase
            .from('ingredients')
            .update({ allergens: ing.allergens })
            .eq('id', existing.id)
          ingredientIds[ing.name] = existing.id
        } else {
          const { data: created, error } = await supabase
            .from('ingredients')
            .insert({
              business_id: business.id,
              name: ing.name.trim(),
              allergens: ing.allergens,
            })
            .select('id')
            .single()
          if (error) throw error
          ingredientIds[ing.name] = created.id
        }
      }

      // 2. Create recipe
      const { data: recipe, error: recipeError } = await supabase
        .from('recipes')
        .insert({
          business_id: business.id,
          created_by: profile.id,
          name: name.trim(),
          description: description.trim() || null,
          category,
          instructions: instructions.trim() || null,
          cooking_method: cookingMethod.trim() || null,
          cooking_temp: cookingTemp ? Number(cookingTemp) : null,
          cooking_time: cookingTime ? Number(cookingTime) : null,
          cooking_time_unit: cookingTimeUnit,
          chilling_method: chillingMethod.trim() || null,
          freezing_instructions: freezingInstructions.trim() || null,
          defrosting_instructions: defrostingInstructions.trim() || null,
          reheating_instructions: reheatingInstructions.trim() || null,
          hot_holding_required: hotHoldingRequired,
          extra_care_flags: extraCareFlags,
          active: true,
        })
        .select('id')
        .single()

      if (recipeError) throw recipeError

      // 3. Create recipe_ingredients
      const recipeIngredients = validIngredients.map((ing) => ({
        recipe_id: recipe.id,
        ingredient_id: ingredientIds[ing.name],
        quantity: ing.quantity ? Number(ing.quantity) : null,
        unit: ing.unit.trim() || null,
      }))

      if (recipeIngredients.length > 0) {
        const { error: riError } = await supabase
          .from('recipe_ingredients')
          .insert(recipeIngredients)
        if (riError) throw riError
      }

      toast.success('Recipe created')
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      router.push(`/recipes/${recipe.id}`)
    } catch (err: any) {
      toast.error(err.message || 'Failed to create recipe')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => router.push('/recipes')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader title="New Recipe" description="Add a new recipe to your collection" />
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Basic Info */}
        <Section title="Basic Information">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Recipe name"
                className="text-[13px]"
              />
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none"
              >
                {RECIPE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {RECIPE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description..."
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
            />
          </Field>
          <Field label="Instructions">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Step-by-step instructions..."
              rows={4}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
            />
          </Field>
        </Section>

        {/* Cooking Info */}
        <Section title="Cooking Information">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Cooking Method">
              <Input
                value={cookingMethod}
                onChange={(e) => setCookingMethod(e.target.value)}
                placeholder="e.g. Oven, Grill, Pan fry"
                className="text-[13px]"
              />
            </Field>
            <Field label="Temperature">
              <Input
                type="number"
                value={cookingTemp}
                onChange={(e) => setCookingTemp(e.target.value)}
                placeholder="e.g. 180"
                className="text-[13px]"
              />
            </Field>
            <Field label="Cooking Time">
              <Input
                type="number"
                value={cookingTime}
                onChange={(e) => setCookingTime(e.target.value)}
                placeholder="e.g. 30"
                className="text-[13px]"
              />
            </Field>
            <Field label="Time Unit">
              <select
                value={cookingTimeUnit}
                onChange={(e) => setCookingTimeUnit(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none"
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
              </select>
            </Field>
          </div>
        </Section>

        {/* Ingredients */}
        <Section title="Ingredients">
          <div className="space-y-4">
            {ingredients.map((ing, idx) => (
              <div key={idx} className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <span className="text-[12px] font-medium text-muted-foreground">
                    Ingredient {idx + 1}
                  </span>
                  {ingredients.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-red-500"
                      onClick={() => removeIngredient(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Input
                    value={ing.name}
                    onChange={(e) => updateIngredient(idx, 'name', e.target.value)}
                    placeholder="Name"
                    className="text-[13px]"
                  />
                  <Input
                    type="number"
                    value={ing.quantity}
                    onChange={(e) => updateIngredient(idx, 'quantity', e.target.value)}
                    placeholder="Quantity"
                    className="text-[13px]"
                  />
                  <Input
                    value={ing.unit}
                    onChange={(e) => updateIngredient(idx, 'unit', e.target.value)}
                    placeholder="Unit (g, ml, pcs)"
                    className="text-[13px]"
                  />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-muted-foreground mb-1.5 block">
                    Allergens
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {EU_ALLERGENS.map((a) => {
                      const selected = ing.allergens.includes(a)
                      return (
                        <button
                          key={a}
                          type="button"
                          onClick={() => toggleAllergen(idx, a)}
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors ${
                            selected
                              ? 'bg-red-50 text-red-700 border-red-300'
                              : 'bg-muted/50 text-muted-foreground border-border hover:border-red-200'
                          }`}
                        >
                          {ALLERGEN_LABELS[a]}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={addIngredient}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Ingredient
            </Button>
          </div>
        </Section>

        {/* Safety & Storage */}
        <Section title="Safety & Storage">
          <Field label="Chilling Method">
            <textarea
              value={chillingMethod}
              onChange={(e) => setChillingMethod(e.target.value)}
              placeholder="How to chill this dish..."
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
            />
          </Field>
          <Field label="Freezing Instructions">
            <textarea
              value={freezingInstructions}
              onChange={(e) => setFreezingInstructions(e.target.value)}
              placeholder="How to freeze..."
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
            />
          </Field>
          <Field label="Defrosting Instructions">
            <textarea
              value={defrostingInstructions}
              onChange={(e) => setDefrostingInstructions(e.target.value)}
              placeholder="How to defrost..."
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
            />
          </Field>
          <Field label="Reheating Instructions">
            <textarea
              value={reheatingInstructions}
              onChange={(e) => setReheatingInstructions(e.target.value)}
              placeholder="How to reheat..."
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
            />
          </Field>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="hotHolding"
              checked={hotHoldingRequired}
              onChange={(e) => setHotHoldingRequired(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-emerald-600"
            />
            <label htmlFor="hotHolding" className="text-[13px] text-foreground">
              Hot holding required
            </label>
          </div>
        </Section>

        {/* Extra Care Flags */}
        <Section title="Extra Care Flags">
          <div className="flex flex-wrap gap-2">
            {EXTRA_CARE_OPTIONS.map((opt) => {
              const selected = extraCareFlags.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleExtraCare(opt.value)}
                  className={`inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium border transition-colors ${
                    selected
                      ? 'bg-amber-50 text-amber-700 border-amber-300'
                      : 'bg-muted/50 text-muted-foreground border-border hover:border-amber-200'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </Section>

        {/* Submit */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Recipe'}
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/recipes')}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Layout helpers ── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-5 space-y-4">
      <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-medium text-muted-foreground">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
