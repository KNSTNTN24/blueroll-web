'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Recipe thumbnail sourced from the recipe name — free, no backend:
 *  1. TheMealDB search → real photo of the dish if it's a known meal.
 *  2. Otherwise a Pollinations-generated food photo (consistent style, any name).
 *  3. Falls back to a striped placeholder if both fail to load.
 *
 * Plain <img> is intentional: sources are external + generative with an onError
 * fallback, which next/image (fixed remotePatterns, no error fallback) can't cover.
 */

export function pollinationsUrl(name: string, w = 640, h = 400, seed = 4): string {
  const prompt = `professional food photography of ${name.trim()}, plated dish, overhead, soft natural light, appetising, shallow depth of field, neutral background`
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&seed=${seed}`
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

async function fetchMealThumb(name: string): Promise<string | null> {
  try {
    const q = name.trim().slice(0, 60)
    const r = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`)
    if (!r.ok) return null
    const j = await r.json()
    const meal = j?.meals?.[0]
    if (!meal?.strMeal || !meal?.strMealThumb) return null
    // Only use a real photo when the dish name genuinely matches — TheMealDB's
    // fuzzy search would otherwise return an unrelated dish's photo.
    const a = norm(meal.strMeal), b = norm(name)
    if (b.length >= 4 && (a === b || a.includes(b) || b.includes(a))) return meal.strMealThumb
    return null
  } catch {
    return null
  }
}

interface RecipeThumbProps {
  name: string
  className?: string
  /** requested generated-image width/height + seed (deterministic per recipe) */
  w?: number
  h?: number
  seed?: number
  /** if set, use this URL directly (e.g. a stored/uploaded image) and skip lookup */
  src?: string | null
}

export function RecipeThumb({ name, className, w, h, seed, src }: RecipeThumbProps) {
  const [failed, setFailed] = useState(false)
  // Pollinations often times out on the first (generating) request, then serves
  // the cached image on a repeat hit — so retry a couple of times before giving up.
  const [attempt, setAttempt] = useState(0)
  const enabled = !src && !!name?.trim()

  const { data, isLoading } = useQuery({
    queryKey: ['recipe-thumb', name?.trim().toLowerCase()],
    queryFn: () => fetchMealThumb(name),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })

  if (failed || (!src && !name?.trim())) {
    return (
      <div className={cn('flex items-center justify-center bg-[repeating-linear-gradient(135deg,#f1f2f4,#f1f2f4_8px,#eceef0_8px,#eceef0_16px)] text-[#b0b5bc]', className)}>
        <ImageIcon className="h-5 w-5" strokeWidth={1.6} />
      </div>
    )
  }

  // Wait for the meal lookup so we load one image, not generated-then-real.
  if (enabled && isLoading) {
    return <div className={cn('animate-pulse bg-[#eef0f2]', className)} />
  }

  const base = src || data || pollinationsUrl(name, w, h, seed)
  // Cache-buster on retry forces the browser to re-request (params Pollinations ignores for generation).
  const url = attempt > 0 ? `${base}${base.includes('?') ? '&' : '?'}cb=${attempt}` : base
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      loading="lazy"
      onError={() => {
        if (attempt < 3) setTimeout(() => setAttempt((a) => a + 1), 1500)
        else setFailed(true)
      }}
      className={cn('object-cover', className)}
    />
  )
}
