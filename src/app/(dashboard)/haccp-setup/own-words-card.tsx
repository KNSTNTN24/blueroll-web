'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { findField } from '@/lib/haccp-pack/methods'
import { AssistantError, assistantDraftMethod, type DraftMethodResult } from '@/lib/haccp-setup/api'
import { asOwnWords, draftNotice, SKIP } from '@/lib/haccp-setup/own-words'
import type { AnswerValue, OwnWordsAnswer, Question } from '@/lib/haccp-setup/types'

// "In your own words" → plan text (design: AI-Answer.dc.html). The owner always has the last word on text and ticks.

const MAX = 1500
const STATE_LABEL = { yes: 'You said so', no: 'You said no', confirm: 'Confirm below' } as const

export function OwnWordsCard({ question, position, initial, venueType, taken, onConfirm, onDraft, onBack, draftMethod = assistantDraftMethod }: {
  question: Question
  position: string
  initial: AnswerValue | undefined
  venueType: string | undefined
  /** Points another answer already sets — not offered here. */
  taken: Set<string>
  onConfirm: (v: AnswerValue) => void
  onDraft?: (v: AnswerValue | undefined) => void
  onBack?: () => void
  draftMethod?: (method: string, text: string, venueType: string | undefined) => Promise<DraftMethodResult>
}) {
  const saved = asOwnWords(initial)
  const [text, setText] = useState(saved?.text ?? '')
  const [draft, setDraft] = useState<string | null>(saved ? saved.draft : null)
  const [ticks, setTicks] = useState<Record<string, boolean>>(saved?.ticks ?? {})
  const [result, setResult] = useState<DraftMethodResult | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const value: OwnWordsAnswer | null = draft !== null ? { text, draft, ticks } : null
  useEffect(() => { onDraft?.(value ?? undefined) }, [draft, ticks]) // eslint-disable-line react-hooks/exhaustive-deps

  if (question.answer.kind !== 'own_words') return null
  const spec = question.answer
  const points = spec.ticks.filter((id) => !taken.has(id))

  const write = async () => {
    setBusy(true); setError(null)
    try {
      const r = await draftMethod(question.method, text, venueType)
      if (!r.draft.length) {
        setError(draftNotice(r))
        return
      }
      setResult(r)
      setDraft(r.draft.join('\n'))
      setTicks(Object.fromEntries(r.ticks.filter((t) => points.includes(t.id)).map((t) => [t.id, t.state === 'yes'])))
      setConfirmed(false); setEditing(false)
    } catch (e) {
      setError(e instanceof AssistantError ? e.message : 'The assistant is not available right now.')
    } finally {
      setBusy(false)
    }
  }
  const stateOf = (id: string) => result?.ticks.find((t) => t.id === id)?.state
  const confirm = result?.confirm && points.includes(result.confirm.id) ? result.confirm : null

  return (
    <section aria-labelledby={`q-${question.id}`} className="flex flex-col gap-3.5 rounded-[14px] border border-[#e9eaed] bg-white p-5">
      <div className="text-[12px] text-[#5f6670]">{position}</div>
      <h2 id={`q-${question.id}`} className="text-[20px] font-bold leading-snug tracking-[-0.3px]">{question.text}</h2>

      <div className="flex flex-col gap-1">
        <div className="text-[12px] font-bold uppercase tracking-[1.2px] text-[#1f7a52]">In your own words</div>
        <p className="text-[13px] text-[#5f6670]">Write it the way you&rsquo;d explain it to a new chef. Bullet points, shorthand and typos are fine.</p>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">{spec.label}</span>
        <textarea value={text} maxLength={MAX} rows={4} placeholder={spec.placeholder}
          onChange={(e) => setText(e.target.value)}
          className="rounded-[10px] border border-[#e2e4e8] p-3 text-[14px] leading-normal outline-none focus:border-[#1f9d63]" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={write} disabled={!text.trim() || busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-[#1f9d63] px-4 text-[13.5px] font-bold text-white disabled:opacity-50">
          <Sparkles className="h-4 w-4" aria-hidden />{busy ? 'Writing…' : draft !== null ? 'Write it again' : 'Write it for my plan'}
        </button>
      </div>
      {error && (
        <div role="alert" className="flex flex-col gap-2 rounded-[10px] bg-[#fdf6e9] p-3 text-[13px] text-[#8a5a0c]">
          <span>{error}</span>
          {text.trim() && draft === null && (
            <button type="button" onClick={() => { setDraft(text.trim()); setTicks({}); setEditing(true) }}
              className="self-start font-semibold underline">Use my words as written</button>
          )}
        </div>
      )}

      {draft !== null && (
        <div className="flex flex-col gap-3 rounded-[12px] border border-[#cfe8db] bg-[#f3faf6] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-bold uppercase tracking-[1.2px] text-[#1f7a52]">For your HACCP Plan</div>
            <button type="button" onClick={() => setEditing(!editing)} className="min-h-9 text-[12.5px] font-semibold text-[#1f7a52]">
              {editing ? 'Done editing' : 'Edit text'}
            </button>
          </div>
          {editing ? (
            <textarea value={draft} rows={5} maxLength={2000} onChange={(e) => setDraft(e.target.value)} aria-label="Plan text"
              className="rounded-[10px] border border-[#cfe8db] bg-white p-3 text-[14px] leading-normal" />
          ) : (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] leading-normal">
              {draft.split('\n').filter((l) => l.trim()).map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}

          {confirm && (
            <div className="flex flex-col gap-2 rounded-[10px] border border-[#f0dcb4] bg-white p-3">
              <div className="text-[12px] font-bold text-[#8a5a0c]">One thing to confirm</div>
              <p className="text-[14px]">{confirm.question}</p>
              <div className="flex gap-2">
                {[true, false].map((v) => (
                  <button key={String(v)} type="button" aria-pressed={confirmed && ticks[confirm.id] === v}
                    onClick={() => { setTicks((t) => ({ ...t, [confirm.id]: v })); setConfirmed(true) }}
                    className={`min-h-10 rounded-[10px] border px-3.5 text-[13px] font-semibold ${confirmed && ticks[confirm.id] === v ? 'border-[#1f9d63] bg-[#f3faf6]' : 'border-[#e2e4e8] bg-white'}`}>
                    {v ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {points.length > 0 && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[12px] font-bold text-[#3b3f47]">Also ticks in your pack</legend>
              {points.map((id) => {
                const s = stateOf(id)
                return (
                  <label key={id} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[13.5px]">
                    <input type="checkbox" checked={ticks[id] === true} onChange={(e) => setTicks((t) => ({ ...t, [id]: e.target.checked }))}
                      className="h-[18px] w-[18px] accent-[#1f9d63]" />
                    <span className="flex-1">{findField(id)?.label ?? id}</span>
                    {s && <span className="text-[12px] text-[#5f6670]">{STATE_LABEL[s]}</span>}
                  </label>
                )
              })}
            </fieldset>
          )}
          {result && draftNotice(result) && <p className="text-[12px] text-[#8a5a0c]">{draftNotice(result)}</p>}
          {result && result.sources.length > 0 && (
            <p className="text-[12px] text-[#5f6670]">Checked against: {result.sources.map((s) => `${s.source} — ${s.title}`).join('; ')}.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
        <button type="button" onClick={() => onConfirm(SKIP)} className="min-h-11 px-3 text-[13px] font-semibold text-[#5f6670]">Skip for now</button>
        <div className="flex gap-2">
          {onBack && <button type="button" onClick={onBack} className="min-h-11 rounded-[10px] border border-[#e2e4e8] bg-white px-4 text-[13.5px] font-semibold">Back</button>}
          <button type="button" disabled={!value || !value.draft.trim()} onClick={() => value && onConfirm(value)}
            className="min-h-11 rounded-[10px] bg-[#1f9d63] px-[18px] text-[13.5px] font-bold text-white disabled:opacity-50">Use this</button>
        </div>
      </div>
    </section>
  )
}
