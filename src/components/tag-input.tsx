'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { Input } from '@/components/ui/input'
import { normalizeTag, tagSuggestions } from '@/lib/tags'

// Inline tag creation/selection (spec approach A — no tag management screen).
// Autocomplete + normalisation are the duplicate guard: "pasta" matches "Pasta".
export function TagInput({
  value,
  onChange,
}: {
  value: string[]
  onChange: (tags: string[]) => void
}) {
  const business = useAuthStore((s) => s.business)
  const [draft, setDraft] = useState('')

  const { data: existing = [] } = useQuery({
    queryKey: ['tags', business?.id],
    queryFn: async () => {
      if (!business?.id) return []
      const { data, error } = await supabase
        .from('tags')
        .select('id, name')
        .eq('business_id', business.id)
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const suggestions = useMemo(
    () => tagSuggestions(existing, value, draft),
    [existing, value, draft]
  )

  function add(name: string) {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 40) return
    const norm = normalizeTag(trimmed)
    if (value.some((v) => normalizeTag(v) === norm)) {
      setDraft('')
      return
    }
    // prefer the existing tag's canonical casing
    const match = existing.find((t: any) => normalizeTag(t.name) === norm)
    onChange([...value, match ? match.name : trimmed])
    setDraft('')
  }

  function remove(name: string) {
    onChange(value.filter((v) => v !== name))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground border border-border"
          >
            {t}
            <button type="button" onClick={() => remove(t)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(draft)
            }
          }}
          placeholder={value.length === 0 ? 'Add tags (e.g. Pasta, Specials)...' : 'Add tag...'}
          className="h-8 w-44 text-[13px]"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="space-y-1">
          {draft.trim() === '' && (
            <p className="text-[11px] text-muted-foreground">Existing tags — tap to add</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {suggestions.slice(0, 24).map((t: any) => (
              <button
                key={t.id}
                type="button"
                onClick={() => add(t.name)}
                className="inline-flex items-center rounded-full bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground border border-border hover:border-emerald-300 hover:text-foreground transition-colors"
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
