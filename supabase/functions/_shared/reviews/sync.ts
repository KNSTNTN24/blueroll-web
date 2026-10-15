// supabase/functions/_shared/reviews/sync.ts
// Spec §6: every 15 min per active, entitled connection — list each enabled location's reviews (newest update first)
// down to the cursor, reconcile with ours, then draft + deliver up to 50 per business. Once a day a full pass also
// finds reviews removed from Google. Pure over Ctx.
import { isAuthError, type GReview } from './google.ts'
import { deliverReview, notifyConnectionError, refreshCards, retireCards } from './actions.ts'
import type { Ctx } from './deps.ts'
import { SYSTEM, type Connection, type Location, type NewReview, type Review } from './types.ts'

export const CARDS_PER_RUN = 50
export const PAGES_FIRST = 10
export const PAGES_MAX = 20
export const FULL_PASS_MS = 86_400_000
export const STALE_PUBLISHING_MS = 5 * 60_000

export type Change =
  | { kind: 'insert'; row: NewReview }
  | { kind: 'new_version'; patch: Partial<Review> }
  | { kind: 'patch'; patch: Partial<Review>; refresh: boolean; audit: 'answered_elsewhere' | null }
  | { kind: 'none' }

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const after = (a: string, b: string) => Date.parse(a) > Date.parse(b)
const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200)

export function reconcile(existing: Review | null, g: GReview, loc: Location, conn: Connection): Change {
  // Spec §2 "History on connect"; Review Focus 2: a location switched on later counts from its own start.
  const since = loc.enabled_at && after(loc.enabled_at, conn.connected_at) ? loc.enabled_at : conn.connected_at
  const fresh = after(g.updateTime, since)
  const where = { location_id: loc.id, site_id: loc.site_id ?? existing?.site_id ?? null }
  if (!existing) {
    return { kind: 'insert', row: {
      business_id: loc.business_id, ...where, google_review_id: g.reviewId, version: 1, stars: g.stars, comment: g.comment,
      reviewer_name: g.reviewer, create_time: g.createTime, update_time: g.updateTime, google_reply: g.reply,
      google_reply_time: g.replyTime, notify: !g.reply && fresh, status: g.reply ? 'answered_elsewhere' : 'new',
    } }
  }
  if (existing.status === 'publishing' || existing.status === 'deleted') return { kind: 'none' }
  if (g.comment !== existing.comment || g.stars !== existing.stars) {
    return { kind: 'new_version', patch: {
      ...where, version: existing.version + 1, stars: g.stars, comment: g.comment, reviewer_name: g.reviewer,
      update_time: g.updateTime, google_reply: g.reply, google_reply_time: g.replyTime, status: 'new', notify: fresh, flags: [], language: null,
    } }
  }
  if (norm(g.reply) === norm(existing.google_reply)) return { kind: 'none' }
  const reply = { google_reply: g.reply, google_reply_time: g.replyTime, update_time: g.updateTime }
  if (g.reply && existing.status === 'published' && norm(g.reply) === norm(existing.published_text)) return { kind: 'patch', patch: reply, refresh: false, audit: null }
  if (g.reply) return { kind: 'patch', patch: { ...reply, status: 'answered_elsewhere' }, refresh: true, audit: 'answered_elsewhere' }
  const reopen = existing.status === 'answered_elsewhere' || existing.status === 'published'
  return { kind: 'patch', patch: { ...reply, ...(reopen ? { status: 'new' as const, notify: false } : {}) }, refresh: true, audit: null }
}

async function apply(ctx: Ctx, existing: Review | null, g: GReview, loc: Location, conn: Connection) {
  const { d } = ctx
  const ch = reconcile(existing, g, loc, conn)
  if (ch.kind === 'insert') {
    const r = await d.insertReview(ch.row)
    await d.audit({ review_id: r.id, business_id: r.business_id, action: 'imported', actor: SYSTEM })
    return
  }
  if (ch.kind === 'none' || !existing) return
  await d.patchReview(existing.id, ch.patch)
  if (ch.kind === 'new_version') { await retireCards(ctx, existing.id); return }
  if (ch.audit) await d.audit({ review_id: existing.id, business_id: existing.business_id, action: ch.audit, actor: SYSTEM })
  if (ch.refresh) await refreshCards(ctx, existing.id)
}

