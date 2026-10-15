import { describe, it, expect, vi, afterEach } from 'vitest'
import { reconcile, syncConnection, runSync, housekeeping, CARDS_PER_RUN, PAGES_FIRST } from '../../../../supabase/functions/_shared/reviews/sync'
import { fakeCtx, mkReview, gReview, CONN, LOC, NOW } from './fakes/review-deps'

describe('reconcile', () => {
  it('new review after connecting → notify', () => {
    const c = reconcile(null, gReview(), LOC, CONN)
    expect(c).toMatchObject({ kind: 'insert', row: { google_review_id: 'g-new', stars: 4, status: 'new', notify: true, site_id: 's1', location_id: 'l1', version: 1 } })
  })
  it('history from before connecting is silent', () => {
    expect(reconcile(null, gReview({ updateTime: '2026-09-01T00:00:00Z' }), LOC, CONN)).toMatchObject({ row: { notify: false, status: 'new' } })
  })
  it('review older than enabled_at is silent (Review Focus 2)', () => {
    const loc = { ...LOC, enabled_at: '2026-10-15T13:20:00Z' }
    expect(reconcile(null, gReview({ updateTime: '2026-10-15T13:10:00Z' }), loc, CONN)).toMatchObject({ row: { notify: false } })
    expect(reconcile(null, gReview({ updateTime: '2026-10-15T13:25:00Z' }), loc, CONN)).toMatchObject({ row: { notify: true } })
  })
  it('a location-level start earlier than connected_at wins (reconnect: the outage gap is still notified)', () => {
    const loc = { ...LOC, enabled_at: '2026-09-20T00:00:00Z' }
    expect(reconcile(null, gReview({ updateTime: '2026-09-25T00:00:00Z' }), loc, CONN)).toMatchObject({ row: { notify: true } })
    expect(reconcile(null, gReview({ updateTime: '2026-09-10T00:00:00Z' }), loc, CONN)).toMatchObject({ row: { notify: false } })
  })
  it('no enabled_at → connected_at is the start', () => {
    const loc = { ...LOC, enabled_at: null }
    expect(reconcile(null, gReview({ updateTime: '2026-09-25T00:00:00Z' }), loc, CONN)).toMatchObject({ row: { notify: false } })
    expect(reconcile(null, gReview({ updateTime: '2026-10-02T00:00:00Z' }), loc, CONN)).toMatchObject({ row: { notify: true } })
  })
  it('already answered on Google → answered_elsewhere, never notified', () => {
    expect(reconcile(null, gReview({ reply: 'Thanks!' }), LOC, CONN)).toMatchObject({ row: { status: 'answered_elsewhere', notify: false, google_reply: 'Thanks!' } })
  })
  it('text or stars changed → new version, back to new', () => {
    const ex = mkReview({ google_review_id: 'g-new', comment: 'Lovely', stars: 4, status: 'published', published_text: 'Thanks Tom' })
    expect(reconcile(ex, gReview({ comment: 'Lovely but slow', updateTime: '2026-10-15T13:20:00Z' }), LOC, CONN))
      .toMatchObject({ kind: 'new_version', patch: { version: 2, status: 'new', notify: true, comment: 'Lovely but slow', flags: [], language: null } })
    expect(reconcile(ex, gReview({ stars: 2 }), LOC, CONN)).toMatchObject({ kind: 'new_version', patch: { stars: 2 } })
  })
  it('our own published reply coming back from Google (whitespace differs) → no status change', () => {
    const ex = mkReview({ comment: 'Lovely', stars: 4, status: 'published', published_text: 'Thanks  Tom', google_reply: null })
    expect(reconcile(ex, gReview({ reply: 'Thanks Tom' }), LOC, CONN)).toMatchObject({ kind: 'patch', refresh: false, audit: null })
  })
  it('someone replied directly on Google → answered_elsewhere + refresh', () => {
    const ex = mkReview({ comment: 'Lovely', stars: 4, status: 'drafted' })
    expect(reconcile(ex, gReview({ reply: 'Cheers!' }), LOC, CONN)).toMatchObject({ kind: 'patch', patch: { status: 'answered_elsewhere', google_reply: 'Cheers!' }, refresh: true, audit: 'answered_elsewhere' })
  })
  it('reply deleted on Google → open again quietly', () => {
    const ex = mkReview({ comment: 'Lovely', stars: 4, status: 'answered_elsewhere', google_reply: 'Cheers!' })
    expect(reconcile(ex, gReview({ reply: null }), LOC, CONN)).toMatchObject({ kind: 'patch', patch: { status: 'new', notify: false, google_reply: null } })
  })
  it('publishing or deleted rows are left alone; unchanged → none', () => {
    expect(reconcile(mkReview({ status: 'publishing' }), gReview({ comment: 'x' }), LOC, CONN)).toEqual({ kind: 'none' })
    expect(reconcile(mkReview({ status: 'deleted' }), gReview({ comment: 'x' }), LOC, CONN)).toEqual({ kind: 'none' })
    expect(reconcile(mkReview({ comment: 'Lovely', stars: 4 }), gReview(), LOC, CONN)).toEqual({ kind: 'none' })
  })
})

