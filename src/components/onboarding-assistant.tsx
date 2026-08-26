'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CircleCheck, LoaderCircle, Sparkles, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/use-auth'
import { useOnboarding } from '@/lib/onboarding/use-onboarding'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * Gate: only render the assistant for entitled accounts that have not yet
 * built any live checklists. Renders null while loading or once the
 * account has active templates (it has already onboarded).
 */
export function OnboardingAssistant() {
  const { isSubscribed, business } = useAuth()
  const [eligible, setEligible] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function checkEligibility() {
      if (!isSubscribed || !business?.id) {
        if (!cancelled) setEligible(false)
        return
      }
      const { count, error } = await supabase
        .from('checklist_templates')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', business.id)
        .eq('active', true)
      if (cancelled) return
      if (error) {
        setEligible(false)
        return
      }
      setEligible((count ?? 0) === 0)
    }
    void checkEligibility()
    return () => { cancelled = true }
  }, [isSubscribed, business?.id])

  if (!eligible) return null
  return <OnboardingPanel />
}

/**
 * The checks-only (Phase 1) onboarding widget UI. Consumes `useOnboarding()`
 * directly so it can be unit-tested without the auth/db gate above.
 */
export function OnboardingPanel() {
  const { addChecksMedia, addChecksText, runBuild, status, result } = useOnboarding()
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [notes, setNotes] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    if (selected.length === 0) return
    setFiles((prev) => [...prev, ...selected])
    addChecksMedia(selected)
  }

  function handleSubmit() {
    // Commit the free-text notes once, in full, right before building —
    // addChecksText appends to the hook's running text on every call, so
    // calling it on every keystroke would duplicate content.
    const trimmed = notes.trim()
    if (trimmed) addChecksText(trimmed)
    void runBuild()
  }

  const canSubmit = files.length > 0 && status !== 'building'

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Set up your checklists"
          className="fixed bottom-20 left-3 z-[70] flex max-h-[calc(100vh-6rem)] w-[calc(100vw-24px)] max-w-[390px] flex-col overflow-hidden rounded-[18px] border border-[#e1e4e8] bg-card shadow-[0_10px_30px_rgba(16,24,40,.12),0_30px_80px_-24px_rgba(16,24,40,.38)] sm:bottom-24 sm:left-6"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-tint text-brand-deep">
              <Sparkles className="h-[17px] w-[17px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-foreground">Set up your checklists</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-[17px] w-[17px]" />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto p-4">
            {status === 'done' && result ? (
              <div className="flex flex-col items-center px-3 py-6 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-tint text-brand-deep">
                  <CircleCheck className="h-7 w-7" strokeWidth={2} />
                </span>
                <div className="mt-4 text-[17px] font-semibold text-foreground">
                  {result.templates} checklists are live
                </div>
                <p className="mt-1.5 max-w-[280px] text-[12.5px] leading-5 text-muted-foreground">
                  We built these from the photos you sent. You can fine-tune them any time.
                </p>
                <Link href="/checklists" className={cn(buttonVariants(), 'mt-5 w-full transition-none')}>
                  Go to checklists
                </Link>
              </div>
            ) : (
              <>
                <p className="text-[13px] font-semibold text-foreground">
                  Send photos of the checks you use now — temperature sheets, cleaning schedules,
                  opening/closing. Phone photos are fine.
                </p>

                <label
                  htmlFor="onboarding-checks-upload"
                  className="mt-3 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted-foreground hover:border-brand hover:bg-accent"
                >
                  {files.length > 0
                    ? `${files.length} file${files.length === 1 ? '' : 's'} selected`
                    : 'Upload photos or PDFs'}
                </label>
                <input
                  ref={fileInputRef}
                  id="onboarding-checks-upload"
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  aria-label="Upload photos of your checks"
                  onChange={handleFileChange}
                  className="sr-only"
                />

                <label htmlFor="onboarding-checks-notes" className="mt-4 block text-[11.5px] font-medium text-[#535963]">
                  Anything else worth mentioning? (optional)
                </label>
                <Textarea
                  id="onboarding-checks-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="E.g. we also check delivery temperatures every morning."
                  className="mt-1.5 min-h-[90px] resize-none text-[13px] leading-5"
                />

                {status === 'error' && (
                  <p className="mt-2 text-[11.5px] text-warn" role="alert">
                    We could not set up your site right now. Please try again.
                  </p>
                )}

                <Button
                  type="button"
                  className="mt-4 w-full transition-none"
                  disabled={!canSubmit}
                  onClick={handleSubmit}
                >
                  {status === 'building' ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                  {status === 'building' ? 'Setting up your site…' : 'Set up my site'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close onboarding assistant' : 'Open onboarding assistant'}
        aria-expanded={open}
        className={cn(
          'fixed bottom-4 left-3 z-[69] flex h-12 items-center gap-2 rounded-full bg-brand px-4 text-[13px] font-semibold text-white shadow-[0_8px_24px_rgba(16,24,40,.28)] hover:opacity-90 active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:bottom-6 sm:left-6',
        )}
      >
        <Sparkles className="h-[18px] w-[18px]" />
        <span className="hidden sm:inline">Set up my checklists</span>
      </button>
    </>
  )
}
