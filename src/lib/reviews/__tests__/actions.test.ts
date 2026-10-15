import { describe, it, expect, vi } from 'vitest'
import { makeDraft, deliverReview, doPublish, doSkip, doEdit, doAnother, retireCards, ACTION_TEXT } from '../../../../supabase/functions/_shared/reviews/actions'
import { CARD_TEXT } from '../../../../supabase/functions/_shared/reviews/card'
import { MAX_AI_DRAFTS } from '../../../../supabase/functions/_shared/reviews/draft'
import { fakeCtx, mkReview, ANNA } from './fakes/review-deps'

const edits = (calls: { method: string; body: any }[]) => calls.filter((c) => c.method === 'editMessageText').map((c) => c.body.text as string)

describe('makeDraft', () => {
  it('first draft: v1, status drafted, language/flags stored, audit drafted', async () => {
    const r = mkReview()
    const { ctx, s, inputs } = fakeCtx({ reviews: [r] }, { flags: ['staff_named'] })
    const d = await makeDraft(ctx, r)
    expect(d).toMatchObject({ draft_version: 1, source: 'ai', text: 'Hi Sarah, thank you for letting us know…' })
    expect(s.reviews[0]).toMatchObject({ status: 'drafted', language: 'en', flags: ['staff_named'] })
    expect(inputs[0]).toMatchObject({ businessName: 'Casa-Mia', siteName: 'Casa-Mia Wharf Side', stars: 2, reviewer: 'Sarah Kim', differentFrom: null, previousReply: null })
    expect(s.audits.map((a) => a.action)).toEqual(['drafted'])
  })
  it('"another" passes the last text and is capped', async () => {
    const r = mkReview({ status: 'drafted' })
    const drafts = Array.from({ length: MAX_AI_DRAFTS }, (_, i) => ({ id: `d${i}`, review_id: r.id, review_version: 1, draft_version: i + 1, text: `v${i + 1}`, source: 'ai' as const, author_name: null, created_at: '' }))
    const { ctx } = fakeCtx({ reviews: [r], drafts })
    expect(await makeDraft(ctx, r, { another: true, actor: ANNA })).toBe('cap')
    const r2 = mkReview({ status: 'drafted' })
    const two = fakeCtx({ reviews: [r2], drafts: [{ ...drafts[0], review_id: r2.id }] })
    await makeDraft(two.ctx, r2, { another: true, actor: ANNA })
    expect(two.inputs[0].differentFrom).toBe('v1')
    expect(two.s.audits.map((a) => a.action)).toEqual(['regenerated'])
  })
  it('an edited review (v2) passes our previous published reply', async () => {
    const r = mkReview({ version: 2, published_text: 'Thanks Sarah!' })
    const { ctx, inputs } = fakeCtx({ reviews: [r] })
    await makeDraft(ctx, r)
    expect(inputs[0].previousReply).toBe('Thanks Sarah!')
  })
  it('drafting failure → null, status stays new', async () => {
    const r = mkReview()
    const { ctx, s } = fakeCtx({ reviews: [r] }, { replies: [null] })
    expect(await makeDraft(ctx, r)).toBeNull()
    expect(s.reviews[0].status).toBe('new')
  })
})

describe('deliverReview', () => {
  it('drafts, sends to every routed group of the same business, records cards, marks delivered', async () => {
    const r = mkReview()
    const groups = [
      { id: 'gr1', business_id: 'b1', chat_id: '-100', unlinked: false },
      { id: 'gr2', business_id: 'b1', chat_id: '-200', unlinked: false },
      { id: 'grX', business_id: 'OTHER', chat_id: '-300', unlinked: false },
      { id: 'grU', business_id: 'b1', chat_id: '-400', unlinked: true },
    ]
    const routes = groups.map((g) => ({ site_id: 's1', group_id: g.id }))
    const { ctx, s, calls } = fakeCtx({ reviews: [r], groups, routes })
    expect(await deliverReview(ctx, r)).toBe(2)
    expect(calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.chat_id)).toEqual(['-100', '-200'])
    expect(s.cards.map((c) => c.chat_id)).toEqual(['-100', '-200'])
    expect(s.reviews[0].delivered_version).toBe(1)
    expect(s.logs).toEqual(['review_card', 'review_card'])
  })
  it('pending review is delivered once even when drafting fails (Review Focus 5)', async () => {
    const r = mkReview()
    const { ctx, s, calls } = fakeCtx({ reviews: [r] }, { replies: [null] })
    await deliverReview(ctx, r)
    expect(calls[0].body.text).toContain(CARD_TEXT.draftFailed)
    expect(s.reviews[0].delivered_version).toBe(1)
    expect(await ctx.d.pending('b1', 50)).toEqual([])
  })
})

