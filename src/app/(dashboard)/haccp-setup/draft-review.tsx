// src/app/(dashboard)/haccp-setup/draft-review.tsx
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SectionIcon } from '@/components/haccp-plan/parts'
import { buildDraft } from '@/lib/haccp-setup/draft'
import { isScottishPostcode } from '@/lib/haccp-setup/geo'
import { applySetup, loadExisting } from '@/lib/haccp-setup/api'
import { defaultSelection, itemAddId, toApplyPayload, type Selection } from '@/lib/haccp-setup/apply'
import { reviewComposition, type SetupContext } from '@/lib/haccp-setup/context'
import type { Answers, Draft, ExistingState } from '@/lib/haccp-setup/types'

const FREQ: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', four_weekly: 'Every 4 weeks', custom: 'As needed' }

type Done = { created: number; fields: number; items: number; activated: boolean }

export function DraftReview({ businessId, siteId, sessionId, answers, postcode, ctx, flushSaves, onApplied }: {
  businessId: string; siteId: string; sessionId: string; answers: Answers; postcode: string | null; ctx: SetupContext
  /** Resolves once every pending answer save has finished. */
  flushSaves: () => Promise<unknown>
  onApplied: () => void
}) {
  const existing = useQuery({
    queryKey: ['haccp-setup-existing', businessId, siteId],
    queryFn: () => loadExisting(businessId, siteId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const [done, setDone] = useState<Done | null>(null)
  if (done) {
    return (
      <section className="flex flex-col gap-3 rounded-[14px] border border-[#e9eaed] bg-white p-6">
        <h2 className="text-[20px] font-bold">Your HACCP pack is filled in</h2>
        <p className="text-[14px] text-[#3b3f47]">
          Filled {done.fields} points. Added {done.created} checklists{done.activated ? ', switched on' : ' (switched off)'}.
          {done.items > 0 && ` Added ${done.items} items to existing checklists.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/haccp-pack/document" className="inline-flex min-h-11 items-center rounded-[10px] bg-[#1f9d63] px-4 text-[13.5px] font-bold text-white">Open your HACCP Plan</Link>
          {!done.activated && done.created > 0 && (
            <Link href="/checklists?tab=library" className="inline-flex min-h-11 items-center rounded-[10px] border border-[#e2e4e8] bg-white px-4 text-[13.5px] font-semibold">Switch on checklists</Link>
          )}
          <button type="button" onClick={onApplied} className="min-h-11 rounded-[10px] border border-[#e2e4e8] bg-white px-4 text-[13.5px] font-semibold">Finish</button>
        </div>
      </section>
    )
  }
  if (!existing.data) {
    if (existing.isLoading) return <p className="text-[14px] text-[#5f6670]">Preparing your draft…</p>
    return <p className="text-[14px] text-[#b3392f]">Could not load your current setup.</p>
  }
  return <Review key={`${existing.dataUpdatedAt}:${JSON.stringify(answers)}`} {...{ businessId, siteId, sessionId, answers, postcode, ctx, flushSaves, onApplied }}
    existing={existing.data} refetch={() => existing.refetch()} onDone={setDone} />
}

function Review({ businessId, siteId, sessionId, answers, postcode, ctx, flushSaves, existing, refetch, onApplied, onDone }: {
  businessId: string; siteId: string; sessionId: string; answers: Answers; postcode: string | null; ctx: SetupContext
  flushSaves: () => Promise<unknown>
  existing: ExistingState; refetch: () => void; onApplied: () => void; onDone: (d: Done) => void
}) {
  const qc = useQueryClient()
  const scotland = isScottishPostcode(postcode)
  const draft: Draft = useMemo(() => buildDraft({ answers, scotland, existing, flags: ctx.flags }), [answers, scotland, existing, ctx.flags])
  const [sel, setSel] = useState<Selection>(() => defaultSelection(draft))
  const [activate, setActivate] = useState(false)
  const payload = toApplyPayload(draft, sel, existing, { activate })
  const comp = useMemo(
    () => reviewComposition(ctx, existing.pack, draft.fields.filter((f) => f.status === 'new')),
    [ctx, existing.pack, draft.fields],
  )
  const pct = comp.total ? Math.round((comp.filled / comp.total) * 100) : 0
  const toggle = (list: keyof Selection, id: string) =>
    setSel((s) => ({ ...s, [list]: s[list].includes(id) ? s[list].filter((x) => x !== id) : [...s[list], id] }))

  const apply = useMutation({
    mutationFn: async () => {
      await flushSaves() // stored answers pre-fill a re-run, so the last ones must be saved before the session is applied
      return applySetup(sessionId, payload)
    },
    onSuccess: (r) => {
      for (const k of [['all-checklists'], ['my-checklists'], ['haccp-pack', businessId], ['haccp-plan', businessId], ['haccp-setup-existing', businessId, siteId], ['haccp-setup-summary', businessId, siteId]])
        qc.invalidateQueries({ queryKey: k })
      onDone({ created: r.created, fields: payload.summary.fields.length, items: r.items_added, activated: activate })
    },
    onError: (e: Error) => {
      if (e.message.includes('pack_changed')) { toast.error("Your HACCP pack changed while you were reviewing. We've refreshed the draft."); refetch() }
      else if (e.message.includes('already_applied')) { toast.error('This setup was already applied.'); onApplied() }
      else if (e.message.includes('empty_roles')) toast.error('Your business has no matching staff roles — check Team → Roles.')
      else toast.error(e.message)
    },
  })
  const nothing = !payload.checklists.length && !payload.item_adds.length && !payload.summary.fields.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[22px] font-bold tracking-[-0.4px]">Your HACCP plan is ready to fill in</h2>
          <p className="text-[14px] text-[#3b3f47]">Nothing is saved until you press Apply. Your own edits in the pack are never overwritten.</p>
          <p className="text-[12px] text-[#5f6670]">Rules: {scotland ? 'Scotland' : 'England, Wales and Northern Ireland'}</p>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[40px] font-extrabold tracking-[-1px] text-[#1f7a52]">{pct}%</span>
          <span className="text-[13px] text-[#3b3f47]">{comp.filled} of {comp.total} points</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        {comp.sections.map((s) => (
          <div key={s.id} className="flex flex-col gap-2 rounded-xl border border-[#e9eaed] bg-white p-3.5">
            <SectionIcon icon={s.id} size={32} />
            <div className="min-h-[34px] text-[13.5px] font-bold leading-tight">{s.name}</div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-[#e9eaed]" role="img" aria-label={`${s.answers} from answers, ${s.blueroll} from Blueroll, ${s.open} open`}>
              <div className="bg-[#1f9d63]" style={{ width: `${s.total ? (s.answers / s.total) * 100 : 0}%` }} />
              <div className="bg-[#a8d8bf]" style={{ width: `${s.total ? (s.blueroll / s.total) * 100 : 0}%` }} />
            </div>
            <div className="text-[12px] text-[#3b3f47]">{s.open ? `${s.total - s.open} of ${s.total} · ${s.open} open` : `All ${s.total} points`}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-[12px] text-[#5f6670]">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#1f9d63]" />From your answers</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#a8d8bf]" />From Blueroll (menu, recipes, suppliers, team)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#e9eaed]" />Still open</span>
      </div>

      {draft.notes.length > 0 && (
        <ul className="rounded-xl bg-[#fbf1e1] p-3.5 text-[13px] text-[#8a5a0c]">
          {draft.notes.map((n) => <li key={n}>• {n}</li>)}
        </ul>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <section aria-labelledby="checks" className="min-w-0 flex-[1_1_420px] overflow-hidden rounded-[14px] border border-[#e9eaed] bg-white">
          <h3 id="checks" className="border-b border-[#e9eaed] px-[18px] py-3.5 text-[14px] font-bold">Checks we’ll add</h3>
          {draft.checklists.map((c) => (
            <label key={c.key} className="flex min-h-11 items-center gap-3 border-b border-[#f1f2f4] px-[18px] py-2.5">
              <input type="checkbox" className="h-[18px] w-[18px] accent-[#1f9d63]" checked={sel.checklistKeys.includes(c.key)} onChange={() => toggle('checklistKeys', c.key)} />
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-[13.5px] font-semibold">{c.name}</span>
                <span className="text-[12px] text-[#5f6670]">{c.reason}{c.similarTo ? ` · You already have “${c.similarTo}”` : ''}</span>
              </span>
              <span className="text-[12px] text-[#3b3f47]">{FREQ[c.frequency]}</span>
            </label>
          ))}
          {draft.itemAdds.map((a) => (
            <label key={itemAddId(a)} className="flex min-h-11 items-center gap-3 border-b border-[#f1f2f4] px-[18px] py-2.5">
              <input type="checkbox" className="h-[18px] w-[18px] accent-[#1f9d63]" checked={sel.itemAddIds.includes(itemAddId(a))} onChange={() => toggle('itemAddIds', itemAddId(a))} />
              <span className="text-[13.5px]">Add “{a.item.name}” to {a.templateName}</span>
            </label>
          ))}
          {!draft.checklists.length && !draft.itemAdds.length && <p className="px-[18px] py-3.5 text-[13px] text-[#5f6670]">Your checklists already cover everything.</p>}
          {draft.existing.length > 0 && <p className="px-[18px] py-3 text-[12px] text-[#5f6670]">Already set up: {draft.existing.map((e) => e.name).join(', ')}</p>}
        </section>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          {comp.open.length > 0 && (
            <section aria-labelledby="open" className="flex flex-col gap-2.5 rounded-[14px] border border-[#e9eaed] bg-white p-4">
              <h3 id="open" className="text-[14px] font-bold">Still open · {comp.open.length}</h3>
              {comp.open.slice(0, 6).map((o, i) => (
                <div key={i} className="flex gap-2.5 rounded-lg bg-[#fbf1e1] px-3 py-2 text-[13px] leading-snug">
                  <span className="whitespace-nowrap font-bold text-[#8a5a0c]">{o.ref}</span><span>{o.label}</span>
                </div>
              ))}
              {comp.open.length > 6 && <p className="text-[12px] text-[#5f6670]">+{comp.open.length - 6} more in the pack</p>}
              <p className="text-[12px] text-[#5f6670]">You can apply now and finish these later from the pack.</p>
            </section>
          )}
          <section className="flex flex-col gap-3 rounded-[14px] bg-[#1f7a52] p-[18px] text-white">
            <div className="text-[15px] font-bold">Fill my pack and add the checks</div>
            <label className="flex min-h-11 items-center gap-2.5 text-[13.5px]">
              <input type="checkbox" className="h-[18px] w-[18px] accent-white" checked={activate} onChange={(e) => setActivate(e.target.checked)} disabled={!payload.checklists.length} />
              Switch on the selected checklists now
            </label>
            <p className="text-[13px] leading-normal text-white/90">
              {activate ? 'Staff will see them in their checks from today.' : 'They’ll be added switched off — turn them on in Checklists when you’re ready.'}
            </p>
            <button type="button" disabled={apply.isPending || nothing} onClick={() => apply.mutate()}
              className="min-h-12 rounded-xl bg-white text-[15px] font-extrabold text-[#1f7a52] disabled:opacity-60">
              {apply.isPending ? 'Applying…' : 'Apply'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
