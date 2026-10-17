import { describe, it, expect } from 'vitest'
import { makeGoogle, parseReview, parseLocation, GoogleError, isAuthError, GOOGLE_SCOPE_MANAGE } from '../../../../supabase/functions/_shared/reviews/google'

type Call = { url: string; init: RequestInit | undefined }
function fakeFetch(routes: [RegExp, number, unknown][]) {
  const calls: Call[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const hit = routes.find(([re]) => re.test(url))
    if (!hit) return new Response(JSON.stringify({ error: { message: 'no route' } }), { status: 500 })
    return new Response(JSON.stringify(hit[2]), { status: hit[1] })
  }) as unknown as typeof fetch
  return { f, calls }
}
const cfg = (f: typeof fetch) => ({ clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://app.blueroll.app/api/google/callback', fetchFn: f })

describe('authUrl', () => {
  it('asks for offline business.manage + openid email with PKCE and consent', () => {
    const u = new URL(makeGoogle(cfg(fakeFetch([]).f)).authUrl('st', 'ch'))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const p = Object.fromEntries(u.searchParams)
    expect(p).toMatchObject({
      client_id: 'cid', redirect_uri: 'https://app.blueroll.app/api/google/callback', response_type: 'code',
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: 'st', code_challenge: 'ch', code_challenge_method: 'S256',
    })
    expect(p.scope.split(' ')).toEqual([GOOGLE_SCOPE_MANAGE, 'openid', 'email'])
  })
})

describe('tokens', () => {
  it('exchangeCode posts the verifier and returns refresh token + scopes', async () => {
    const { f, calls } = fakeFetch([[/oauth2\.googleapis\.com\/token/, 200, { access_token: 'at', refresh_token: 'rt', scope: `${GOOGLE_SCOPE_MANAGE} openid email` }]])
    const t = await makeGoogle(cfg(f)).exchangeCode('code1', 'ver1')
    expect(t).toEqual({ accessToken: 'at', refreshToken: 'rt', scopes: [GOOGLE_SCOPE_MANAGE, 'openid', 'email'] })
    const body = new URLSearchParams(String(calls[0].init?.body))
    expect(Object.fromEntries(body)).toMatchObject({ code: 'code1', code_verifier: 'ver1', grant_type: 'authorization_code', client_secret: 'sec' })
  })
  it('missing refresh token → null', async () => {
    const { f } = fakeFetch([[/token/, 200, { access_token: 'at', scope: GOOGLE_SCOPE_MANAGE }]])
    expect((await makeGoogle(cfg(f)).exchangeCode('c', 'v')).refreshToken).toBeNull()
  })
  it('refresh with a revoked token → GoogleError invalid_grant', async () => {
    const { f } = fakeFetch([[/token/, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }]])
    const err = await makeGoogle(cfg(f)).refresh('rt').catch((e) => e)
    expect(err).toBeInstanceOf(GoogleError)
    expect(err.kind).toBe('invalid_grant')
    expect(isAuthError(err)).toBe(true)
  })
  it('revoke swallows errors (already revoked)', async () => {
    const { f } = fakeFetch([[/revoke/, 400, { error: 'invalid_token' }]])
    await expect(makeGoogle(cfg(f)).revoke('rt')).resolves.toBeUndefined()
  })
  it('refresh with a 200 but no access_token → GoogleError server (not an empty bearer)', async () => {
    const { f } = fakeFetch([[/token/, 200, {}]])
    const err = await makeGoogle(cfg(f)).refresh('rt').catch((e) => e)
    expect(err).toBeInstanceOf(GoogleError)
    expect(err.kind).toBe('server')
    expect(isAuthError(err)).toBe(false)
  })
  it('exchangeCode with a 200 but no access_token → GoogleError server', async () => {
    const { f } = fakeFetch([[/token/, 200, { scope: GOOGLE_SCOPE_MANAGE }]])
    const err = await makeGoogle(cfg(f)).exchangeCode('c', 'v').catch((e) => e)
    expect(err).toBeInstanceOf(GoogleError)
    expect(err.kind).toBe('server')
  })
})

describe('Business Profile', () => {
  it('pages accounts and locations, reads VoM', async () => {
    const { f, calls } = fakeFetch([
      [/accounts\?pageSize=20&pageToken=p2/, 200, { accounts: [{ name: 'accounts/2' }] }],
      [/accounts\?pageSize=20$/, 200, { accounts: [{ name: 'accounts/1' }], nextPageToken: 'p2' }],
      [/accounts\/1\/locations/, 200, { locations: [{ name: 'locations/9', title: 'Casa-Mia Wharf Side', storefrontAddress: { addressLines: ['1 Wharf Rd'], locality: 'London', postalCode: 'N1 7GR' }, metadata: { mapsUri: 'https://maps.google.com/?cid=9' } }] }],
      [/locations\/9\/VoiceOfMerchantState/, 200, { hasVoiceOfMerchant: true }],
    ])
    const g = makeGoogle(cfg(f))
    expect(await g.accounts('at')).toEqual(['accounts/1', 'accounts/2'])
    expect(await g.locations('at', 'accounts/1')).toEqual([{ name: 'locations/9', title: 'Casa-Mia Wharf Side', address: '1 Wharf Rd, London, N1 7GR', postcode: 'N1 7GR', mapsUri: 'https://maps.google.com/?cid=9' }])
    expect(await g.canReply('at', 'locations/9')).toBe(true)
    expect(calls.every((c) => (c.init?.headers as Record<string, string>)?.Authorization === 'Bearer at')).toBe(true)
    expect(calls[2].url).toContain('readMask=name,title,storefrontAddress,metadata')
  })
  it('lists reviews newest-updated first and parses them', async () => {
    const { f, calls } = fakeFetch([[/v4\/accounts\/1\/locations\/9\/reviews/, 200, {
      reviews: [
        { reviewId: 'r1', name: 'accounts/1/locations/9/reviews/r1', starRating: 'TWO', comment: 'Cold pasta', reviewer: { displayName: 'Sarah Kim' }, createTime: '2026-10-15T13:02:00Z', updateTime: '2026-10-15T13:02:00Z' },
        { reviewId: 'r2', starRating: 'FIVE', reviewer: { isAnonymous: true, displayName: 'A Google user' }, createTime: '2026-10-14T10:00:00Z', updateTime: '2026-10-14T10:00:00Z', reviewReply: { comment: 'Thanks!', updateTime: '2026-10-14T11:00:00Z' } },
        { reviewId: 'bad', starRating: 'STAR_RATING_UNSPECIFIED', updateTime: '2026-10-14T10:00:00Z' },
      ], nextPageToken: 'n2',
    }]])
    const res = await makeGoogle(cfg(f)).reviews('at', 'accounts/1', 'locations/9')
    expect(calls[0].url).toContain('orderBy=updateTime%20desc')
    expect(calls[0].url).toContain('pageSize=50')
    expect(res.next).toBe('n2')
    expect(res.reviews).toEqual([
      { reviewId: 'r1', name: 'accounts/1/locations/9/reviews/r1', stars: 2, comment: 'Cold pasta', reviewer: 'Sarah Kim', createTime: '2026-10-15T13:02:00Z', updateTime: '2026-10-15T13:02:00Z', reply: null, replyTime: null },
      { reviewId: 'r2', name: '', stars: 5, comment: '', reviewer: '', createTime: '2026-10-14T10:00:00Z', updateTime: '2026-10-14T10:00:00Z', reply: 'Thanks!', replyTime: '2026-10-14T11:00:00Z' },
    ])
  })
  it('putReply PUTs {comment}; 404 → not_found', async () => {
    const ok = fakeFetch([[/reviews\/r1\/reply/, 200, { comment: 'Hi' }]])
    await makeGoogle(cfg(ok.f)).putReply('at', 'accounts/1', 'locations/9', 'r1', 'Hi')
    expect(ok.calls[0].init?.method).toBe('PUT')
    expect(JSON.parse(String(ok.calls[0].init?.body))).toEqual({ comment: 'Hi' })
    const gone = fakeFetch([[/reply/, 404, { error: { message: 'Requested entity was not found.' } }]])
    const err = await makeGoogle(cfg(gone.f)).putReply('at', 'accounts/1', 'locations/9', 'r1', 'Hi').catch((e) => e)
    expect(err.kind).toBe('not_found')
  })
  it('network failure → server error, never the token in the message', async () => {
    const f = (async () => { throw new Error('boom secret-at') }) as unknown as typeof fetch
    const err = await makeGoogle(cfg(f)).email('secret-at').catch((e) => e)
    expect(err.kind).toBe('server')
    expect(err.message).not.toContain('secret-at')
  })
  it('every request carries an abort signal (timeout), and a timeout is a network server error', async () => {
    const ok = fakeFetch([[/userinfo/, 200, { email: 'a@b.c' }]])
    await makeGoogle(cfg(ok.f)).email('at')
    expect(ok.calls[0].init?.signal).toBeInstanceOf(AbortSignal)
    const aborting = (async () => { throw new DOMException('timed out', 'TimeoutError') }) as unknown as typeof fetch
    const err = await makeGoogle(cfg(aborting)).email('at').catch((e) => e)
    expect(err.kind).toBe('server')
    expect(err.message).toBe('network')
  })
})

describe('parsers', () => {
  it('parseReview rejects unknown ratings', () => expect(parseReview({ reviewId: 'x', starRating: 'ZERO', updateTime: 't' })).toBeNull())
  it('parseLocation without address', () => expect(parseLocation({ name: 'locations/1', title: 'X' })).toEqual({ name: 'locations/1', title: 'X', address: '', postcode: '', mapsUri: null }))
})
