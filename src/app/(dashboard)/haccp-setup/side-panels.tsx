'use client'

import { forwardRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { assistantAnswer, AssistantError } from '@/lib/haccp-setup/api'
import { ASSISTANT_CHIPS } from '@/lib/haccp-setup/content/assistant-chips'
import type { FillPreview } from '@/lib/haccp-setup/context'

// Right-hand panels beside each question: what the answer fills in, and the assistant.

export function FillsPanel({ fills, checklists }: { fills: FillPreview[]; checklists: string[] }) {
  if (!fills.length && !checklists.length) return null
  return (
    <section aria-label="This fills in" className="flex flex-col gap-2.5 rounded-[14px] border border-[#e9eaed] bg-white p-4">
      <h3 className="text-[13px] font-bold">This fills in</h3>
      {fills.length > 0 && (
        <ul className="flex flex-col gap-2">
          {fills.map((f) => (
            <li key={f.fieldId} className="flex gap-2 text-[12.5px] leading-snug">
              <span aria-hidden className={`mt-px h-4 w-4 shrink-0 rounded-[5px] ${f.value !== null ? 'bg-[#1f9d63]' : 'border border-[#c9cdd3] bg-white'}`} />
              <span><span className="text-[#5f6670]">{f.ref}</span> {f.label}</span>
            </li>
          ))}
        </ul>
      )}
      {checklists.length > 0 && (
        <p className="border-t border-[#e9eaed] pt-2 text-[12px] text-[#5f6670]">And adds: {checklists.join(', ')}</p>
      )}
    </section>
  )
}

export const ContextAssistant = forwardRef<HTMLInputElement, { methodId: string; venueType: string | undefined }>(
  function ContextAssistant({ methodId, venueType }, inputRef) {
    const [q, setQ] = useState('')
    const [busy, setBusy] = useState(false)
    const [off, setOff] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<{ answer: string; sources: { title: string; source: string }[] } | null>(null)
    if (off) return null

    const ask = async (question: string) => {
      if (!question.trim()) return
      setQ(question); setBusy(true); setError(null)
      try { setResult(await assistantAnswer(question, venueType)) }
      catch (e) {
        if (e instanceof AssistantError) { setError(e.message); if (e.code === 'unavailable') setOff(true) }
        else setError('Something went wrong — try again.')
      } finally { setBusy(false) }
    }

    return (
      <section aria-label="Ask about this question" className="flex flex-col gap-2.5 rounded-[14px] border border-[#e9eaed] bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-[#14161b] text-white"><Sparkles className="h-3.5 w-3.5" strokeWidth={2} /></span>
          <h3 className="text-[13px] font-bold">Ask about this question</h3>
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
          <label htmlFor="setup-ask" className="sr-only">Your question</label>
          <input id="setup-ask" ref={inputRef} value={q} maxLength={500} onChange={(e) => setQ(e.target.value)}
            placeholder="Ask anything about this step" className="min-h-[42px] min-w-0 flex-1 rounded-[10px] border border-[#e2e4e8] px-3 text-[13px]" />
          <button type="submit" disabled={!q.trim() || busy} className="min-h-[42px] rounded-[10px] bg-[#14161b] px-3 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy ? '…' : 'Ask'}
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {(ASSISTANT_CHIPS[methodId] ?? []).map((c) => (
            <button key={c} type="button" onClick={() => ask(c)} className="min-h-8 rounded-full border border-[#e2e4e8] bg-[#f6f7f8] px-2.5 text-left text-[12px] text-[#3b3f47]">{c}</button>
          ))}
        </div>
        {error && <p className="text-[12.5px] text-[#b3392f]">{error}</p>}
        {result && (
          <div className="flex flex-col gap-1.5 rounded-[10px] bg-[#f6f7f8] p-3 text-[13px] leading-normal">
            <p>{result.answer}</p>
            {result.sources.length > 0 && (
              <ul className="text-[11.5px] text-[#5f6670]">
                {result.sources.map((s, i) => <li key={`${s.title}-${i}`}>Source: {s.title} — {s.source}</li>)}
              </ul>
            )}
          </div>
        )}
        <p className="text-[11.5px] text-[#5f6670]">Answers come from the FSA Safer Food, Better Business pack, with sources.</p>
      </section>
    )
  },
)
