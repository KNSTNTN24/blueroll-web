'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { assistantAnswer, AssistantError } from '@/lib/haccp-setup/api'

export function AssistantPanel({ venueType }: { venueType: string | undefined }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [result, setResult] = useState<{ answer: string; sources: { title: string; source: string }[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (hidden) return null

  const ask = async () => {
    setBusy(true); setError(null)
    try { setResult(await assistantAnswer(q, venueType)) }
    catch (e) {
      if (e instanceof AssistantError) { setError(e.message); if (e.code === 'unavailable') setHidden(true) }
    } finally { setBusy(false) }
  }

  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-2 text-[14px] font-semibold">Ask a food safety question</h2>
      <div className="flex gap-2">
        <Input aria-label="Your question" value={q} maxLength={500} placeholder="e.g. How often should I check my probe?"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && q.trim() && ask()} />
        <Button disabled={!q.trim() || busy} onClick={ask}>{busy ? '…' : 'Ask'}</Button>
      </div>
      {error && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
      {result && (
        <div className="mt-3 text-[14px]">
          <p>{result.answer}</p>
          {result.sources.length > 0 && (
            <ul className="mt-2 text-[12px] text-muted-foreground">
              {result.sources.map((s) => <li key={s.title}>Source: {s.title} — {s.source}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
