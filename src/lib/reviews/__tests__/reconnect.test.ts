// Final review C2: after a reconnect, reviews imported under the old connection still publish (their location_id is
// re-pointed at the new connection's location row) and the sync cursor continues.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleConnect } from '../../../../supabase/functions/_shared/reviews/connect'
import { publishReview } from '../../../../supabase/functions/_shared/reviews/publish'
import { GOOGLE_SCOPE_MANAGE, type Google } from '../../../../supabase/functions/_shared/reviews/google'
import { fakeCtx, fakeConnectDeps, mkReview, ANNA, CONN, LOC } from './fakes/review-deps'

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

describe('reconnect', () => {
  it('a review imported before the reconnect can be published afterwards', async () => {
    const r = mkReview({ status: 'drafted', google_review_id: 'gr1' })
    const drafts = [{ id: 'd1', review_id: r.id, review_version: 1, draft_version: 1, text: 'Hi Sarah, sorry', source: 'ai' as const, author_name: null, created_at: '' }]
    const loc = { ...LOC, last_review_update_time: '2026-10-14T00:00:00Z', last_full_pass_at: '2026-10-14T00:00:00Z' }
    const { ctx, s, gcalls } = fakeCtx({ reviews: [r], drafts, locs: [loc], conns: [{ ...CONN, status: 'error' }] })
    s.states.push({ state: 'S', business_id: 'b1', profile_id: 'p1', code_verifier: 'V', expires_at: '2026-10-15T14:00:00Z' })
    const g: Google = {
      ...ctx.google,
      exchangeCode: async () => ({ accessToken: 'at', refreshToken: 'rt2', scopes: [GOOGLE_SCOPE_MANAGE] }),
      email: async () => 'owner@casamia.co.uk',
      accounts: async () => ['accounts/1'],
      locations: async () => [{ name: 'locations/9', title: 'Casa-Mia Wharf Side', address: '', postcode: 'N1 7GR', mapsUri: 'https://maps/9' }],
      canReply: async () => true,
    }

    expect((await handleConnect(fakeConnectDeps(s), g, null, { action: 'finish', code: 'C', state: 'S' })).body).toEqual({ result: 'connected' })
    const active = s.conns.find((c) => c.status === 'active')!
    const fresh = s.locs.find((l) => l.connection_id === active.id)!
    expect(fresh).toMatchObject({ enabled: true, site_id: 's1', enabled_at: LOC.enabled_at, last_review_update_time: '2026-10-14T00:00:00Z' })
    expect(s.reviews[0].location_id).toBe(fresh.id)

    expect((await publishReview(ctx.d, g, { reviewId: r.id, draftVersion: 1, actor: ANNA })).outcome).toBe('published')
    expect(gcalls).toContain('put accounts/1/locations/9/gr1 Hi Sarah, sorry')
  })
})