describe('removed sites (M2)', () => {
  it('no card goes to a removed site; the review still counts as delivered', async () => {
    const r = mkReview()
    const { ctx, s, calls } = fakeCtx({ reviews: [r], removedSites: ['s1'] })
    expect(await deliverReview(ctx, r)).toBe(0)
    expect(calls.filter((c) => c.method === 'sendMessage')).toEqual([])
    expect(s.reviews[0].delivered_version).toBe(1)
  })
})

describe('deliverReview is claim-based (I3)', () => {
  it('two overlapping deliveries of the same review → one set of cards', async () => {
    const r = mkReview()
    const { ctx, s, calls } = fakeCtx({ reviews: [r] })
    const out = await Promise.all([deliverReview(ctx, { ...r }), deliverReview(ctx, { ...r })])
    expect(out.sort()).toEqual([0, 1])
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1)
    expect(s.cards).toHaveLength(1)
    expect(s.reviews[0]).toMatchObject({ notify: false, delivered_version: 1 })
  })
  it('a review already claimed (notify off) is skipped', async () => {
    const r = mkReview({ notify: false })
    const { ctx, calls } = fakeCtx({ reviews: [r] })
    expect(await deliverReview(ctx, r)).toBe(0)
    expect(calls).toEqual([])
  })
  it('an error after the claim re-arms notify for the next run', async () => {
    const r = mkReview()
    const { ctx, s } = fakeCtx({ reviews: [r] })
    ctx.d.routedGroups = async () => { throw new Error('db down') }
    await expect(deliverReview(ctx, r)).rejects.toThrow('db down')
    expect(s.reviews[0]).toMatchObject({ notify: true, delivered_version: 0 })
  })
  it('the real claim is one conditional UPDATE; re-arm only for the same version', async () => {
    const { ctx, s } = fakeCtx({ reviews: [mkReview({ version: 2 })] })
    const id = s.reviews[0].id
    expect(await ctx.d.claimDelivery(id, 1)).toBe(false)
    expect(await ctx.d.claimDelivery(id, 2)).toBe(true)
    expect(await ctx.d.claimDelivery(id, 2)).toBe(false)
    await ctx.d.setNotify(id, 1, true)
    expect(s.reviews[0].notify).toBe(false)
    await ctx.d.setNotify(id, 2, true)
    expect(s.reviews[0].notify).toBe(true)
  })
})

describe('deliverReview with Telegram failures', () => {
  const bad = (method: string) => (method === 'sendMessage' ? { ok: false, status: 502, description: 'Bad Gateway' } : {})
  it('every group failing transiently leaves the review pending for the next run', async () => {
    const r = mkReview()
    const { ctx, s } = fakeCtx({ reviews: [r] }, { tg: bad })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await deliverReview(ctx, r)).toBe(0)
    spy.mockRestore()
    expect(s.reviews[0]).toMatchObject({ delivered_version: 0, notify: true })
    expect((await ctx.d.pending('b1', 50)).map((x) => x.id)).toEqual([r.id])
  })
  it('one group failing and one succeeding counts as delivered', async () => {
    const r = mkReview()
    const groups = [{ id: 'gr1', business_id: 'b1', chat_id: '-100', unlinked: false }, { id: 'gr2', business_id: 'b1', chat_id: '-200', unlinked: false }]
    const routes = groups.map((g) => ({ site_id: 's1', group_id: g.id }))
    const { ctx, s } = fakeCtx({ reviews: [r], groups, routes }, { tg: (m, b: any) => (m === 'sendMessage' && b.chat_id === '-100' ? { ok: false, status: 502, description: 'Bad Gateway' } : {}) })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await deliverReview(ctx, r)).toBe(1)
    spy.mockRestore()
    expect(s.reviews[0].delivered_version).toBe(1)
  })
})

