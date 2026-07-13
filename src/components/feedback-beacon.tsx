'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { usePathname } from 'next/navigation'
import {
  Bug,
  Check,
  ChevronLeft,
  CircleHelp,
  Heart,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  Send,
  Star,
  X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import {
  FEEDBACK_COPY,
  FEEDBACK_KINDS,
  feedbackMessageError,
  type FeedbackKind,
} from '@/lib/feedback'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const kindIcons = {
  question: CircleHelp,
  feature: Lightbulb,
  bug: Bug,
  feedback: Heart,
} satisfies Record<FeedbackKind, typeof CircleHelp>

const kindStyles = {
  question: 'bg-[#eaf3ff] text-[#3478c8]',
  feature: 'bg-amber-tint text-amber',
  bug: 'bg-warn-tint text-warn',
  feedback: 'bg-[#f8eefa] text-[#9b51a8]',
} satisfies Record<FeedbackKind, string>

type BeaconView = 'home' | 'form' | 'success'

const PANEL_EXIT_MS = 220
const CONTENT_EXIT_MS = 130

export function FeedbackBeacon() {
  const pathname = usePathname()
  const user = useAuthStore((state) => state.user)
  const profile = useAuthStore((state) => state.profile)
  const business = useAuthStore((state) => state.business)
  const currentSiteId = useAuthStore((state) => state.currentSiteId)
  const sites = useAuthStore((state) => state.sites)
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<BeaconView>('home')
  const [contentVisible, setContentVisible] = useState(true)
  const [kind, setKind] = useState<FeedbackKind | null>(null)
  const [message, setMessage] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  const reset = useCallback(() => {
    setView('home')
    setContentVisible(true)
    setKind(null)
    setMessage('')
    setRating(null)
    setError(null)
  }, [])

  const close = useCallback(() => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    setOpen(false)
    triggerRef.current?.focus()
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      setMounted(false)
      reset()
    }, PANEL_EXIT_MS)
  }, [reset])

  const openPanel = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setMounted(true)
    animationFrameRef.current = requestAnimationFrame(() => setOpen(true))
  }, [])

  const transitionTo = useCallback((nextView: BeaconView, nextKind?: FeedbackKind) => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    setContentVisible(false)
    transitionTimerRef.current = setTimeout(() => {
      if (nextKind) setKind(nextKind)
      setView(nextView)
      animationFrameRef.current = requestAnimationFrame(() => setContentVisible(true))
    }, CONTENT_EXIT_MS)
  }, [])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [close, open])

  useEffect(() => {
    if (open && view === 'form' && contentVisible) textareaRef.current?.focus()
  }, [contentVisible, open, view])

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!kind) return

    const validationError = feedbackMessageError(message)
    if (validationError) {
      setError(validationError)
      return
    }
    if (!user || !profile || !business) {
      setError('Your account is still loading. Please try again in a moment.')
      return
    }

    setSubmitting(true)
    setError(null)
    const activeSite = sites.find((site) => site.id === currentSiteId)
    const metadata = {
      business_name: business.name,
      site_name: activeSite?.name ?? null,
      user_email: profile.email,
      user_name: profile.full_name,
      role: profile.role,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      user_agent: navigator.userAgent,
      referrer: document.referrer || null,
    }
    const { error: invokeError } = await supabase.functions.invoke('send-feedback', {
      body: {
        kind,
        message: message.trim(),
        rating: kind === 'feedback' ? rating : null,
        siteId: currentSiteId,
        pageUrl: window.location.href,
        pagePath: pathname,
        metadata,
      },
    })
    setSubmitting(false)

    if (invokeError) {
      setError('We could not send this right now. Please try again.')
      return
    }
    transitionTo('success')
  }

  const selectedCopy = kind ? FEEDBACK_COPY[kind] : null
  const contentHeight = view === 'home'
    ? 'h-[390px]'
    : view === 'success'
      ? 'h-[280px]'
      : kind === 'feedback'
        ? 'h-[390px]'
        : 'h-[330px]'

  return (
    <>
      {mounted && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Help and feedback"
          aria-hidden={!open}
          className={cn(
            'feedback-beacon fixed bottom-20 right-3 z-[70] flex max-h-[calc(100vh-6rem)] w-[calc(100vw-24px)] max-w-[390px] origin-bottom-right flex-col overflow-hidden rounded-[18px] border border-[#e1e4e8] bg-card shadow-[0_10px_30px_rgba(16,24,40,.12),0_30px_80px_-24px_rgba(16,24,40,.38)] transition-[opacity,transform,box-shadow] duration-[220ms] ease-[cubic-bezier(.22,1,.36,1)] sm:bottom-24 sm:right-6',
            open
              ? 'translate-y-0 scale-100 opacity-100'
              : 'pointer-events-none translate-y-2 scale-[.97] opacity-0 shadow-none',
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
            {view === 'form' ? (
              <button
                type="button"
                onClick={() => { setError(null); transitionTo('home') }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-[color,background-color,transform] duration-200 hover:-translate-x-0.5 hover:bg-secondary hover:text-foreground"
                aria-label="Back"
              >
                <ChevronLeft className="h-[18px] w-[18px]" />
              </button>
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-tint text-brand-deep">
                <MessageCircle className="h-[17px] w-[17px]" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-foreground transition-opacity duration-150">
                {view === 'success' ? 'Message sent' : view === 'form' ? selectedCopy?.label : 'Help & feedback'}
              </div>
              {view === 'home' && <div className="text-[11.5px] text-muted-foreground">Talk directly to the Blueroll team</div>}
            </div>
            <button
              type="button"
              onClick={close}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-[color,background-color,transform] duration-200 hover:rotate-6 hover:bg-secondary hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-[17px] w-[17px]" />
            </button>
          </div>

          <div className={cn('min-h-0 overflow-y-auto transition-[height] duration-300 ease-[cubic-bezier(.22,1,.36,1)]', contentHeight)}>
            <div className={cn(
              'transition-[opacity,transform] duration-150 ease-[cubic-bezier(.22,1,.36,1)]',
              contentVisible ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0',
            )}>
            {view === 'home' && (
              <div className="p-3">
                <div className="px-1 pb-3 pt-1">
                  <div className="text-[18px] font-semibold tracking-[-0.02em] text-foreground">How can we help?</div>
                  <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                    Send a message from anywhere in the app. We automatically include the page and account context.
                  </p>
                </div>
                <div className="space-y-1.5">
                  {FEEDBACK_KINDS.map((itemKind) => {
                    const copy = FEEDBACK_COPY[itemKind]
                    const Icon = kindIcons[itemKind]
                    return (
                      <button
                        key={itemKind}
                        type="button"
                        onClick={() => {
                          setMessage('')
                          setRating(null)
                          setError(null)
                          transitionTo('form', itemKind)
                        }}
                        className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-2.5 py-2.5 text-left transition-[border-color,background-color,transform,box-shadow] duration-200 hover:translate-x-0.5 hover:border-border hover:bg-accent hover:shadow-[0_5px_18px_-14px_rgba(16,24,40,.45)]"
                      >
                        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105', kindStyles[itemKind])}>
                          <Icon className="h-[18px] w-[18px] transition-transform duration-200 group-hover:scale-110" strokeWidth={1.8} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-foreground">{copy.label}</span>
                          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{copy.description}</span>
                        </span>
                        <ChevronLeft className="h-4 w-4 rotate-180 text-[#b0b5bc] transition-transform duration-200 group-hover:translate-x-0.5" />
                      </button>
                    )
                  })}
                </div>
                <div className="mt-3 border-t border-border px-1 pt-3 text-[11px] text-muted-foreground">
                  We reply to <span className="font-medium text-[#4f5660]">{profile?.email ?? 'your account email'}</span>.
                </div>
              </div>
            )}

            {view === 'form' && kind && selectedCopy && (
              <form onSubmit={submit} className="p-4">
                <label htmlFor="feedback-message" className="text-[13px] font-semibold text-foreground">
                  {selectedCopy.prompt}
                </label>
                <p className="mt-1 text-[11.5px] leading-4 text-muted-foreground">
                  Current page and account details will be attached automatically.
                </p>
                {kind === 'feedback' && (
                  <div className="mt-4">
                    <div className="mb-2 text-[11.5px] font-medium text-[#535963]">Optional rating</div>
                    <div className="flex gap-1" aria-label="Rating">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setRating(value)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg transition-[background-color,transform] duration-200 hover:scale-110 hover:bg-amber-tint active:scale-95"
                          aria-label={`${value} out of 5`}
                        >
                          <Star
                            className={cn(
                              'h-[19px] w-[19px] transition-[color,fill,transform] duration-200',
                              rating && value <= rating ? 'scale-110 fill-[#d79b32] text-[#d79b32]' : 'scale-100 text-[#c5c9cf]',
                            )}
                            strokeWidth={1.7}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Textarea
                  ref={textareaRef}
                  id="feedback-message"
                  value={message}
                  onChange={(event) => { setMessage(event.target.value); if (error) setError(null) }}
                  placeholder={selectedCopy.placeholder}
                  maxLength={4000}
                  className="mt-4 min-h-[132px] resize-none text-[13px] leading-5"
                />
                <div className="mt-1.5 flex min-h-5 items-start justify-between gap-3">
                  <span className="text-[11.5px] text-warn" role="alert">{error}</span>
                  <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-[#a0a5ad]">{message.length}/4000</span>
                </div>
                <Button type="submit" className="mt-3 w-full" disabled={submitting}>
                  {submitting ? <LoaderCircle className="animate-spin" /> : <Send />}
                  {submitting ? 'Sending…' : 'Send to Blueroll'}
                </Button>
              </form>
            )}

            {view === 'success' && selectedCopy && (
              <div className="flex flex-col items-center px-7 py-9 text-center">
                <span className="animate-beacon-check flex h-14 w-14 items-center justify-center rounded-full bg-brand-tint text-brand-deep">
                  <Check className="h-7 w-7" strokeWidth={2} />
                </span>
                <div className="mt-4 text-[17px] font-semibold text-foreground">Thank you</div>
                <p className="mt-1.5 max-w-[280px] text-[12.5px] leading-5 text-muted-foreground">{selectedCopy.success}</p>
                <div className="mt-5 flex w-full gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setMessage('')
                      setRating(null)
                      setError(null)
                      transitionTo('home')
                    }}
                  >Send another</Button>
                  <Button type="button" className="flex-1" onClick={close}>Done</Button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => { if (open) close(); else openPanel() }}
        aria-label={open ? 'Close help and feedback' : 'Open help and feedback'}
        aria-expanded={open}
        className="feedback-beacon fixed bottom-4 right-3 z-[69] flex h-12 items-center gap-2 rounded-full bg-[#171a20] px-4 text-[13px] font-semibold text-white shadow-[0_8px_24px_rgba(16,24,40,.28)] transition-[transform,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#242830] hover:shadow-[0_12px_30px_rgba(16,24,40,.32)] active:translate-y-0 active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:bottom-6 sm:right-6"
      >
        <span className="relative h-[18px] w-[18px]">
          <MessageCircle className={cn('absolute inset-0 h-[18px] w-[18px] transition-[opacity,transform] duration-200', open ? 'rotate-90 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100')} />
          <X className={cn('absolute inset-0 h-[18px] w-[18px] transition-[opacity,transform] duration-200', open ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-75 opacity-0')} />
        </span>
        <span className="hidden min-w-[34px] sm:grid">
          <span className={cn('col-start-1 row-start-1 transition-[opacity,transform] duration-200', open ? '-translate-y-1 opacity-0' : 'translate-y-0 opacity-100')}>Help</span>
          <span className={cn('col-start-1 row-start-1 transition-[opacity,transform] duration-200', open ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0')}>Close</span>
        </span>
      </button>
    </>
  )
}
