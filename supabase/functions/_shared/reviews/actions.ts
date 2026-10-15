// supabase/functions/_shared/reviews/actions.ts
// What a person (or the cron) does to a review, and keeping every chat card in step (spec §7, §8, §10).
// Shared by the Telegram bot, the web API and the sync. Never logs Telegram user ids.
import { tgOutcome, tgText } from '../channels/telegram.ts'
import { renderCard, cardSend, cardEdit, CARD_TEXT, type Card } from './card.ts'
import { MAX_AI_DRAFTS, MAX_REPLY_CHARS } from './draft.ts'
import { publishReview } from './publish.ts'
import type { Ctx } from './deps.ts'
import { NEEDS_REPLY, PUBLISHABLE, type Actor, type Draft, type Review, type ReviewCard, type RouteGroup } from './types.ts'

export const ACTION_TEXT = {
  published: 'Published on Google',
  already: (by: string | null | undefined) => (by ? `Already published by ${by}` : 'Already being published'),
  stale: 'This reply changed — use the latest card',
  noText: 'There is no reply to publish yet — tap Edit to write one',
  notReady: "This review can't be published right now — check Settings → Google reviews",
  deleted: 'This review was removed from Google',
  disconnected: 'Google disconnected — reconnect in Settings → Google reviews.',
  failed: "Couldn't publish — try again",
  skipped: 'Skipped',
  notOpen: 'This review no longer needs a reply',
  edited: 'Reply updated',
  empty: 'The reply is empty',
  tooLong: 'That reply is too long for Google (4,000 characters max)',
  another: 'New version ready',
  cap: "That's the last suggested version — tap Edit to write your own",
  draftFailed: "Couldn't draft a reply — try again or tap Edit",
  gone: 'This review is no longer available',
}
export interface ActionResult { ok: boolean; outcome: string; text: string }
const done = (ok: boolean, outcome: string, text: string): ActionResult => ({ ok, outcome, text })
const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200)

export async function latestDraft(ctx: Ctx, r: Review): Promise<Draft | null> {
  return (await ctx.d.drafts(r.id, r.version)).at(-1) ?? null
}

export async function makeDraft(ctx: Ctx, r: Review, o: { another?: boolean; actor?: Actor } = {}): Promise<Draft | null | 'cap'> {
  const { d } = ctx
  const drafts = await d.drafts(r.id, r.version)
  if (o.another && drafts.filter((x) => x.source === 'ai').length >= MAX_AI_DRAFTS) return 'cap'
  const last = drafts.at(-1) ?? null
  const site = r.site_id ? await d.site(r.site_id) : null
  const res = await ctx.draft({
    businessName: await d.businessName(r.business_id), siteName: site?.name ?? '', stars: r.stars, comment: r.comment,
    reviewer: r.reviewer_name, settings: await d.settings(r.business_id),
    previousReply: r.version > 1 ? r.published_text : null, differentFrom: o.another ? last?.text ?? null : null,
  })
  if (!res) return null
  const draft = await d.insertDraft({ review_id: r.id, review_version: r.version, draft_version: (last?.draft_version ?? 0) + 1, text: res.reply, source: 'ai', actor: o.actor ?? null })
  await d.setDrafted(r.id, { language: res.language, flags: res.flags })
  await d.audit({ review_id: r.id, business_id: r.business_id, action: o.another ? 'regenerated' : 'drafted', actor: o.actor ?? { channel: 'system', profile_id: null, external_id: null, name: 'Blueroll' }, details: { draft_version: draft.draft_version } })
  return draft
}

export async function renderFor(ctx: Ctx, r: Review, o: { confirmAt?: number | null; note?: string | null } = {}): Promise<Card> {
  const site = r.site_id ? await ctx.d.site(r.site_id) : null
  const loc = r.location_id ? await ctx.d.location(r.location_id) : null
  const conn = await ctx.d.activeConnection(r.business_id)
  return renderCard({
    review: r, siteName: site?.name ?? '', timezone: site?.timezone ?? 'Europe/London', draft: await latestDraft(ctx, r),
    mapsUri: loc?.maps_uri ?? null, connectionActive: !!conn, appUrl: ctx.appUrl, confirmAt: o.confirmAt ?? null, note: o.note ?? null,
  })
}