describe('doPublish / doSkip / doEdit / doAnother', () => {
  const setup = (o: Parameters<typeof fakeCtx>[1] = {}) => {
    const r = mkReview({ status: 'drafted' })
    const f = fakeCtx({ reviews: [r], drafts: [{ id: 'd1', review_id: r.id, review_version: 1, draft_version: 1, text: 'Hi Sarah', source: 'ai', author_name: null, created_at: '' }],
      cards: [{ review_id: r.id, chat_id: '-100', message_id: '7', group_id: 'gr1' }, { review_id: r.id, chat_id: '-200', message_id: '8', group_id: 'gr2' }] }, o)
    return { r, ...f }
  }
  it('publish updates every card to "Published by"', async () => {
    const { r, ctx, calls } = setup()
    expect(await doPublish(ctx, r.id, 1, ANNA)).toMatchObject({ ok: true, outcome: 'published' })
    const e = edits(calls)
    expect(e).toHaveLength(2)
    expect(e.every((t) => t.includes('✅ Published by Anna S. · '))).toBe(true)
  })
  it('publish failure leaves buttons with a note', async () => {
    const { GoogleError } = await import('../../../../supabase/functions/_shared/reviews/google')
    const { r, ctx, calls } = setup({ google: { putFails: new GoogleError('server', 500, 'x') } })
    expect(await doPublish(ctx, r.id, 1, ANNA)).toMatchObject({ ok: false, outcome: 'failed', text: ACTION_TEXT.failed })
    expect(edits(calls)[0]).toContain(`<i>${ACTION_TEXT.failed}</i>`)
  })
  it('revoked grant → managers notified and every review group told, once', async () => {
    const { r, ctx, s, calls } = setup()
    s.secrets.set('sec1', 'revoked')
    await doPublish(ctx, r.id, 1, ANNA)
    await doPublish(ctx, r.id, 1, ANNA)
    expect(s.notes).toEqual([expect.objectContaining({ user_id: 'm1', title: 'Google reviews disconnected', link: '/settings?tab=reviews' })])
    expect(calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text)).toEqual([CARD_TEXT.disconnected])
  })
  it('skip', async () => {
    const { r, ctx, s, calls } = setup()
    expect(await doSkip(ctx, r.id, ANNA)).toMatchObject({ ok: true })
    expect(s.reviews[0]).toMatchObject({ status: 'skipped', skipped_by_name: 'Anna S.' })
    expect(edits(calls).every((t) => t.endsWith('✖️ Skipped by Anna S.'))).toBe(true)
    expect((await doSkip(ctx, r.id, ANNA)).ok).toBe(false)
  })
  it('edit → draft n+1 by the author, cards show it; empty and too long refused', async () => {
    const { r, ctx, s, calls } = setup()
    expect(await doEdit(ctx, r.id, 1, '  Hi Sarah — we are sorry.  ', ANNA)).toMatchObject({ ok: true })
    expect(s.drafts.at(-1)).toMatchObject({ draft_version: 2, source: 'edited', text: 'Hi Sarah — we are sorry.', author_name: 'Anna S.' })
    expect(edits(calls)[0]).toContain('Hi Sarah — we are sorry.')
    expect((await doEdit(ctx, r.id, 1, '   ', ANNA)).ok).toBe(false)
    expect((await doEdit(ctx, r.id, 1, 'x'.repeat(4001), ANNA)).text).toBe(ACTION_TEXT.tooLong)
  })
  it('edit for an older review version is refused', async () => {
    const { r, ctx } = setup()
    expect(await doEdit(ctx, r.id, 0, 'Hi', ANNA)).toMatchObject({ ok: false, text: ACTION_TEXT.stale })
  })
  it('another → new AI draft on the cards', async () => {
    const { r, ctx, calls } = setup({ replies: ['Hello Sarah, second take'] })
    expect(await doAnother(ctx, r.id, ANNA)).toMatchObject({ ok: true })
    expect(edits(calls)[0]).toContain('Hello Sarah, second take')
  })
})

