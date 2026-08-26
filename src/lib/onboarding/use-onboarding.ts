'use client'

import { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type OnboardingStatus = 'idle' | 'building' | 'done' | 'error'

export interface OnboardingResult {
  templates: number
  dishes: number
}

/** Reads a File as a base64 data URL (what onboard-extract-checks expects for `images`). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Phase 1 (checks-only): orchestrates the client side of the onboarding assistant's
 * checklists-first flow. Collects photos/text of the client's paper checks, then calls
 * onboard-extract-checks + onboard-build. No menu/voice support yet — see Task brief Phase 2.
 */
export function useOnboarding() {
  const [checksMedia, setChecksMedia] = useState<File[]>([])
  const [checksText, setChecksText] = useState('')
  const [result, setResult] = useState<OnboardingResult | null>(null)
  const [status, setStatus] = useState<OnboardingStatus>('idle')

  const addChecksMedia = useCallback((files: File[]) => {
    setChecksMedia((prev) => [...prev, ...files])
  }, [])

  const addChecksText = useCallback((text: string) => {
    setChecksText((prev) => (prev ? `${prev}\n${text}` : text))
  }, [])

  const runBuild = useCallback(async () => {
    setStatus('building')
    setResult(null)

    const images = await Promise.all(checksMedia.map(fileToDataUrl))

    const { data: extractData, error: extractError } = await supabase.functions.invoke(
      'onboard-extract-checks',
      { body: { images, text: checksText || undefined } },
    )
    if (extractError) {
      setStatus('error')
      return
    }
    const checklists = extractData?.checklists ?? []

    const { data: buildData, error: buildError } = await supabase.functions.invoke(
      'onboard-build',
      { body: { checklists, dishes: [] } },
    )
    if (buildError) {
      setStatus('error')
      return
    }

    setResult({
      templates: buildData?.templates ?? 0,
      dishes: buildData?.dishes ?? 0,
    })
    setStatus('done')
  }, [checksMedia, checksText])

  return {
    step: 'checks' as const,
    addChecksMedia,
    addChecksText,
    runBuild,
    result,
    status,
  }
}
