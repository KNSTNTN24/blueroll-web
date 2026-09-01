'use client'

import { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { buildBriefs, type Answers } from './questionnaire'

export type OnboardingStatus = 'idle' | 'generating' | 'preview' | 'building' | 'done' | 'error'

export interface OnboardingResult {
  templates: number
  dishes: number
}

export interface GeneratedChecklist {
  name: string
  frequency?: string
  assigned_roles?: string[]
  items: unknown[]
}

/** Reads a File as a base64 data URL, unmodified. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/** Decode → downscale → re-encode an image to a JPEG data URL via canvas.
 * Rejects if the browser can't decode the file. */
function downscaleToJpegDataUrl(file: File, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const longest = Math.max(img.width, img.height) || 1
      const scale = Math.min(1, maxDim / longest)
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas is not available'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image'))
    }
    img.src = url
  })
}

/** Produce the base64 data URL that onboard-extract-checks expects for `images`.
 * Phone photos are multiple MB and can be HEIC — both break the request (oversized
 * body → the browser's fetch fails; HEIC → the vision model rejects it). Downscaling
 * and re-encoding to JPEG in the browser fixes both; if the file can't be decoded
 * (e.g. a PDF or an unsupported codec) we fall back to sending the raw bytes. */
async function fileToDataUrl(file: File): Promise<string> {
  if (file.type.startsWith('image/')) {
    try {
      return await downscaleToJpegDataUrl(file, 1600, 0.82)
    } catch {
      /* fall through to raw bytes */
    }
  }
  return readAsDataUrl(file)
}

/**
 * Phase 1 (checks-only): orchestrates the client side of the onboarding assistant's
 * checklists-first flow. Collects photos/text of the client's paper checks, then calls
 * onboard-extract-checks + onboard-build. No menu/voice support yet — see Task brief Phase 2.
 */
/** Pull the readable message out of a Supabase Functions error, including the
 * function's own `{ error }` response body when present (FunctionsHttpError
 * carries the Response in `.context`). */
async function describeInvokeError(error: unknown): Promise<string> {
  const err = error as { message?: string; context?: Response }
  try {
    if (err?.context && typeof err.context.json === 'function') {
      const body = await err.context.clone().json()
      if (body?.error) return String(body.error)
    }
  } catch {
    /* fall through to the generic message */
  }
  return err?.message ?? 'Unknown error'
}

export function useOnboarding() {
  const [checksMedia, setChecksMedia] = useState<File[]>([])
  const [checksText, setChecksText] = useState('')
  const [result, setResult] = useState<OnboardingResult | null>(null)
  const [status, setStatus] = useState<OnboardingStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [generated, setGenerated] = useState<GeneratedChecklist[] | null>(null)

  const addChecksMedia = useCallback((files: File[]) => {
    setChecksMedia((prev) => [...prev, ...files])
  }, [])

  const addChecksText = useCallback((text: string) => {
    setChecksText((prev) => (prev ? `${prev}\n${text}` : text))
  }, [])

  const runBuild = useCallback(async () => {
    setStatus('building')
    setResult(null)
    setErrorMessage(null)

    try {
      const images = await Promise.all(checksMedia.map(fileToDataUrl))

      const { data: extractData, error: extractError } = await supabase.functions.invoke(
        'onboard-extract-checks',
        { body: { images, text: checksText || undefined } },
      )
      if (extractError) {
        setErrorMessage(`Reading your photos failed: ${await describeInvokeError(extractError)}`)
        setStatus('error')
        return
      }
      const checklists = extractData?.checklists ?? []
      if (checklists.length === 0) {
        setErrorMessage('We could not read any checks from those photos. Try clearer, well-lit photos.')
        setStatus('error')
        return
      }

      const { data: buildData, error: buildError } = await supabase.functions.invoke(
        'onboard-build',
        { body: { checklists, dishes: [] } },
      )
      if (buildError) {
        setErrorMessage(`Building your site failed: ${await describeInvokeError(buildError)}`)
        setStatus('error')
        return
      }

      setResult({
        templates: buildData?.templates ?? 0,
        dishes: buildData?.dishes ?? 0,
      })
      setStatus('done')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong preparing your photos.')
      setStatus('error')
    }
  }, [checksMedia, checksText])

  const generate = useCallback(async (answers: Answers) => {
    setStatus('generating')
    setErrorMessage(null)
    setGenerated(null)

    try {
      const briefs = buildBriefs(answers)
      if (briefs.length === 0) {
        setErrorMessage('Pick at least one checklist to create.')
        setStatus('error')
        return
      }

      const { data, error } = await supabase.functions.invoke('onboard-generate', { body: { briefs } })
      if (error) {
        setErrorMessage(`Generating checklists failed: ${await describeInvokeError(error)}`)
        setStatus('error')
        return
      }

      const checklists = (data?.checklists ?? []) as GeneratedChecklist[]
      if (checklists.length === 0) {
        setErrorMessage('We could not generate checklists from those answers.')
        setStatus('error')
        return
      }

      setGenerated(checklists)
      setStatus('preview')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong.')
      setStatus('error')
    }
  }, [])

  const confirmBuild = useCallback(async (checklists: GeneratedChecklist[]) => {
    setStatus('building')
    setResult(null)
    setErrorMessage(null)

    try {
      const { data, error } = await supabase.functions.invoke('onboard-build', { body: { checklists, dishes: [] } })
      if (error) {
        setErrorMessage(`Building your site failed: ${await describeInvokeError(error)}`)
        setStatus('error')
        return
      }

      setResult({ templates: data?.templates ?? 0, dishes: data?.dishes ?? 0 })
      setStatus('done')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong.')
      setStatus('error')
    }
  }, [])

  return {
    step: 'checks' as const,
    addChecksMedia,
    addChecksText,
    runBuild,
    result,
    status,
    errorMessage,
    generate,
    generated,
    confirmBuild,
  }
}