/** Throws auth errors (the caller marks the connection); any other listing error leaves the cursor untouched. */
async function syncLocation(ctx: Ctx, conn: Connection, loc: Location, at: string): Promise<void> {
  const { d } = ctx
  const now = d.now()
  const full = !loc.last_full_pass_at || now.getTime() - Date.parse(loc.last_full_pass_at) > FULL_PASS_MS
  const cursor = loc.last_review_update_time
  const maxPages = cursor ? PAGES_MAX : PAGES_FIRST
  const seen = new Set<string>()
  let maxSeen = cursor
  let page: string | undefined
  let complete = false
  let atCursor = false
  let failed = false
  for (let n = 0; n < maxPages; n++) {
    let res
    try { res = await ctx.google.reviews(at, loc.gbp_account, loc.gbp_location, page) }
    catch (e) {
      if (isAuthError(e)) throw e
      console.error('reviews list failed', loc.gbp_location, errMsg(e))
      return
    }
    const known = await d.reviewsByGoogleId(conn.business_id, res.reviews.map((r) => r.reviewId))
    let reachedCursor = false
    for (const g of res.reviews) {
      seen.add(g.reviewId)
      if (!maxSeen || after(g.updateTime, maxSeen)) maxSeen = g.updateTime
      if (!full && cursor && !after(g.updateTime, cursor)) { reachedCursor = true; break }
      try { await apply(ctx, known.get(g.reviewId) ?? null, g, loc, conn) }
      catch (e) { failed = true; console.error('review sync item failed', loc.gbp_location, errMsg(e)) }
    }
    if (reachedCursor) { atCursor = true; break }
    if (!res.next) { complete = true; break }
    page = res.next
  }
  // Page cap hit before reaching the cursor: the cursor still advances (else a very busy location would re-read the
  // same pages forever); the daily full pass reconciles the gap.
  if (cursor && !atCursor && !complete) console.error('reviews page cap hit', loc.gbp_location)
  if (full && complete) {
    for (const r of await d.liveReviewsAt(loc.id)) {
      if (seen.has(r.google_review_id) || r.status === 'publishing') continue
      await d.patchReview(r.id, { status: 'deleted' })
      await d.audit({ review_id: r.id, business_id: r.business_id, action: 'deleted', actor: SYSTEM })
      await refreshCards(ctx, r.id)
    }
  }
  await d.saveCursor(loc.id, { last_review_update_time: failed ? cursor : maxSeen, ...(full ? { last_full_pass_at: now.toISOString() } : {}) })
}

async function authFailed(ctx: Ctx, conn: Connection, e: unknown) {
  if (!isAuthError(e)) { console.error('reviews sync failed', conn.business_id, errMsg(e)); return }
  if (await ctx.d.connectionFailed(conn, errMsg(e))) await notifyConnectionError(ctx, conn.business_id)
}

export async function syncConnection(ctx: Ctx, conn: Connection): Promise<number> {
  const { d } = ctx
  if (!(await d.entitled(conn.business_id))) return 0
  try {
    const at = await d.accessToken(conn)
    for (const loc of await d.enabledLocations(conn.id)) {
      if (!loc.site_id || !loc.can_reply) continue
      await syncLocation(ctx, conn, loc, at)
    }
  } catch (e) {
    await authFailed(ctx, conn, e)
    if (isAuthError(e)) return 0
  }
  await d.touchConnection(conn.id, d.now())
  let sent = 0
  for (const r of await d.pending(conn.business_id, CARDS_PER_RUN)) {
    try { await deliverReview(ctx, r); sent++ }
    catch (e) { console.error('review delivery failed', r.id, errMsg(e)) }
  }
  return sent
}

export async function runSync(ctx: Ctx, onlyBusiness?: string): Promise<{ connections: number; delivered: number }> {
  let connections = 0
  let delivered = 0
  for (const c of await ctx.d.activeConnections()) {
    if (onlyBusiness && c.business_id !== onlyBusiness) continue
    connections++
    try { delivered += await syncConnection(ctx, c) }
    catch (e) { console.error('reviews sync failed', c.business_id, errMsg(e)) }
  }
  return { connections, delivered }
}

/** Deleted businesses: revoke at Google and drop the Vault secret (spec §12 "Business deletion"); then table cleanup. */
export async function housekeeping(ctx: Ctx): Promise<void> {
  const { d } = ctx
  await d.releaseStalePublishing(new Date(d.now().getTime() - STALE_PUBLISHING_MS))
  for (const c of await d.deletedBusinessConnections()) {
    try {
      if (c.vault_secret_id) {
        const t = await d.readToken(c.vault_secret_id)
        if (t) await ctx.google.revoke(t)
        await d.deleteToken(c.vault_secret_id)
      }
      await d.markRevoked(c.id, d.now())
    } catch (e) { console.error('reviews revoke failed', c.business_id, errMsg(e)) }
  }
  await d.cleanup(d.now())
}
