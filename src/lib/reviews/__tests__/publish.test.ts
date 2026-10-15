import { describe, it, expect } from 'vitest'
import { publishReview } from '../../../../supabase/functions/_shared/reviews/publish'
import { GoogleError } from '../../../../supabase/functions/_shared/reviews/google'
import { fakeCtx, mkReview, ANNA } from './fakes/review-deps'

const withDraft = (status: 'new' | 'drafted' | 'skipped' = 'drafted') => {
  const r = mkReview({ status, google_review_id: 'gr1' })
  return { r, drafts: [{ id: 'd1', review_id: r.id, review_version: 1, draft_version: 1, text: 'Hi Sarah, sorry', source: 'ai' as const, author_name: null, created_at: '' }] }
}

describe('publishReview', () => {
  it('claims, PUTs the latest draft to the current location path, records who', async () => {
    const { r, drafts } = withDraft()
    const { ctx, s, gcalls } = fakeCtx({ reviews: [r], drafts })
    expect(await publishReview(ctx.d, ctx.google, { reviewId: r.id, draftVersion: 1, actor: ANNA })).toEqual({ outcome: 'published', by: 'Anna S.', businessId: 'b1', firstFailure: false })
    expect(gcalls).toEqual(['put accounts/1/locations/9/gr1 Hi Sarah, sorry'])
    expect(s.reviews[0]).toMatchObject({ status: 'published', published_text: 'Hi Sarah, sorry', published_by_name: 'Anna S.', google_reply: 'Hi Sarah, sorry' })
    expect(s.audits.map((a) => a.action)).toEqual(['published'])
  })
  it('a skipped review can still be published (web)', async () => {
    const { r, drafts } = withDraft('skipped')
    const { ctx } = fakeCtx({ reviews: [r], drafts })
    expect((await publishReview(ctx.d, ctx.google, { reviewId: r.id, draftVersion: 1, actor: ANNA })).outcome).toBe('published')
  })
  it('race: two members press Yes — one publish, the other "already"', async () => {
    const { r, drafts } = withDraft()
    const { ctx, gcalls } = fakeCtx({ reviews: [r], drafts })
    const out = await Promise.all([1, 2].map(() => publishReview(ctx.d, ctx.google, { reviewId: r.id, draftVersion: 1, actor: ANNA })))
    expect(out.map((o) => o.outcome).sort()).toEqual(['already', 'published'])
    expect(gcalls.filter((c) => c.startsWith('put'))).toHaveLength(1)
  })
  it('stale draft version → stale, nothing claimed', async () => {
    const { r, drafts } = withDraft()
    const { ctx, s } = fakeCtx({ reviews: [r], drafts })
    expect((await publishReview(ctx.d, ctx.google, { reviewId: r.id, draftVersion: 0, actor: ANNA })).outcome).toBe('stale')
    expect(s.reviews[0].status).toBe('drafted')
  })
  it('no draft → no_text', async () => {
    const r = mkReview()
    const { ctx } = fakeCtx({ reviews: [r] })
    expect((await publishReview(ctx.d, ctx.google, { reviewId: r.id, draftVersion: 0, actor: ANNA })).outcome).toBe('no_text')
  })
  it('not entitled, location off or unverified → not_ready', async () => {
    for (const init of [{ entitled: false }, { locs: [{ ...fakeCtx().s.locs[0], enabled: false }] }, { locs: [{ ...fakeCtx().s.locs[0], can_reply: false }] }]) {
      const { r, drafts } = withDraft()
      const { ctx } = fakeCtx({ reviews: [r], drafts, ...init })
      expect((await publishReview(ctx.d, ctx.google, { reviewId: r.id, draftVersion: 1, actor: ANNA })).outcome).toBe('not_ready')
    }
  })
  it('404 → deleted', async () => {
    const { r, drafts } = withDraft()
    const { ctx, s } = fakeCtx({ reviews: [r], drafts }, { google: { putFails: new GoogleError('not_found', 404, 'gone') } })
    expect((await publishReview(ctx.d, ctx.google, { reviewId: r.id, draftVersion: 1, actor: ANNA })).outcome).toBe('deleted')
    expect(s.reviews[0].status).toBe('deleted')
  })
  it('revoked grant → disconnected, released, connection error once', async () => {
    const { r, drafts } = withDraft()
    const { ctx, s } = fakeCtx({ reviews: [r], drafts, secrets: new Map([['sec1', 'revoked']]) })
    const a = await publishReview(ctx.d, ctx.google, { reviewId: r.id, draftVersion: 1, actor: ANNA })
    expect(a).toMatchObject({ outcome: 'disconnected', firstFailure: true })
    expect(s.reviews[0].status).toBe('drafted')
    expect(s.conns[0].status).toBe('error')
  })
  it('5xx → failed, released, audit publish_failed', async () => {
    const { r, drafts } = withDraft()
    const { ctx, s } = fakeCtx({ reviews: [r], drafts }, { google: { putFails: new GoogleError('server', 503, 'backend') } })
    expect((await publishReview(ctx.d, ctx.google, { reviewId: r.id, draftVersion: 1, actor: ANNA })).outcome).toBe('failed')
    expect(s.reviews[0].status).toBe('drafted')
    expect(s.audits.map((a) => a.action)).toEqual(['publish_failed'])
  })
})
