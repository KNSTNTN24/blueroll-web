'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { canManageReviews, listReviews, reviewAction, type ReviewActionBody } from '@/lib/reviews/api'
import { FILTER_LABEL, currentDraft, isSafetyFlagged, matchesFilter, starsText, statusLabel, type ReviewFilter, type WebReview } from '@/lib/reviews/format'

const FILTERS: ReviewFilter[] = ['needs_reply', 'published', 'skipped', 'flagged', 'all']
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Spec §11: every review per site, with the same actions as the chat card (manage_reviews) or read-only. */
export default function ReviewsPage() {
  const business = useAuthStore((s) => s.business)
  const sites = useAuthStore((s) => s.sites)
  const [siteId, setSiteId] = useState<string>('')
  const [filter, setFilter] = useState<ReviewFilter>('needs_reply')
  const qc = useQueryClient()
  const key = ['reviews', business?.id, siteId]
  const { data: reviews = [], isLoading, isError, refetch } = useQuery({ queryKey: key, enabled: !!business?.id, queryFn: () => listReviews(business!.id, siteId || null) })
  const { data: canAct = false } = useQuery({ queryKey: ['can-manage-reviews', business?.id], enabled: !!business?.id, queryFn: canManageReviews })
  const siteNames = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites])
  const shown = reviews.filter((r) => matchesFilter(r, filter))
  if (!business) return null

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-[25px] font-bold tracking-[-0.02em]">Reviews</h1>
        <p className="mt-1.5 text-[14px] text-muted-foreground">Google reviews of your restaurants. New ones also arrive in your managers’ Telegram group.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-[13px] ${filter === f ? 'border-[#1f9d63] bg-[#e9f6ef] font-semibold' : ''}`}>{FILTER_LABEL[f]}</button>
        ))}
        {sites.length > 1 && (
          <select className="ml-auto rounded-md border px-2 py-1.5 text-[13px]" value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>
      {isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p>
        : isError ? (
          <div className="flex items-center gap-3 text-[13px]">
            <p className="text-muted-foreground">We couldn’t load reviews. Please try again.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        )
        : shown.length === 0 ? <p className="text-[13px] text-muted-foreground">No reviews here.</p>
        : shown.map((r) => <ReviewCard key={`${r.id}:${r.version}:${r.status}:${currentDraft(r)?.draft_version ?? 0}`} review={r} siteName={r.site_id ? siteNames.get(r.site_id) ?? '' : ''} canAct={canAct} onChanged={() => qc.invalidateQueries({ queryKey: key })} />)}
    </div>
  )
}

function ReviewCard({ review: r, siteName, canAct, onChanged }: { review: WebReview; siteName: string; canAct: boolean; onChanged: () => Promise<unknown> | void }) {
  const draft = currentDraft(r)
  const [text, setText] = useState(draft?.text ?? '')
  const [busy, setBusy] = useState(false)
  const open = r.status === 'new' || r.status === 'drafted' || r.status === 'skipped'
  const edited = text.trim() !== (draft?.text ?? '').trim()
  const act = async (body: ReviewActionBody) => {
    setBusy(true)
    try { const res = await reviewAction(body); toast.success(res.text || 'Done'); onChanged() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const publish = async () => {
    if (edited) {
      setBusy(true)
      try { await reviewAction({ action: 'edit', review_id: r.id, review_version: r.version, text }) }
      catch (e) { toast.error(e instanceof Error ? e.message : String(e)); setBusy(false); return }
      try { await onChanged() } finally { setBusy(false) }
      toast.message('Saved your edit — press Publish again to post it.')
      return
    }
    if (!window.confirm('Publish this reply on Google?')) return
    if (draft) act({ action: 'publish', review_id: r.id, draft_version: draft.draft_version })
  }
  return (
    <article className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-[#d97706]">{starsText(r.stars)}</span>
        <span className="font-medium">{siteName}</span>
        <span className="text-muted-foreground">· {r.reviewer_name || 'A Google user'} · {when(r.update_time)}{r.version > 1 ? ' · edited' : ''}</span>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[12px]">{statusLabel(r)}</span>
      </div>
      {isSafetyFlagged(r.flags) && (
        <p className="mt-2 text-[13px] font-semibold text-red-700">
          🚨 Food safety complaint {r.site_id && <a className="ml-2 underline" href={`/incidents?site=${r.site_id}&review=${r.id}`}>Log as complaint</a>}
        </p>
      )}
      <p className="mt-2 whitespace-pre-wrap text-[14px]">{r.comment || <span className="text-muted-foreground">(rating only, no text)</span>}</p>
      {r.status === 'published' && <Reply label="Our reply" text={r.published_text} />}
      {r.status === 'answered_elsewhere' && <Reply label="Reply on Google" text={r.google_reply} />}
      {open && canAct && (
        <div className="mt-3">
          {draft || edited ? (
            <textarea className="w-full rounded-md border px-3 py-2 text-[13.5px]" rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
          ) : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => act({ action: 'draft', review_id: r.id })}>Suggest a reply</Button>
          )}
          {(draft || edited) && (
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" disabled={busy || edited} onClick={() => act({ action: 'another', review_id: r.id })}>Another version</Button>
              {r.status !== 'skipped' && <Button variant="outline" size="sm" disabled={busy || edited} onClick={() => act({ action: 'skip', review_id: r.id })}>Skip</Button>}
              <Button size="sm" disabled={busy || !text.trim()} onClick={publish}>{edited ? 'Save edit' : 'Publish'}</Button>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function Reply({ label, text }: { label: string; text: string | null }) {
  if (!text) return null
  return (
    <div className="mt-3 rounded-lg bg-muted/50 p-3">
      <p className="text-[12px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-[13.5px]">{text}</p>
    </div>
  )
}
