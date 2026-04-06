'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import {
  ArrowLeft, FileText, FileImage, Upload, Sparkles, Save, Loader2,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  RECIPE_CATEGORIES,
  RECIPE_CATEGORY_LABELS,
  EU_ALLERGENS,
  ALLERGEN_LABELS,
} from '@/lib/constants'

type TabId = 'text' | 'pdf' | 'photo'

interface ParsedIngredient {
  name: string
  quantity: string
  unit: string
  allergens: string[]
}

interface ParsedRecipe {
  name: string
  description: string
  category: string
  instructions: string
  cooking_method: string
  cooking_temp: string
  cooking_time: string
  cooking_time_unit: string
  chilling_method: string
  freezing_instructions: string
  defrosting_instructions: string
  reheating_instructions: string
  hot_holding_required: boolean
  extra_care_flags: string[]
  ingredients: ParsedIngredient[]
}

const emptyParsed: ParsedRecipe = {
  name: '',
  description: '',
  category: 'main',
  instructions: '',
  cooking_method: '',
  cooking_temp: '',
  cooking_time: '',
  cooking_time_unit: 'minutes',
  chilling_method: '',
  freezing_instructions: '',
  defrosting_instructions: '',
  reheating_instructions: '',
  hot_holding_required: false,
  extra_care_flags: [],
  ingredients: [],
}

