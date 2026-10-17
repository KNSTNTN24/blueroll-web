// supabase/functions/_shared/reviews/publish.ts
// Spec §10: atomic claim → checks → PUT reply → outcome. Used by Telegram, WhatsApp (v1.1) and the web.
// Cards and notices are the caller's job (actions.ts); this only touches the review, Google and the audit.
import { GoogleError, isAuthError, type Google } from './google.ts'
import type { ReviewDeps } from './deps.ts'
import type { Actor } from './types.ts'

export type PublishOutcome = 'published' | 'already' | 'stale' | 'no_text' | 'not_ready' | 'deleted' | 'disconnected' | 'failed'
export interface PublishResult { outcome: PublishOutcome; by?: string | null; businessId?: string; firstFailure?: boolean }

const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200)

export async function publishReview(d: ReviewDeps, google: Google, a: { reviewId: string; draftVersion: number; actor: Actor }): Promise<PublishResult> {
  const r = await d.review(a.reviewId)
  if (!r || r.status === 'deleted') return { outcome: 'deleted' }
  if (r.status === 'published' || r.status === 'publishing') return { outcome: 'already', by: r.published_by_name }
  if (r.status === 'answered_elsewhere') return { outcome: 'not_ready' }
  const draft = (await d.drafts(r.id, r.version)).at(-1) ?? null
  if (!draft?.text.trim()) return { outcome: 'no_text' }
  if (draft.draft_version !== a.draftVersion) return { outcome: 'stale' }
  const loc = r.location_id ? await d.location(r.location_id) : null
  const conn = await d.activeConnection(r.business_id)
  if (!loc || !loc.enabled || !loc.can_reply || !conn || conn.id !== loc.connection_id) return { outcome: 'not_ready' }
  if (!(await d.entitled(r.business_id))) return { outcome: 'not_ready' }

  if (!(await d.claimPublishing(r.id, r.version, a.actor))) {
    const now = await d.review(r.id)
    return now && (now.status === 'published' || now.status === 'publishing') ? { outcome: 'already', by: now.published_by_name } : { outcome: 'stale' }
  }
  const base = { review_id: r.id, business_id: r.business_id, actor: a.actor }
  try {
    const at = await d.accessToken(conn)
    await google.putReply(at, loc.gbp_account, loc.gbp_location, r.google_review_id, draft.text)
  } catch (e) {
    if (e instanceof GoogleError && e.kind === 'not_found') {
      await d.patchReview(r.id, { status: 'deleted' })
      await d.audit({ ...base, action: 'deleted', details: { at_publish: true } })
      return { outcome: 'deleted', businessId: r.business_id }
    }
    await d.releasePublishing(r.id)
    if (isAuthError(e)) {
      const firstFailure = await d.connectionFailed(conn, msg(e))
      return { outcome: 'disconnected', businessId: r.business_id, firstFailure }
    }
    await d.audit({ ...base, action: 'publish_failed', details: { error: msg(e), draft_version: draft.draft_version } })
    return { outcome: 'failed', businessId: r.business_id }
  }
  // The reply is on Google now: never release the claim from here on.
  const record = { text: draft.text, at: d.now().toISOString(), actor: a.actor }
  try { await d.markPublished(r.id, record) }
  catch {
    try { await d.markPublished(r.id, record) }
    catch (e) { console.error('publish record failed', r.id, msg(e)) }
  }
  try { await d.audit({ ...base, action: 'published', details: { draft_version: draft.draft_version } }) }
  catch (e) { console.error('publish audit failed', r.id, msg(e)) }
  return { outcome: 'published', by: a.actor.name, businessId: r.business_id, firstFailure: false }
}
