import { describe, it, expect } from 'vitest'
import { handleReviewAction } from '../../../../supabase/functions/_shared/reviews/web-api'
import { fakeCtx, mkReview } from './fakes/review-deps'

const ME = { profile_id: 'p1', business_id: 'b1', name: 'Kostya' }
const withDraft = () => {
  const r = mkReview({ status: 'drafted' })
  return { r, ...fakeCtx({ reviews: [r], drafts: [{ id: 'd1', review_id: r.id, review_version: 1, draft_version: 1, text: 'Hi Sarah', source: 'ai', author_name: null, created_at: '' }] }) }
}

describe('handleReviewAction', () => {
  it('rejects bad bodies and reviews of other businesses', async () => {
    const { r, ctx, s } = withDraft()
    expect((await handleReviewAction(ctx, ME, null)).status).toBe(400)
    s.reviews[0].business_id = 'OTHER'
    expect((await handleReviewAction(ctx, ME, { action: 'skip', review_id: r.id })).status).toBe(404)
  })
  it('publish records the web user', async () => {
    const { r, ctx, s } = withDraft()
    const res = await handleReviewAction(ctx, ME, { action: 'publish', review_id: r.id, draft_version: 1 })
    expect(res).toMatchObject({ status: 200, body: { ok: true, outcome: 'published' } })
    expect(s.reviews[0].published_by_name).toBe('Kostya')
    expect(s.audits.at(-1)!.actor).toEqual({ channel: 'web', profile_id: 'p1', external_id: null, name: 'Kostya' })
  })
  it('publish needs a numeric draft_version; stale → 409', async () => {
    const { r, ctx } = withDraft()
    expect((await handleReviewAction(ctx, ME, { action: 'publish', review_id: r.id })).status).toBe(400)
    expect((await handleReviewAction(ctx, ME, { action: 'publish', review_id: r.id, draft_version: 0 })).status).toBe(409)
  })
  it('edit, skip, another', async () => {
    const { r, ctx, s } = withDraft()
    expect((await handleReviewAction(ctx, ME, { action: 'edit', review_id: r.id, review_version: 1, text: 'Hi Sarah, sorry' })).status).toBe(200)
    expect(s.drafts.at(-1)).toMatchObject({ source: 'edited', author_name: 'Kostya' })
    expect((await handleReviewAction(ctx, ME, { action: 'edit', review_id: r.id, review_version: 1, text: 'x'.repeat(4001) })).status).toBe(400)
    expect((await handleReviewAction(ctx, ME, { action: 'another', review_id: r.id })).status).toBe(200)
    expect((await handleReviewAction(ctx, ME, { action: 'skip', review_id: r.id })).status).toBe(200)
  })
  it('draft: makes a first draft for a silent (historic) review; no cards', async () => {
    const r = mkReview({ notify: false })
    const { ctx, s, calls } = fakeCtx({ reviews: [r] })
    expect((await handleReviewAction(ctx, ME, { action: 'draft', review_id: r.id })).body).toMatchObject({ ok: true, outcome: 'drafted' })
    expect(s.drafts).toHaveLength(1)
    expect(calls).toEqual([])
    expect((await handleReviewAction(ctx, ME, { action: 'draft', review_id: r.id })).body).toMatchObject({ ok: true, outcome: 'exists' })
  })
  it('unknown action → 400', async () => {
    const { r, ctx } = withDraft()
    expect((await handleReviewAction(ctx, ME, { action: 'nope', review_id: r.id })).status).toBe(400)
  })
})