export default function ImportRecipePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const business = useAuthStore((s) => s.business)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<TabId>('text')
  const [textInput, setTextInput] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [parsed, setParsed] = useState<ParsedRecipe | null>(null)

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'text', label: 'Text', icon: FileText },
    { id: 'pdf', label: 'PDF', icon: FileText },
    { id: 'photo', label: 'Photo', icon: FileImage },
  ]

  async function handleImport() {
    if (tab === 'text' && !textInput.trim()) {
      toast.error('Please paste recipe text')
      return
    }
    if ((tab === 'pdf' || tab === 'photo') && !file) {
      toast.error('Please select a file')
      return
    }

    setImporting(true)
    try {
      let payload: any = { type: tab }

      if (tab === 'text') {
        payload.text = textInput
      } else if (file) {
        const buffer = await file.arrayBuffer()
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )
        payload.file = base64
        payload.filename = file.name
        payload.mimetype = file.type
      }

      const { data, error } = await supabase.functions.invoke('import-recipe', {
        body: payload,
      })

      if (error) throw error

      // Map response to parsed recipe
      const r = data.recipe ?? data
      setParsed({
        name: r.name ?? '',
        description: r.description ?? '',
        category: r.category ?? 'main',
        instructions: r.instructions ?? '',
        cooking_method: r.cooking_method ?? '',
        cooking_temp: r.cooking_temp?.toString() ?? '',
        cooking_time: r.cooking_time?.toString() ?? '',
        cooking_time_unit: r.cooking_time_unit ?? 'minutes',
        chilling_method: r.chilling_method ?? '',
        freezing_instructions: r.freezing_instructions ?? '',
        defrosting_instructions: r.defrosting_instructions ?? '',
        reheating_instructions: r.reheating_instructions ?? '',
        hot_holding_required: r.hot_holding_required ?? false,
        extra_care_flags: r.extra_care_flags ?? [],
        ingredients: (r.ingredients ?? []).map((i: any) => ({
          name: i.name ?? '',
          quantity: i.quantity?.toString() ?? '',
          unit: i.unit ?? '',
          allergens: i.allergens ?? [],
        })),
      })
      toast.success('Recipe parsed successfully')
    } catch (err: any) {
      toast.error(err.message || 'Failed to import recipe')
    } finally {
      setImporting(false)
    }
  }

  function updateParsed(field: keyof ParsedRecipe, value: any) {
    if (!parsed) return
    setParsed({ ...parsed, [field]: value })
  }

  function updateIngredient(idx: number, field: keyof ParsedIngredient, value: any) {
    if (!parsed) return
    const updated = parsed.ingredients.map((ing, i) =>
      i === idx ? { ...ing, [field]: value } : ing
    )
    setParsed({ ...parsed, ingredients: updated })
  }

  function toggleIngredientAllergen(idx: number, allergen: string) {
    if (!parsed) return
    const ing = parsed.ingredients[idx]
    const has = ing.allergens.includes(allergen)
    updateIngredient(
      idx,
      'allergens',
      has ? ing.allergens.filter((a) => a !== allergen) : [...ing.allergens, allergen]
    )
  }

  async function handleSave() {
    if (!parsed || !parsed.name.trim()) {
      toast.error('Recipe name is required')
      return
    }
    if (!business?.id) {
      toast.error('No business found')
      return
    }

    setSaving(true)
    try {
      // Upsert ingredients
      const validIngredients = parsed.ingredients.filter((i) => i.name.trim())
      const ingredientIds: Record<string, string> = {}

      for (const ing of validIngredients) {
        const { data: existing } = await supabase
          .from('ingredients')
          .select('id')
          .eq('business_id', business.id)
          .ilike('name', ing.name.trim())
          .single()

        if (existing) {
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

      // Create recipe
      const { data: recipe, error: recipeError } = await supabase
        .from('recipes')
        .insert({
          business_id: business.id,
          name: parsed.name.trim(),
          description: parsed.description.trim() || null,
          category: parsed.category,
          instructions: parsed.instructions.trim() || null,
          cooking_method: parsed.cooking_method.trim() || null,
          cooking_temp: parsed.cooking_temp ? Number(parsed.cooking_temp) : null,
          cooking_time: parsed.cooking_time ? Number(parsed.cooking_time) : null,
          cooking_time_unit: parsed.cooking_time_unit,
          chilling_method: parsed.chilling_method.trim() || null,
          freezing_instructions: parsed.freezing_instructions.trim() || null,
          defrosting_instructions: parsed.defrosting_instructions.trim() || null,
          reheating_instructions: parsed.reheating_instructions.trim() || null,
          hot_holding_required: parsed.hot_holding_required,
          extra_care_flags: parsed.extra_care_flags,
          active: true,
        })
        .select('id')
        .single()

      if (recipeError) throw recipeError

      // Create recipe_ingredients
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

      toast.success('Recipe saved')
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
      router.push(`/recipes/${recipe.id}`)
    } catch (err: any) {
      toast.error(err.message || 'Failed to save recipe')
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
        <PageHeader
          title="AI Recipe Import"
          description="Import a recipe from text, PDF, or photo using AI"
        />
      </div>

      {!parsed ? (
        <div className="max-w-2xl space-y-6">
          {/* Tabs */}
          <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Input area */}
          {tab === 'text' && (
            <div className="space-y-3">
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Paste your recipe text here..."
                rows={12}
                className="w-full rounded-lg border border-border bg-background px-4 py-3 text-[13px] text-foreground outline-none resize-none"
              />
            </div>
          )}

          {(tab === 'pdf' || tab === 'photo') && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-muted/20 py-16 cursor-pointer hover:border-emerald-300 transition-colors"
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-[13px] font-medium text-foreground">
                  {file ? file.name : `Click to upload ${tab === 'pdf' ? 'a PDF' : 'a photo'}`}
                </p>
                <p className="text-[12px] text-muted-foreground mt-1">
                  {tab === 'pdf' ? 'PDF files up to 10MB' : 'JPG, PNG, or HEIC up to 10MB'}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={tab === 'pdf' ? '.pdf' : 'image/*'}
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          )}

          <Button
            onClick={handleImport}
            disabled={importing}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {importing ? 'Importing...' : 'Import with AI'}
          </Button>
        </div>
      ) : (
        /* ── Parsed result form ── */
        <div className="max-w-3xl space-y-6">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-[13px] text-emerald-800">
            Recipe parsed successfully. Review and edit the fields below, then save.
          </div>

          <Section title="Basic Information">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                <Input
                  value={parsed.name}
                  onChange={(e) => updateParsed('name', e.target.value)}
                  className="text-[13px]"
                />
              </Field>
              <Field label="Category">
                <select
                  value={parsed.category}
                  onChange={(e) => updateParsed('category', e.target.value)}
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
                value={parsed.description}
                onChange={(e) => updateParsed('description', e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
              />
            </Field>
            <Field label="Instructions">
              <textarea
                value={parsed.instructions}
                onChange={(e) => updateParsed('instructions', e.target.value)}
                rows={4}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
              />
            </Field>
          </Section>

          <Section title="Cooking Information">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Cooking Method">
                <Input
                  value={parsed.cooking_method}
                  onChange={(e) => updateParsed('cooking_method', e.target.value)}
                  className="text-[13px]"
                />
              </Field>
              <Field label="Temperature">
                <Input
                  type="number"
                  value={parsed.cooking_temp}
                  onChange={(e) => updateParsed('cooking_temp', e.target.value)}
                  className="text-[13px]"
                />
              </Field>
              <Field label="Cooking Time">
                <Input
                  type="number"
                  value={parsed.cooking_time}
                  onChange={(e) => updateParsed('cooking_time', e.target.value)}
                  className="text-[13px]"
                />
              </Field>
              <Field label="Time Unit">
                <select
                  value={parsed.cooking_time_unit}
                  onChange={(e) => updateParsed('cooking_time_unit', e.target.value)}
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
            <div className="space-y-3">
              {parsed.ingredients.map((ing, idx) => (
                <div key={idx} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="grid grid-cols-3 gap-3">
                    <Input
                      value={ing.name}
                      onChange={(e) => updateIngredient(idx, 'name', e.target.value)}
                      placeholder="Name"
                      className="text-[13px]"
                    />
                    <Input
                      value={ing.quantity}
                      onChange={(e) => updateIngredient(idx, 'quantity', e.target.value)}
                      placeholder="Quantity"
                      className="text-[13px]"
                    />
                    <Input
                      value={ing.unit}
                      onChange={(e) => updateIngredient(idx, 'unit', e.target.value)}
                      placeholder="Unit"
                      className="text-[13px]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {EU_ALLERGENS.map((a) => {
                      const selected = ing.allergens.includes(a)
                      return (
                        <button
                          key={a}
                          type="button"
                          onClick={() => toggleIngredientAllergen(idx, a)}
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors ${
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
              ))}
            </div>
          </Section>

          {/* Safety */}
          <Section title="Safety & Storage">
            <Field label="Chilling Method">
              <textarea
                value={parsed.chilling_method}
                onChange={(e) => updateParsed('chilling_method', e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
              />
            </Field>
            <Field label="Freezing Instructions">
              <textarea
                value={parsed.freezing_instructions}
                onChange={(e) => updateParsed('freezing_instructions', e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
              />
            </Field>
            <Field label="Defrosting Instructions">
              <textarea
                value={parsed.defrosting_instructions}
                onChange={(e) => updateParsed('defrosting_instructions', e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
              />
            </Field>
            <Field label="Reheating Instructions">
              <textarea
                value={parsed.reheating_instructions}
                onChange={(e) => updateParsed('reheating_instructions', e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none resize-none"
              />
            </Field>
          </Section>

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving...' : 'Save Recipe'}
            </Button>
            <Button variant="outline" onClick={() => setParsed(null)}>
              Re-import
            </Button>
            <Button variant="outline" onClick={() => router.push('/recipes')}>
              Cancel
            </Button>
          </div>
        </div>
      )}
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