export async function sendCard(ctx: Ctx, r: Review, group: RouteGroup): Promise<boolean> {
  if (group.business_id !== r.business_id) return false   // Review Focus 3: never cross businesses
  const res = await ctx.tg('sendMessage', cardSend(group.chat_id, await renderFor(ctx, r)))
  const mid = res.ok ? res.result?.message_id : null
  if (mid == null) { if (tgOutcome(res) === 'retry') console.error('review card send failed', group.chat_id, res.status); return false }
  await ctx.d.saveCard({ review_id: r.id, chat_id: group.chat_id, message_id: String(mid), group_id: group.id })
  await ctx.d.logOut({ business_id: r.business_id, site_id: r.site_id, kind: 'review_card', ref_id: r.id })
  return true
}

/** Draft if needed, send to every group routed to the review's site, then mark this version delivered (even with no draft or no groups). */
export async function deliverReview(ctx: Ctx, r: Review): Promise<number> {
  let review = r
  if (!(await latestDraft(ctx, r))) {
    await makeDraft(ctx, r)
    review = (await ctx.d.review(r.id)) ?? r
  }
  let sent = 0
  if (review.site_id) for (const g of await ctx.d.routedGroups(review.business_id, review.site_id)) if (await sendCard(ctx, review, g)) sent++
  await ctx.d.markDelivered(review.id, review.version)
  return sent
}

/** Re-render the review on every card (or just `only`). Cards Telegram no longer has are forgotten. */
export async function refreshCards(ctx: Ctx, reviewId: string, o: { only?: ReviewCard; confirmAt?: number | null; note?: string | null } = {}): Promise<void> {
  const r = await ctx.d.review(reviewId)
  if (!r) return
  const card = await renderFor(ctx, r, o)
  const cards = o.only ? [o.only] : await ctx.d.cards(reviewId)
  for (const c of cards) {
    const out = tgOutcome(await ctx.tg('editMessageText', cardEdit(c.chat_id, c.message_id, card)))
    if (out === 'gone' || out === 'kicked') await ctx.d.dropCard(c)
  }
}

/** The review changed on Google (new version): old cards lose their buttons and point to the new card. */
export async function retireCards(ctx: Ctx, reviewId: string): Promise<void> {
  for (const c of await ctx.d.cards(reviewId)) {
    await ctx.tg('editMessageText', cardEdit(c.chat_id, c.message_id, { html: CARD_TEXT.edited, keyboard: [] }))
    await ctx.d.dropCard(c)
  }
}

export async function refreshBusinessCards(ctx: Ctx, businessId: string): Promise<void> {
  for (const r of await ctx.d.openReviewsWithCards(businessId)) await refreshCards(ctx, r.id)
}

/** Spec §5: invalid_grant → app notification to manage_reviews holders + one message to each reviews group. */
export async function notifyConnectionError(ctx: Ctx, businessId: string): Promise<void> {
  const ids = await ctx.d.reviewManagerIds(businessId)
  await ctx.d.notify(ids.map((user_id) => ({
    user_id, title: 'Google reviews disconnected', message: 'Google stopped accepting our access. Reconnect in Settings → Google reviews.', link: '/settings?tab=reviews',
  })))
  for (const g of await ctx.d.reviewGroups(businessId)) {
    const r = await ctx.tg('sendMessage', tgText(g.chat_id, CARD_TEXT.disconnected))
    if (!r.ok) console.error('review group notice failed', g.chat_id, r.status)
  }
}

