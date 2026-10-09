'use client'

import Script from 'next/script'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { buildPayload, isFlagged, validateForm, type Answers, type Corrective, type FormData, type FormItem } from '@/lib/whatsapp/tg-form'

// Minimal typing of the Telegram WebApp surface we use (https://core.telegram.org/bots/webapps).
interface TgMainButton {
  setParams(p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }): void
  onClick(cb: () => void): void
  offClick(cb: () => void): void
  showProgress(leaveActive?: boolean): void
  hideProgress(): void
  hide(): void
}
interface TgWebApp {
  initData: string
  themeParams: Partial<Record<'bg_color' | 'text_color' | 'hint_color' | 'button_color' | 'button_text_color' | 'secondary_bg_color' | 'destructive_text_color', string>>
  ready(): void
  expand(): void
  close(): void
  MainButton: TgMainButton
}
declare global { interface Window { Telegram?: { WebApp?: TgWebApp } } }

const API = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channel-form`

const MSG = {
  outside: 'Open this form from Telegram.',
  expired: 'This form has expired — send /checks for a new one.',
  changed: 'This checklist was updated — send /checks for a new form.',
  forbidden: "You don't have access to this form.",
  unauthorized: "Couldn't verify your Telegram session. Close and open the form again from Telegram.",
  generic: 'Something went wrong. Please try again.',
  retry: "Couldn't save your answers. Please press Submit again.",
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'message'; text: string }
  | { kind: 'form'; data: FormData }
  | { kind: 'done' }

function statusMessage(status: number, error: unknown): string {
  if (status === 401) return MSG.unauthorized
  if (status === 403) return MSG.forbidden
  if (status === 410) return error === 'changed' ? MSG.changed : MSG.expired
  return MSG.generic
}

const rangeHint = (i: FormItem) => {
  const u = i.unit ?? '°C'
  if (i.min != null && i.max != null) return `${i.min}–${i.max} ${u}`
  if (i.min != null) return `≥ ${i.min} ${u}`
  if (i.max != null) return `≤ ${i.max} ${u}`
  return u
}

export function TgForm({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [answers, setAnswers] = useState<Answers>({})
  const [corrective, setCorrective] = useState<Corrective>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<{ text: string; items?: string[] } | null>(null)
  const [theme, setTheme] = useState<CSSProperties>({})
  const webApp = useRef<TgWebApp | null>(null)
  const started = useRef(false)

  const init = useCallback(() => {
    if (started.current) return
    started.current = true
    const wa = window.Telegram?.WebApp
    if (!wa || !wa.initData) { setPhase({ kind: 'message', text: MSG.outside }); return }
    webApp.current = wa
    wa.ready()
    wa.expand()
    const tp = wa.themeParams ?? {}
    setTheme({
      '--tg-bg': tp.bg_color ?? 'var(--background)',
      '--tg-text': tp.text_color ?? 'var(--foreground)',
      '--tg-hint': tp.hint_color ?? 'var(--muted-foreground)',
      '--tg-card': tp.secondary_bg_color ?? 'var(--card)',
      '--tg-accent': tp.button_color ?? 'var(--primary)',
      '--tg-accent-text': tp.button_text_color ?? 'var(--primary-foreground)',
      '--tg-warn': tp.destructive_text_color ?? 'var(--warn)',
    } as CSSProperties)
    if (!token) { setPhase({ kind: 'message', text: MSG.expired }); return }
    fetch(API, { method: 'GET', headers: { 'X-Telegram-Init-Data': wa.initData, 'X-Form-Token': token }, cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (r.ok && body && Array.isArray(body.items)) setPhase({ kind: 'form', data: body as FormData })
        else setPhase({ kind: 'message', text: statusMessage(r.status, body?.error) })
      })
      .catch(() => setPhase({ kind: 'message', text: MSG.generic }))
  }, [token])

  const onScriptError = useCallback(() => {
    if (started.current) return
    started.current = true
    setPhase({ kind: 'message', text: MSG.outside })
  }, [])

  const items = useMemo(() => (phase.kind === 'form' ? phase.data.items : []), [phase])
  const v = useMemo(() => validateForm(items, answers, corrective), [items, answers, corrective])

  const submit = useCallback(async () => {
    const wa = webApp.current
    if (!wa || phase.kind !== 'form' || submitting || !v.valid) return
    setSubmitting(true)
    setSubmitError(null)
    wa.MainButton.showProgress(false)
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': wa.initData },
        body: JSON.stringify(buildPayload(token, items, answers, corrective)),
      })
      const body = await r.json().catch(() => null)
      if (r.ok) {
        setPhase({ kind: 'done' })
        setTimeout(() => wa.close(), 1500)
      } else if (r.status === 400 && (body?.error === 'missing' || body?.error === 'corrective_required')) {
        setSubmitError({
          text: body.error === 'missing' ? 'Please answer:' : 'Choose an action taken for:',
          items: Array.isArray(body.items) ? body.items.map(String) : undefined,
        })
      } else if (r.status === 500 && body?.error === 'retry') {
        setSubmitError({ text: MSG.retry })
      } else if (r.status === 401 || r.status === 403 || r.status === 410) {
        setPhase({ kind: 'message', text: statusMessage(r.status, body?.error) })
      } else {
        setSubmitError({ text: MSG.generic })
      }
    } catch {
      setSubmitError({ text: MSG.generic })
    } finally {
      wa.MainButton.hideProgress()
      setSubmitting(false)
    }
  }, [phase, submitting, v.valid, token, items, answers, corrective])

  // Telegram MainButton: always calls the latest submit; visible only while the form is shown.
  const submitRef = useRef(submit)
  useEffect(() => { submitRef.current = submit }, [submit])
  useEffect(() => {
    const wa = webApp.current
    if (!wa) return
    const handler = () => { void submitRef.current() }
    wa.MainButton.onClick(handler)
    return () => wa.MainButton.offClick(handler)
  }, [phase.kind])
  useEffect(() => {
    const wa = webApp.current
    if (!wa) return
    if (phase.kind !== 'form') { wa.MainButton.hide(); return }
    wa.MainButton.setParams({ text: 'Submit', is_visible: true, is_active: v.valid && !submitting })
  }, [phase.kind, v.valid, submitting])

  const setAnswer = (id: string, value: string | boolean) => setAnswers((a) => ({ ...a, [id]: value }))
  const setCorr = (id: string, patch: Partial<{ action: string; details: string }>) =>
    setCorrective((c) => ({ ...c, [id]: { action: c[id]?.action ?? '', details: c[id]?.details ?? '', ...patch } }))

  return (
    <div style={theme} className="min-h-screen bg-[var(--tg-bg,var(--background))] text-[var(--tg-text,var(--foreground))]">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={init} onError={onScriptError} />
      <main className="mx-auto max-w-lg px-4 py-5">
        {phase.kind === 'loading' && <p className="text-sm text-[var(--tg-hint,var(--muted-foreground))]">Loading…</p>}
        {phase.kind === 'message' && <p className="mt-10 text-center text-base">{phase.text}</p>}
        {phase.kind === 'done' && <p className="mt-10 text-center text-xl font-semibold">Done ✓</p>}
        {phase.kind === 'form' && (
          <>
            <h1 className="text-lg font-semibold leading-tight">{phase.data.templateName}</h1>
            <p className="mb-4 text-sm text-[var(--tg-hint)]">{phase.data.siteName}</p>
            <div className="space-y-3">
              {items.map((i) => (
                <ItemField
                  key={i.id} item={i} value={answers[i.id]} invalid={v.invalid.includes(i.id)}
                  flagged={isFlagged(i, answers[i.id])} corrective={corrective[i.id]}
                  actions={phase.data.correctiveActions}
                  onChange={(val) => setAnswer(i.id, val)} onCorrective={(p) => setCorr(i.id, p)}
                />
              ))}
            </div>
            {submitError && (
              <div role="alert" className="mt-4 rounded-lg border border-[var(--tg-warn)] p-3 text-sm text-[var(--tg-warn)]">
                <p>{submitError.text}</p>
                {submitError.items && <ul className="mt-1 list-disc pl-5">{submitError.items.map((n) => <li key={n}>{n}</li>)}</ul>}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function ItemField({ item, value, invalid, flagged, corrective, actions, onChange, onCorrective }: {
  item: FormItem
  value: string | boolean | undefined
  invalid: boolean
  flagged: boolean
  corrective: { action: string; details: string } | undefined
  actions: FormData['correctiveActions']
  onChange: (v: string | boolean) => void
  onCorrective: (p: Partial<{ action: string; details: string }>) => void
}) {
  const inputId = `i-${item.id}`
  const label = (
    <label htmlFor={inputId} className="block text-sm font-medium">
      {item.name}{item.required && <span className="text-[var(--tg-warn)]"> *</span>}
    </label>
  )
  const field = 'w-full rounded-md border border-[var(--input)] bg-[var(--tg-bg)] px-3 py-2 text-base text-[var(--tg-text)] outline-none focus:border-[var(--tg-accent)]'
  return (
    <div className={`rounded-lg bg-[var(--tg-card)] p-3 ${flagged ? 'ring-2 ring-[var(--tg-warn)]' : ''}`}>
      {item.type === 'tick' ? (
        <label htmlFor={inputId} className="flex items-center gap-3 text-sm font-medium">
          <input id={inputId} type="checkbox" className="size-5 accent-[var(--tg-accent)]" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span>{item.name}{item.required && <span className="text-[var(--tg-warn)]"> *</span>}</span>
        </label>
      ) : label}

      {item.type === 'temperature' && (
        <div className="mt-2">
          <input
            id={inputId} type="text" inputMode="decimal" pattern="-?[0-9]{1,3}([.,][0-9]{1,2})?" autoComplete="off"
            className={field} placeholder={rangeHint(item)} value={typeof value === 'string' ? value : ''}
            aria-invalid={invalid} onChange={(e) => onChange(e.target.value)}
          />
          <p className={`mt-1 text-xs ${invalid ? 'text-[var(--tg-warn)]' : 'text-[var(--tg-hint)]'}`}>
            {invalid ? 'Enter a number, e.g. 3.5 or -18' : rangeHint(item)}
          </p>
        </div>
      )}

      {item.type === 'yes_no' && (
        <div id={inputId} role="radiogroup" className="mt-2 grid grid-cols-2 gap-2">
          {(['yes', 'no'] as const).map((opt) => (
            <button
              key={opt} type="button" role="radio" aria-checked={value === opt} onClick={() => onChange(opt)}
              className={`rounded-md border py-2 text-sm font-medium ${value === opt ? 'border-[var(--tg-accent)] bg-[var(--tg-accent)] text-[var(--tg-accent-text)]' : 'border-[var(--input)] bg-[var(--tg-bg)]'}`}
            >
              {opt === 'yes' ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      )}

      {item.type === 'text' && (
        <textarea id={inputId} rows={2} maxLength={500} className={`mt-2 ${field}`} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
      )}

      {flagged && (
        <div className="mt-3 space-y-2 border-t border-[var(--input)] pt-3">
          <label htmlFor={`${inputId}-a`} className="block text-sm font-medium text-[var(--tg-warn)]">Out of range — action taken *</label>
          <select id={`${inputId}-a`} required className={field} value={corrective?.action ?? ''} onChange={(e) => onCorrective({ action: e.target.value })}>
            <option value="" disabled>Choose an action…</option>
            {actions.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
          <textarea
            rows={2} maxLength={300} placeholder="Details (optional)" className={field}
            value={corrective?.details ?? ''} onChange={(e) => onCorrective({ details: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}