describe('syncConnection', () => {
  const page = (reviews: ReturnType<typeof gReview>[], next: string | null = null) => ({ reviews, next })

  it('first run: imports, delivers only fresh reviews, saves the cursor and the full pass', async () => {
    const { ctx, s, calls } = fakeCtx({}, { google: { pages: { '-': page([gReview({ reviewId: 'a', updateTime: '2026-10-15T13:10:00Z' }), gReview({ reviewId: 'old', updateTime: '2026-09-01T00:00:00Z' })]) } } })
    expect(await syncConnection(ctx, CONN)).toBe(1)
    expect(s.reviews.map((r) => [r.google_review_id, r.delivered_version])).toEqual([['a', 1], ['old', 0]])
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1)
    expect(s.locs[0]).toMatchObject({ last_review_update_time: '2026-10-15T13:10:00Z', last_full_pass_at: NOW.toISOString() })
    expect(s.audits.filter((a) => a.action === 'imported')).toHaveLength(2)
  })
  it('incremental run stops paging at the cursor', async () => {
    const { ctx, s, gcalls } = fakeCtx({ locs: [{ ...LOC, last_review_update_time: '2026-10-15T13:00:00Z', last_full_pass_at: NOW.toISOString() }] }, { google: { pages: {
      '-': page([gReview({ reviewId: 'n1', updateTime: '2026-10-15T13:10:00Z' }), gReview({ reviewId: 'seen', updateTime: '2026-10-15T13:00:00Z' })], 'p2'),
      p2: page([gReview({ reviewId: 'older', updateTime: '2026-10-14T00:00:00Z' })]),
    } } })
    await syncConnection(ctx, CONN)
    expect(gcalls.filter((c) => c.startsWith('reviews'))).toEqual(['reviews locations/9 -'])
    expect(s.reviews.map((r) => r.google_review_id)).toEqual(['n1'])
  })
  it('first run pages at most PAGES_FIRST times', async () => {
    const pages: Record<string, ReturnType<typeof page>> = {}
    for (let i = 0; i < 15; i++) pages[i === 0 ? '-' : `p${i}`] = page([gReview({ reviewId: `r${i}`, updateTime: '2026-09-01T00:00:00Z' })], `p${i + 1}`)
    const { ctx, gcalls } = fakeCtx({}, { google: { pages } })
    await syncConnection(ctx, CONN)
    expect(gcalls.filter((c) => c.startsWith('reviews'))).toHaveLength(PAGES_FIRST)
  })
  it('a list error keeps the cursor where it was (nothing lost)', async () => {
    const { ctx, s } = fakeCtx({ locs: [{ ...LOC, last_review_update_time: '2026-10-15T13:00:00Z', last_full_pass_at: NOW.toISOString() }] })
    ctx.google.reviews = async () => { throw new Error('boom') }
    await syncConnection(ctx, CONN)
    expect(s.locs[0].last_review_update_time).toBe('2026-10-15T13:00:00Z')
  })
  it('daily full pass marks reviews missing from Google as deleted (only when the listing completed)', async () => {
    const gone = mkReview({ google_review_id: 'gone', status: 'drafted' })
    const kept = mkReview({ google_review_id: 'kept', comment: 'Lovely', stars: 4, status: 'drafted' })
    const { ctx, s } = fakeCtx({ reviews: [gone, kept], cards: [{ review_id: gone.id, chat_id: '-100', message_id: '7', group_id: 'gr1' }] }, { google: { pages: { '-': page([gReview({ reviewId: 'kept' })]) } } })
    await syncConnection(ctx, CONN)
    expect(s.reviews.find((r) => r.google_review_id === 'gone')!.status).toBe('deleted')
    expect(s.reviews.find((r) => r.google_review_id === 'kept')!.status).toBe('drafted')
  })
  it('new version retires old cards and delivers a new card (Review Focus 4)', async () => {
    const r = mkReview({ google_review_id: 'g1', comment: 'Lovely', stars: 4, status: 'drafted', delivered_version: 1 })
    const { ctx, s, calls } = fakeCtx({ reviews: [r], cards: [{ review_id: r.id, chat_id: '-100', message_id: '7', group_id: 'gr1' }], locs: [{ ...LOC, last_review_update_time: '2026-10-15T13:00:00Z', last_full_pass_at: NOW.toISOString() }] },
      { google: { pages: { '-': page([gReview({ reviewId: 'g1', comment: 'Lovely but slow', updateTime: '2026-10-15T13:20:00Z' })]) } } })
    await syncConnection(ctx, CONN)
    expect(calls.map((c) => c.method)).toEqual(['editMessageText', 'sendMessage'])
    expect(s.reviews[0]).toMatchObject({ version: 2, delivered_version: 2, status: 'drafted' })
    expect(s.cards.map((c) => c.message_id)).not.toContain('7')
  })
  it('at most CARDS_PER_RUN reviews per business per run', async () => {
    const reviews = Array.from({ length: CARDS_PER_RUN + 5 }, (_, i) => gReview({ reviewId: `r${i}`, updateTime: `2026-10-15T13:${String(10 + (i % 40)).padStart(2, '0')}:00Z` }))
    const { ctx, s } = fakeCtx({}, { google: { pages: { '-': page(reviews) } } })
    expect(await syncConnection(ctx, CONN)).toBe(CARDS_PER_RUN)
    expect(s.reviews.filter((r) => r.delivered_version === 1)).toHaveLength(CARDS_PER_RUN)
    expect(await syncConnection(ctx, CONN)).toBe(5)
  })
  it('not entitled → nothing fetched', async () => {
    const { ctx, gcalls } = fakeCtx({ entitled: false })
    expect(await syncConnection(ctx, CONN)).toBe(0)
    expect(gcalls).toEqual([])
  })
  it('revoked grant → connection error, notices once, sync stops', async () => {
    const { ctx, s } = fakeCtx({ secrets: new Map([['sec1', 'revoked']]) })
    await runSync(ctx)
    await runSync(ctx)
    expect(s.conns[0].status).toBe('error')
    expect(s.notes).toHaveLength(1)
  })
  it('runSync can be limited to one business', async () => {
    const { ctx } = fakeCtx({ conns: [{ ...CONN }, { ...CONN, id: 'c2', business_id: 'b2' }] })
    expect((await runSync(ctx, 'b2')).connections).toBe(1)
  })

  describe('isolation and housekeeping', () => {
    afterEach(() => vi.restoreAllMocks())

    it('one review failing to import does not stop the next', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { ctx, s } = fakeCtx({}, { google: { pages: { '-': page([gReview({ reviewId: 'bad' }), gReview({ reviewId: 'good' })]) } } })
      const insert = ctx.d.insertReview
      ctx.d.insertReview = async (r) => { if (r.google_review_id === 'bad') throw new Error('db down'); return insert(r) }
      await syncConnection(ctx, CONN)
      expect(s.reviews.map((r) => r.google_review_id)).toEqual(['good'])
      expect(spy).toHaveBeenCalledWith('review sync item failed', 'locations/9', 'db down')
    })
    it('one delivery throwing does not stop the next', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const a = mkReview({ google_review_id: 'a', update_time: '2026-10-15T13:01:00Z' })
      const b = mkReview({ google_review_id: 'b', update_time: '2026-10-15T13:02:00Z' })
      const { ctx, s } = fakeCtx({ reviews: [a, b], locs: [{ ...LOC, last_review_update_time: '2026-10-15T13:00:00Z', last_full_pass_at: NOW.toISOString() }] })
      const draft = ctx.draft
      let n = 0
      ctx.draft = async (i) => { if (n++ === 0) throw new Error('model down'); return draft(i) }
      expect(await syncConnection(ctx, CONN)).toBe(1)
      expect(s.reviews.find((r) => r.id === b.id)!.delivered_version).toBe(1)
      expect(s.reviews.find((r) => r.id === a.id)!.delivered_version).toBe(0)
      expect(spy).toHaveBeenCalledWith('review delivery failed', a.id, 'model down')
    })
    it('a failed import keeps the cursor so the next run retries it', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const locs = [{ ...LOC, last_review_update_time: '2026-10-15T13:00:00Z', last_full_pass_at: NOW.toISOString() }]
      const { ctx, s } = fakeCtx({ locs }, { google: { pages: { '-': page([gReview({ reviewId: 'bad', updateTime: '2026-10-15T13:20:00Z' }), gReview({ reviewId: 'good', updateTime: '2026-10-15T13:10:00Z' })]) } } })
      const insert = ctx.d.insertReview
      ctx.d.insertReview = async (r) => { if (r.google_review_id === 'bad') throw new Error('db down'); return insert(r) }
      await syncConnection(ctx, CONN)
      expect(s.locs[0].last_review_update_time).toBe('2026-10-15T13:00:00Z')
      expect(s.reviews.map((r) => r.google_review_id)).toEqual(['good'])
      ctx.d.insertReview = insert
      await syncConnection(ctx, CONN)
      expect(s.reviews.map((r) => r.google_review_id).sort()).toEqual(['bad', 'good'])
      expect(s.locs[0].last_review_update_time).toBe('2026-10-15T13:20:00Z')
      expect(spy).toHaveBeenCalled()
    })
    it('an incremental run that hits the page cap logs it and still advances', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const pages: Record<string, ReturnType<typeof page>> = {}
      for (let i = 0; i < 22; i++) pages[i === 0 ? '-' : `p${i}`] = page([gReview({ reviewId: `r${i}`, updateTime: '2026-10-15T13:10:00Z' })], `p${i + 1}`)
      const { ctx, s } = fakeCtx({ locs: [{ ...LOC, last_review_update_time: '2026-10-15T13:00:00Z', last_full_pass_at: NOW.toISOString() }] }, { google: { pages } })
      await syncConnection(ctx, CONN)
      expect(spy).toHaveBeenCalledWith('reviews page cap hit', 'locations/9')
      expect(s.locs[0].last_review_update_time).toBe('2026-10-15T13:10:00Z')
    })
    it('housekeeping: one failing revoke does not stop the others', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { ctx, s } = fakeCtx({ conns: [{ ...CONN, id: 'c1', status: 'revoked' }, { ...CONN, id: 'c2', business_id: 'b2', vault_secret_id: 'sec2', status: 'revoked' }], secrets: new Map([['sec1', 'rt1'], ['sec2', 'rt2']]) })
      ctx.d.deletedBusinessConnections = async () => s.conns
      ctx.google.revoke = async (t) => { if (t === 'rt1') throw new Error('google down') }
      await housekeeping(ctx)
      expect(s.secrets.has('sec2')).toBe(false)
      expect(spy).toHaveBeenCalledWith('reviews revoke failed', 'b1', 'google down')
    })
    it('housekeeping releases stale publishing claims only', async () => {
      const old = mkReview({ status: 'publishing' })
      const recent = mkReview({ status: 'publishing' })
      const { ctx, s, publishingAt } = fakeCtx({ reviews: [old, recent] })
      publishingAt.set(old.id, new Date(NOW.getTime() - 6 * 60_000).toISOString())
      publishingAt.set(recent.id, new Date(NOW.getTime() - 60_000).toISOString())
      await housekeeping(ctx)
      expect(s.reviews.find((r) => r.id === old.id)!.status).toBe('drafted')
      expect(s.reviews.find((r) => r.id === recent.id)!.status).toBe('publishing')
    })
  })
})
