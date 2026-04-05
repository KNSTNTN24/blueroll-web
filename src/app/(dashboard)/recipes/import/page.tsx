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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import {
  ArrowLeft,
  Sparkles,
  FileText,
  FileImage,
  Upload,
  Loader2,
  Trash2,
  Plus,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

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
  ingredients: ParsedIngredient[]
}

const EMPTY_PARSED: ParsedRecipe = {
  name: '',
  description: '',
  category: '',
  instructions: '',
  cooking_method: '',
  cooking_temp: '',
  cooking_time: '',
  cooking_time_unit: 'mins',
  ingredients: [],
}

export default function ImportRecipePage() {
  const { profile, business } = useAuthStore()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState('text')
  const [textInput, setTextInput] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedRecipe | null>(null)

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // Remove data URL prefix
        const base64 = result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const importMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = {}

      if (activeTab === 'text') {
        if (!textInput.trim()) throw new Error('Please enter recipe text')
        payload.text = textInput.trim()
      } else if (activeTab === 'pdf') {
        if (!pdfFile) throw new Error('Please select a PDF file')
        payload.pdf_base64 = await fileToBase64(pdfFile)
      } else if (activeTab === 'photo') {
        if (!photoFile) throw new Error('Please select a photo')
        payload.image_base64 = await fileToBase64(photoFile)
        payload.image_mime = photoFile.type
      }

      const { data, error } = await supabase.functions.invoke('import-recipe', {
        body: payload,
      })

      if (error) throw error
      return data as ParsedRecipe
    },
    onSuccess: (data) => {
      setParsed({
        ...data,
        ingredients: data.ingredients ?? [],
        cooking_time_unit: data.cooking_time_unit || 'mins',
      })
      toast.success('Recipe parsed successfully')
    },
    onError: (err) => toast.error(err.message),
  })

  const updateParsedField = (field: keyof ParsedRecipe, value: string) => {
    if (!parsed) return
    setParsed((prev) => (prev ? { ...prev, [field]: value } : null))
  }

  const updateParsedIngredient = (
    index: number,
    field: keyof ParsedIngredient,
    value: string | string[]
  ) => {
    if (!parsed) return
    setParsed((prev) => {
      if (!prev) return null
      return {
        ...prev,
        ingredients: prev.ingredients.map((ing, i) =>
          i === index ? { ...ing, [field]: value } : ing
        ),
      }
    })
  }

  const toggleParsedAllergen = (index: number, allergen: string) => {
    if (!parsed) return
    setParsed((prev) => {
      if (!prev) return null
      return {
        ...prev,
        ingredients: prev.ingredients.map((ing, i) => {
          if (i !== index) return ing
          const has = ing.allergens.includes(allergen)
          return {
            ...ing,
            allergens: has
              ? ing.allergens.filter((a) => a !== allergen)
              : [...ing.allergens, allergen],
          }
        }),
      }
    })
  }

  const addParsedIngredient = () => {
    if (!parsed) return
    setParsed((prev) =>
      prev
        ? {
            ...prev,
            ingredients: [
              ...prev.ingredients,
              { name: '', quantity: '', unit: '', allergens: [] },
            ],
          }
        : null
    )
  }

  const removeParsedIngredient = (index: number) => {
    if (!parsed) return
    setParsed((prev) =>
      prev
        ? { ...prev, ingredients: prev.ingredients.filter((_, i) => i !== index) }
        : null
    )
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!parsed || !business?.id || !profile?.id)
        throw new Error('Not ready to save')
      if (!parsed.name.trim()) throw new Error('Name is required')
      if (!parsed.category) throw new Error('Category is required')

      const validIngredients = parsed.ingredients.filter((i) => i.name.trim())

      // Upsert ingredients
      const ingredientIds: string[] = []
      for (const ing of validIngredients) {
        const normalizedName = ing.name.trim().toLowerCase()
        const { data: existing } = await supabase
          .from('ingredients')
          .select('id')
          .eq('business_id', business.id)
          .ilike('name', normalizedName)
          .limit(1)
          .maybeSingle()

        if (existing) {
          await supabase
            .from('ingredients')
            .update({ allergens: ing.allergens })
            .eq('id', existing.id)
          ingredientIds.push(existing.id)
        } else {
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
          name: parsed.name.trim(),
          description: parsed.description.trim() || null,
          category: parsed.category,
          instructions: parsed.instructions.trim(),
          cooking_method: parsed.cooking_method.trim() || null,
          cooking_temp: parsed.cooking_temp
            ? parseFloat(parsed.cooking_temp)
            : null,
          cooking_time: parsed.cooking_time
            ? parseInt(parsed.cooking_time, 10)
            : null,
          cooking_time_unit: parsed.cooking_time_unit || null,
          business_id: business.id,
          created_by: profile.id,
        })
        .select('id')
        .single()

      if (recipeError) throw recipeError

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
      toast.success('Recipe saved')
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
          title="AI Recipe Import"
          description="Import a recipe from text, PDF, or photo using AI"
        />
      </div>

      {!parsed ? (
        <div className="max-w-2xl space-y-6">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v ?? "")}>
            <TabsList>
              <TabsTrigger value="text">
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Text
              </TabsTrigger>
              <TabsTrigger value="pdf">
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                PDF
              </TabsTrigger>
              <TabsTrigger value="photo">
                <FileImage className="mr-1.5 h-3.5 w-3.5" />
                Photo
              </TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="mt-4">
              <div className="space-y-3">
                <Label className="text-[13px]">Paste recipe text</Label>
                <Textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Paste the full recipe text here including ingredients, method, and any allergen information..."
                  className="min-h-[240px] text-[13px]"
                />
              </div>
            </TabsContent>

            <TabsContent value="pdf" className="mt-4">
              <div className="space-y-3">
                <Label className="text-[13px]">Upload PDF</Label>
                <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
                  <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="mb-2 text-[13px] text-muted-foreground">
                    Select a PDF file containing a recipe
                  </p>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                    className="text-[13px]"
                  />
                  {pdfFile && (
                    <p className="mt-2 text-[12px] text-emerald-600">
                      Selected: {pdfFile.name}
                    </p>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="photo" className="mt-4">
              <div className="space-y-3">
                <Label className="text-[13px]">Upload Photo</Label>
                <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
                  <FileImage className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="mb-2 text-[13px] text-muted-foreground">
                    Take a photo or upload an image of a recipe
                  </p>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                    className="text-[13px]"
                  />
                  {photoFile && (
                    <p className="mt-2 text-[12px] text-emerald-600">
                      Selected: {photoFile.name}
                    </p>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <Button
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {importMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {importMutation.isPending ? 'Parsing...' : 'Import with AI'}
          </Button>
        </div>
      ) : (
        <div className="space-y-6 max-w-2xl">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            <p className="text-[13px] text-emerald-800">
              AI parsed the recipe below. Review and edit before saving.
            </p>
          </div>

          {/* Editable parsed fields */}
          <div className="rounded-lg border border-border bg-white p-4 space-y-4">
            <h3 className="text-[14px] font-medium">Basic Information</h3>
            <div className="space-y-3">
              <div>
                <Label className="text-[13px]">Name *</Label>
                <Input
                  value={parsed.name}
                  onChange={(e) => updateParsedField('name', e.target.value)}
                  className="mt-1 text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[13px]">Description</Label>
                <Input
                  value={parsed.description}
                  onChange={(e) =>
                    updateParsedField('description', e.target.value)
                  }
                  className="mt-1 text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[13px]">Category *</Label>
                <div className="mt-1">
                  <Select
                    value={parsed.category}
                    onValueChange={(v) => updateParsedField('category', v ?? '')}
                  >
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
                  value={parsed.instructions}
                  onChange={(e) =>
                    updateParsedField('instructions', e.target.value)
                  }
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
                  value={parsed.cooking_method}
                  onChange={(e) =>
                    updateParsedField('cooking_method', e.target.value)
                  }
                  className="mt-1 text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[13px]">Temperature (&deg;C)</Label>
                <Input
                  type="number"
                  value={parsed.cooking_temp}
                  onChange={(e) =>
                    updateParsedField('cooking_temp', e.target.value)
                  }
                  className="mt-1 text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[13px]">Cooking Time</Label>
                <Input
                  type="number"
                  value={parsed.cooking_time}
                  onChange={(e) =>
                    updateParsedField('cooking_time', e.target.value)
                  }
                  className="mt-1 text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[13px]">Time Unit</Label>
                <div className="mt-1">
                  <Select
                    value={parsed.cooking_time_unit}
                    onValueChange={(v) =>
                      updateParsedField('cooking_time_unit', v ?? '')
                    }
                  >
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
                onClick={addParsedIngredient}
                size="sm"
                variant="outline"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Ingredient
              </Button>
            </div>

            <div className="space-y-4">
              {parsed.ingredients.map((ing, index) => (
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
                            updateParsedIngredient(
                              index,
                              'name',
                              e.target.value
                            )
                          }
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
                            updateParsedIngredient(
                              index,
                              'quantity',
                              e.target.value
                            )
                          }
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
                            updateParsedIngredient(
                              index,
                              'unit',
                              e.target.value
                            )
                          }
                          className="mt-1 text-[13px]"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeParsedIngredient(index)}
                      className="mt-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

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
                            onClick={() =>
                              toggleParsedAllergen(index, allergen)
                            }
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

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setParsed(null)}
            >
              Start Over
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending ||
                !parsed.name.trim() ||
                !parsed.category
              }
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {saveMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save Recipe
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
