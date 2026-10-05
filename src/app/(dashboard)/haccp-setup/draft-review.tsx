// src/app/(dashboard)/haccp-setup/draft-review.tsx
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { HACCP_METHODS } from '@/lib/haccp-pack/methods'
import { buildDraft } from '@/lib/haccp-setup/draft'
import { isScottishPostcode } from '@/lib/haccp-setup/geo'
import { applySetup, loadExisting } from '@/lib/haccp-setup/api'
import { defaultSelection, itemAddId, toApplyPayload, type Selection } from '@/lib/haccp-setup/apply'
import type { Answers, Draft, ExistingState } from '@/lib/haccp-setup/types'

const FREQ: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', four_weekly: 'Every 4 weeks', custom: 'As needed' }

export function DraftReview({ businessId, siteId, sessionId, answers, postcode, onApplied }: {
  businessId: string; siteId: string; sessionId: string; answers: Answers; postcode: string | null; onApplied: () => void
}) {
  const existing = useQuery({ queryKey: ['haccp-setup-existing', businessId, siteId], queryFn: () => loadExisting(businessId, siteId) })
  if (existing.isLoading) return <p className="text-[14px] text-muted-foreground">Preparing your draft…</p>
  if (existing.error || !existing.data) return <p className="text-[14px] text-destructive">Could not load your current setup.</p>
  return <Review key={existing.dataUpdatedAt} {...{ businessId, siteId, sessionId, answers, postcode, onApplied }}
    existing={existing.data} refetch={() => existing.refetch()} />
}

function Review({ businessId, sessionId, answers, postcode, existing, refetch, onApplied }: {
  businessId: string; siteId: string; sessionId: string; answers: Answers; postcode: string | null
  existing: ExistingState; refetch: () => void; onApplied: () => void
}) {
  const qc = useQueryClient()
  const draft: Draft = useMemo(
    () => buildDraft({ answers, scotland: isScottishPostcode(postcode), existing }), [answers, postcode, existing])
  const [sel, setSel] = useState<Selection>(() => defaultSelection(draft))
  const [done, setDone] = useState<{ created: number; fields: number } | null>(null)
  const toggle = (list: keyof Selection, id: string) =>
    setSel((s) => ({ ...s, [list]: s[list].includes(id) ? s[list].filter((x) => x !== id) : [...s[list], id] }))

  const apply = useMutation({
    mutationFn: () => applySetup(sessionId, toApplyPayload(draft, sel, existing)),
    onSuccess: (r) => {
      setDone({ created: r.created, fields: sel.fieldIds.length })
      for (const k of [['all-checklists'], ['my-checklists'], ['haccp-pack', businessId]]) qc.invalidateQueries({ queryKey: k })
    },
    onError: (e: Error) => {
      if (e.message.includes('pack_changed')) { toast.error("Your HACCP pack changed while you were reviewing. We've refreshed the draft."); refetch() }
      else if (e.message.includes('already_applied')) { toast.error('This setup was already applied.'); onApplied() }
      else if (e.message.includes('empty_roles')) toast.error('Your business has no matching staff roles — check Team → Roles.')
      else toast.error(e.message)
    },
  })

  if (done) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border p-5">
        <h2 className="text-[17px] font-semibold">Done</h2>
        <p className="text-[14px]">Created {done.created} checklists (switched off). Filled {done.fields} HACCP pack fields.</p>
        <Link className="text-[14px] underline" href="/checklists?tab=library">Review and switch on your checklists</Link>
        <Link className="text-[14px] underline" href="/haccp-pack">Check and sign your HACCP pack</Link>
        <Button variant="outline" className="self-start" onClick={onApplied}>Finish</Button>
      </section>
    )
  }

  const methodName = (id: string) => HACCP_METHODS.find((m) => m.id === id)?.name ?? id
  const byMethod = draft.fields.reduce<Record<string, Draft['fields']>>((acc, f) => { (acc[f.methodId] ??= []).push(f); return acc }, {})
  const nothing = !sel.checklistKeys.length && !sel.itemAddIds.length && !sel.fieldIds.length

  return (
    <section className="flex flex-col gap-5 rounded-xl border p-5">
      <h2 className="text-[17px] font-semibold">Your draft</h2>
      {draft.notes.length > 0 && (
        <ul className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
          {draft.notes.map((n) => <li key={n}>• {n}</li>)}
        </ul>
      )}

      <div>
        <h3 className="mb-2 text-[15px] font-semibold">Checklists</h3>
        <ul className="flex flex-col gap-2">
          {draft.checklists.map((c) => (
            <li key={c.key}>
              <label className="flex items-start gap-2 text-[14px]">
                <input type="checkbox" className="mt-1" checked={sel.checklistKeys.includes(c.key)} onChange={() => toggle('checklistKeys', c.key)} />
                <span><b>{c.name}</b> · {FREQ[c.frequency]} · {c.items.length} items<br />
                  <span className="text-[12px] text-muted-foreground">{c.reason}</span></span>
              </label>
            </li>
          ))}
          {draft.itemAdds.map((a) => (
            <li key={itemAddId(a)}>
              <label className="flex items-start gap-2 text-[14px]">
                <input type="checkbox" className="mt-1" checked={sel.itemAddIds.includes(itemAddId(a))} onChange={() => toggle('itemAddIds', itemAddId(a))} />
                <span>Add “{a.item.name}” to {a.templateName}</span>
              </label>
            </li>
          ))}
        </ul>
        {draft.existing.length > 0 && (
          <p className="mt-2 text-[12px] text-muted-foreground">Already set up: {draft.existing.map((e) => e.name).join(', ')}</p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-[15px] font-semibold">HACCP pack</h3>
        {Object.entries(byMethod).map(([methodId, fields]) => (
          <div key={methodId} className="mb-3">
            <p className="text-[13px] font-semibold">{methodName(methodId)}</p>
            <ul className="flex flex-col gap-1">
              {fields.map((f) => (
                <li key={f.fieldId} className="text-[13px]">
                  {f.status === 'new' ? (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={sel.fieldIds.includes(f.fieldId)} onChange={() => toggle('fieldIds', f.fieldId)} />
                      <span>{f.label}{f.type === 'toggle' ? ' — yes' : <>: <i>{String(f.value)}</i></>}</span>
                    </label>
                  ) : (
                    <span className="text-muted-foreground">
                      {f.label} — {f.status === 'manual' ? 'changed by you, not touched' : 'already filled, stays as is'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <Button className="self-start" disabled={apply.isPending || nothing} onClick={() => apply.mutate()}>
        {apply.isPending ? 'Applying…' : 'Apply'}
      </Button>
    </section>
  )
}