describe('failure handling', () => {
  const draftFor = (r: { id: string }) => ({ id: `d-${r.id}`, review_id: r.id, review_version: 1, draft_version: 1, text: 'Hi', source: 'ai' as const, author_name: null, created_at: '' })
  it('an error before the claim does not touch a review someone else is publishing', async () => {
    const r = mkReview({ status: 'publishing' })
    const { ctx, s } = fakeCtx({ reviews: [r], drafts: [draftFor(r)] })
    ctx.d.review = async () => { throw new Error('db down') }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await doPublish(ctx, r.id, 1, ANNA)).toMatchObject({ ok: false, outcome: 'failed' })
    expect(spy).toHaveBeenCalledWith('publish failed', r.id, 'db down')
    spy.mockRestore()
    expect(s.reviews[0].status).toBe('publishing')
  })
  it('two reviews on one revoked connection: exactly one notification and one group message', async () => {
    const r1 = mkReview({ status: 'drafted' }), r2 = mkReview({ status: 'drafted' })
    const { ctx, s, calls } = fakeCtx({ reviews: [r1, r2], drafts: [draftFor(r1), draftFor(r2)], secrets: new Map([['sec1', 'revoked']]) })
    await doPublish(ctx, r1.id, 1, ANNA)
    await doPublish(ctx, r2.id, 1, ANNA)
    expect(s.notes).toHaveLength(1)
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1)
  })
  it('a failing notice is logged, not thrown', async () => {
    const r = mkReview({ status: 'drafted' })
    const { ctx } = fakeCtx({ reviews: [r], drafts: [draftFor(r)], secrets: new Map([['sec1', 'revoked']]) })
    ctx.d.notify = async () => { throw new Error('notify down') }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await doPublish(ctx, r.id, 1, ANNA)).toMatchObject({ outcome: 'disconnected' })
    expect(spy).toHaveBeenCalledWith('connection notice failed', 'b1', 'notify down')
    spy.mockRestore()
  })
  it('doEdit racing a draft with the same number → stale', async () => {
    const r = mkReview({ status: 'drafted' })
    const { ctx } = fakeCtx({ reviews: [r], drafts: [draftFor(r)] })
    ctx.d.lastDraftVersion = async () => 0   // another writer already took number 1
    expect(await doEdit(ctx, r.id, 1, 'Mine', ANNA)).toMatchObject({ ok: false, outcome: 'stale', text: ACTION_TEXT.stale })
  })
  it('makeDraft racing a duplicate draft number → null', async () => {
    const r = mkReview({ status: 'drafted' })
    const { ctx } = fakeCtx({ reviews: [r], drafts: [draftFor(r)] })
    ctx.d.lastDraftVersion = async () => 0
    expect(await makeDraft(ctx, r)).toBeNull()
  })
  it('draft numbers keep counting across review versions', async () => {
    const r = mkReview({ version: 2 })
    const { ctx } = fakeCtx({ reviews: [r], drafts: [draftFor(r)] })
    expect(await makeDraft(ctx, r)).toMatchObject({ draft_version: 2, review_version: 2 })
  })
})

describe('retireCards', () => {
  it('edits old cards to a static note and forgets them (Review Focus 4)', async () => {
    const r = mkReview()
    const { ctx, s, calls } = fakeCtx({ reviews: [r], cards: [{ review_id: r.id, chat_id: '-100', message_id: '7', group_id: 'gr1' }] })
    await retireCards(ctx, r.id)
    expect(calls[0]).toMatchObject({ method: 'editMessageText', body: { chat_id: '-100', message_id: 7, reply_markup: { inline_keyboard: [] } } })
    expect(calls[0].body.text.endsWith(CARD_TEXT.edited)).toBe(true)
    expect(s.cards).toEqual([])
  })
})