export async function doPublish(ctx: Ctx, reviewId: string, draftVersion: number, actor: Actor): Promise<ActionResult> {
  let r
  try { r = await publishReview(ctx.d, ctx.google, { reviewId, draftVersion, actor }) }
  catch (e) { console.error('publish failed', reviewId, errMsg(e)); await ctx.d.releasePublishing(reviewId); return done(false, 'failed', ACTION_TEXT.failed) }
  switch (r.outcome) {
    case 'published': await refreshCards(ctx, reviewId); return done(true, r.outcome, ACTION_TEXT.published)
    case 'already': await refreshCards(ctx, reviewId); return done(false, r.outcome, ACTION_TEXT.already(r.by))
    case 'deleted': await refreshCards(ctx, reviewId); return done(false, r.outcome, ACTION_TEXT.deleted)
    case 'disconnected':
      if (r.firstFailure && r.businessId) await notifyConnectionError(ctx, r.businessId)
      await refreshCards(ctx, reviewId)
      return done(false, r.outcome, ACTION_TEXT.disconnected)
    case 'failed': await refreshCards(ctx, reviewId, { note: ACTION_TEXT.failed }); return done(false, r.outcome, ACTION_TEXT.failed)
    case 'stale': return done(false, r.outcome, ACTION_TEXT.stale)
    case 'no_text': return done(false, r.outcome, ACTION_TEXT.noText)
    default: return done(false, r.outcome, ACTION_TEXT.notReady)
  }
}

export async function doSkip(ctx: Ctx, reviewId: string, actor: Actor): Promise<ActionResult> {
  const r = await ctx.d.review(reviewId)
  if (!r) return done(false, 'gone', ACTION_TEXT.gone)
  if (!(await ctx.d.markSkipped(reviewId, actor, ctx.d.now().toISOString()))) return done(false, 'not_open', ACTION_TEXT.notOpen)
  await ctx.d.audit({ review_id: reviewId, business_id: r.business_id, action: 'skipped', actor })
  await refreshCards(ctx, reviewId)
  return done(true, 'skipped', ACTION_TEXT.skipped)
}

export async function doEdit(ctx: Ctx, reviewId: string, reviewVersion: number, text: string, actor: Actor): Promise<ActionResult> {
  const r = await ctx.d.review(reviewId)
  if (!r) return done(false, 'gone', ACTION_TEXT.gone)
  if (!PUBLISHABLE.includes(r.status)) return done(false, 'not_open', ACTION_TEXT.notOpen)
  if (r.version !== reviewVersion) return done(false, 'stale', ACTION_TEXT.stale)
  const t = text.trim()
  if (!t) return done(false, 'empty', ACTION_TEXT.empty)
  if (t.length > MAX_REPLY_CHARS) return done(false, 'too_long', ACTION_TEXT.tooLong)
  const last = await latestDraft(ctx, r)
  const draft = await ctx.d.insertDraft({ review_id: r.id, review_version: r.version, draft_version: (last?.draft_version ?? 0) + 1, text: t, source: 'edited', actor })
  await ctx.d.setDrafted(r.id, {})
  await ctx.d.audit({ review_id: r.id, business_id: r.business_id, action: 'edited', actor, details: { draft_version: draft.draft_version } })
  await refreshCards(ctx, r.id)
  return done(true, 'edited', ACTION_TEXT.edited)
}

export async function doAnother(ctx: Ctx, reviewId: string, actor: Actor): Promise<ActionResult> {
  const r = await ctx.d.review(reviewId)
  if (!r) return done(false, 'gone', ACTION_TEXT.gone)
  if (!NEEDS_REPLY.includes(r.status) && r.status !== 'skipped') return done(false, 'not_open', ACTION_TEXT.notOpen)
  const d = await makeDraft(ctx, r, { another: true, actor })
  if (d === 'cap') return done(false, 'cap', ACTION_TEXT.cap)
  if (!d) return done(false, 'draft_failed', ACTION_TEXT.draftFailed)
  await refreshCards(ctx, r.id)
  return done(true, 'another', ACTION_TEXT.another)
}
