'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Search, Plus, Sparkles, Eye, Pencil, Trash2, Image as ImageIcon } from 'lucide-react'
import { InspectionEmpty, EmptyPrimary, EmptySecondary, RecipesArt } from '@/components/shared/inspection-empty'
import { HeaderButton } from '@/components/shared/header-button'
import { cn } from '@/lib/utils'
import { ALLERGEN_LABELS, type EUAllergen } from '@/lib/constants'
import { effectiveDietary } from '@/lib/dietary'
import { getRecipeTags, normalizeTag } from '@/lib/tags'
import { dishesForRecipe, convertDishesToManual } from '@/lib/dishes'

export default function RecipesPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const business = useAuthStore((s) => s.business)
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string[]>([])

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
          ),
          recipe_tags ( tag:tags (id, name) )
        `)
        .eq('business_id', business.id)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('tags').select('id, name').eq('business_id', business.id).order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const filtered = recipes.filter((r: any) => {
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase())
    const recipeNorms = getRecipeTags(r).map((t) => normalizeTag(t.name))
    const matchTags = tagFilter.every((f) => recipeNorms.includes(normalizeTag(f)))
    return matchSearch && matchTags
  })

  function getAllergens(recipe: any): string[] {
    const set = new Set<string>()
    recipe.recipe_ingredients?.forEach((ri: any) => {
      ri.ingredient?.allergens?.forEach((a: string) => set.add(a))
    })
    return Array.from(set)
  }

  async function handleDelete(id: string) {
    // Menu dishes source their allergens from this recipe; the FK blocks the
    // delete rather than letting them silently lose their evidence base.
    const dishes = await dishesForRecipe(supabase, id)
    if (dishes.length > 0) {
      const one = dishes.length === 1
      const names = dishes.map((d) => `• ${d.name}`).join('\n')
      const ok = confirm(
        `${dishes.length} dish${one ? '' : 'es'} on the menu ${one ? 'takes its' : 'take their'} allergens from this recipe:\n\n${names}\n\n` +
        `Deleting it will convert ${one ? 'it' : 'them'} to hand-declared dish${one ? '' : 'es'}: today's allergens are kept, but ${one ? 'it stops' : 'they stop'} being traceable to ingredients and you are recorded as attesting to them.\n\nContinue?`
      )
      if (!ok) return
      try {
        await convertDishesToManual(supabase, dishes, profile?.id ?? null, profile?.full_name ?? profile?.email ?? 'Unknown')
      } catch {
        return toast.error('Could not convert the affected dishes — recipe not deleted')
      }
    } else if (!confirm('Delete this recipe? This cannot be undone.')) return

    const { error } = await supabase.from('recipes').delete().eq('id', id)
    if (error) { toast.error('Failed to delete recipe'); return }
    toast.success(dishes.length ? `Recipe deleted · ${dishes.length} dish${dishes.length === 1 ? '' : 'es'} now hand-declared` : 'Recipe deleted')
    qc.invalidateQueries({ queryKey: ['recipes'] })
    qc.invalidateQueries({ queryKey: ['dishes'] })
  }

  function toggleTag(name: string) {
    setTagFilter((prev) => prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name])
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-foreground">Recipes</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">Manage your recipe collection{recipes.length > 0 ? ` · ${recipes.length} dishes` : ''}</p>
        </div>
        {isManager && (
          <div className="flex items-center gap-2.5">
            <button onClick={() => router.push('/recipes/import')}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-[11px] border border-input bg-card px-4 py-[11px] text-[14px] font-semibold text-foreground transition-colors hover:bg-accent">
              <Sparkles className="h-4 w-4 text-brand" strokeWidth={1.8} />
              AI Import
            </button>
            <HeaderButton onClick={() => router.push('/recipes/new')}>
              <Plus className="h-4 w-4" strokeWidth={2} />
              New Recipe
            </HeaderButton>
          </div>
        )}
      </div>

      {/* Toolbar: search + tag pills — hidden in the empty state */}
      {recipes.length > 0 && (
      <div className="space-y-3">
        <div className="relative max-w-[380px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search recipes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-[38px] w-full rounded-[10px] border border-input bg-card pl-9 pr-3 text-[13px] text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-brand focus:ring-[3px] focus:ring-[rgba(31,157,99,.12)]"
          />
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <CatPill active={tagFilter.length === 0} onClick={() => setTagFilter([])}>All</CatPill>
            {allTags.map((t: any) => (
              <CatPill key={t.id} active={tagFilter.includes(t.name)} onClick={() => toggleTag(t.name)}>{t.name}</CatPill>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">Loading recipes…</div>
      ) : recipes.length === 0 ? (
        <InspectionEmpty illustration={RecipesArt} badge="Powers your allergen matrix & HACCP evidence"
          title="Build your recipe library"
          sentence="Every dish you add fills in allergens and HACCP control methods automatically.">
          {isManager && <>
            <EmptyPrimary onClick={() => router.push('/recipes/new')}><Plus className="h-4 w-4" strokeWidth={2} /> Add your first recipe</EmptyPrimary>
            <EmptySecondary onClick={() => router.push('/recipes/import')}><Sparkles className="h-4 w-4 text-brand" strokeWidth={1.8} /> Import with AI</EmptySecondary>
          </>}
        </InspectionEmpty>
      ) : filtered.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-card px-6 py-12 text-center text-[14px] font-semibold text-foreground shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          {search ? <>No recipes match &ldquo;{search}&rdquo;.</> : 'No recipes match your filters.'}
        </div>
      ) : (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
          {filtered.map((recipe: any) => {
            const allergens = getAllergens(recipe)
            const dietary = effectiveDietary(recipe, allergens)
            const tags = getRecipeTags(recipe)
            const shownAllergens = allergens.slice(0, 3)
            const extra = allergens.length - shownAllergens.length
            return (
              <div key={recipe.id} className="group flex flex-col rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,.04)] transition-shadow hover:shadow-[0_4px_14px_-8px_rgba(16,24,40,.18)]">
                {/* Header */}
                <div className="flex items-start gap-3 p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] bg-[repeating-linear-gradient(135deg,#f1f2f4,#f1f2f4_6px,#eceef0_6px,#eceef0_12px)] text-muted-foreground">
                    <ImageIcon className="h-4 w-4" strokeWidth={1.7} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold leading-snug text-foreground" style={{ textWrap: 'pretty' } as any}>{recipe.name}</p>
                    {tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {tags.slice(0, 3).map((t: any) => (
                          <span key={t.id ?? t.name} className="inline-flex rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">{t.name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    recipe.active ? 'bg-brand-tint text-brand-deep' : 'bg-secondary text-muted-foreground')}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', recipe.active ? 'bg-brand' : 'bg-[#9aa0a8]')} />
                    {recipe.active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="mx-4 border-t border-border" />

                {/* Allergens + dietary */}
                <div className="space-y-2.5 px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-1 w-[62px] shrink-0 text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Allergens</span>
                    <div className="flex flex-wrap gap-1.5">
                      {allergens.length === 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-brand-deep"><span className="h-1.5 w-1.5 rounded-full bg-brand" />None</span>
                      ) : (
                        <>
                          {shownAllergens.map((a) => (
                            <span key={a} className="inline-flex items-center rounded-md bg-[#f8f0e8] px-1.5 py-0.5 text-[11px] font-medium text-[#9a5b2a]">
                              {ALLERGEN_LABELS[a as EUAllergen] ?? a}
                            </span>
                          ))}
                          {extra > 0 && <span className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">+{extra}</span>}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="mt-1 w-[62px] shrink-0 text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Dietary</span>
                    <div className="flex flex-wrap gap-1.5">
                      {dietary.length === 0 ? (
                        <span className="text-[12px] text-[#b0b5bc]">—</span>
                      ) : dietary.map((d) => (
                        <span key={d} className="inline-flex items-center rounded-md bg-brand-tint px-1.5 py-0.5 text-[11px] font-medium text-brand-deep">{d}</span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mx-4 border-t border-border" />

                {/* Footer actions */}
                <div className="flex items-center gap-2 p-3">
                  <button onClick={() => router.push(`/recipes/${recipe.id}`)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-input bg-card py-2 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-accent">
                    <Eye className="h-3.5 w-3.5" strokeWidth={1.8} /> View
                  </button>
                  {isManager && (
                    <>
                      <button onClick={() => router.push(`/recipes/edit/${recipe.id}`)}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-input bg-card py-2 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-accent">
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} /> Edit
                      </button>
                      <button onClick={() => handleDelete(recipe.id)} aria-label="Delete recipe"
                        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[9px] border border-input bg-card text-muted-foreground transition-colors hover:border-transparent hover:bg-warn-tint hover:text-warn">
                        <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CatPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn(
      'rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium transition-colors',
      active ? 'bg-foreground text-white' : 'border border-input bg-card text-[#5c626b] hover:bg-accent',
    )}>{children}</button>
  )
}
