import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleConnect, pkceChallenge, randomToken, type ConnectDeps, type OAuthState, type LocationUpsert, type PrevLocation } from '../../../../supabase/functions/_shared/reviews/connect'
import { GoogleError, GOOGLE_SCOPE_MANAGE, type Google, type GLocation } from '../../../../supabase/functions/_shared/reviews/google'
import type { Connection } from '../../../../supabase/functions/_shared/reviews/types'

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

const NOW = new Date('2026-10-15T12:00:00Z')
const ME = { profile_id: 'p1', business_id: 'b1', name: 'Anna S.' }

type PrevIn = Pick<PrevLocation, 'site_id' | 'enabled'> & Partial<PrevLocation>
function fakeDeps(o: { states?: OAuthState[]; conns?: Connection[]; prevMap?: [string, PrevIn][] } = {}) {
  const s = {
    states: o.states ?? [], conns: o.conns ?? [] as Connection[], secrets: new Map<string, string>([['sec-old', 'rt-old']]),
    locations: [] as LocationUpsert[], disconnected: [] as string[], repointed: [] as string[],
  }
  const d: ConnectDeps = {
    now: () => NOW,
    saveState: async (st) => { s.states.push({ ...st }) },
    takeState: async (st, now) => {
      const i = s.states.findIndex((x) => x.state === st && Date.parse(x.expires_at) > now.getTime())
      return i < 0 ? null : s.states.splice(i, 1)[0]
    },
    liveConnection: async (b) => s.conns.find((c) => c.business_id === b && c.status !== 'revoked') ?? null,
    storeToken: async (t) => { const id = `sec-${s.secrets.size}`; s.secrets.set(id, t); return id },
    readToken: async (id) => s.secrets.get(id) ?? null,
    deleteToken: async (id) => { s.secrets.delete(id) },
    insertConnection: async (c) => { const row: Connection = { id: `c${s.conns.length + 1}`, business_id: c.business_id, google_email: c.google_email, vault_secret_id: c.vault_secret_id, status: 'active', connected_at: c.now.toISOString(), last_sync_at: null }; s.conns.push(row); return row },
    markRevoked: async (id) => { const c = s.conns.find((x) => x.id === id)!; c.status = 'revoked' },
    previousMapping: async () => new Map((o.prevMap ?? []).map(([k, v]) => [k, { enabled_at: null, last_review_update_time: null, last_full_pass_at: null, ...v }])),
    upsertLocations: async (rows) => { s.locations.push(...rows) },
    repointReviews: async (b, cid) => { s.repointed.push(`${b} ${cid}`) },
    sites: async () => [{ id: 'site1', name: 'Wharf Side', postcode: 'N1 7GR', timezone: 'Europe/London' }],
    onDisconnected: async (b) => { s.disconnected.push(b) },
  }
  return { d, s }
}

function fakeGoogle(o: { scopes?: readonly string[]; refresh?: string | null; accounts?: readonly string[]; locs?: Record<string, GLocation[]>; vom?: Record<string, boolean | 'err'>; exchangeFails?: boolean } = {}) {
  const calls: string[] = []
  const g: Google = {
    authUrl: (st, ch) => `https://accounts.google.com/auth?state=${st}&code_challenge=${ch}`,
    exchangeCode: async (code, ver) => {
      calls.push(`exchange ${code} ${ver}`)
      if (o.exchangeFails) throw new GoogleError('bad_request', 400, 'invalid_grant')
      return { accessToken: 'at', refreshToken: o.refresh === undefined ? 'rt-new' : o.refresh, scopes: [...(o.scopes ?? [GOOGLE_SCOPE_MANAGE, 'openid', 'email'])] }
    },
    refresh: async (rt) => { calls.push(`refresh ${rt}`); return 'at2' },
    revoke: async (t) => { calls.push(`revoke ${t}`) },
    email: async () => 'owner@casamia.co.uk',
    accounts: async () => [...(o.accounts ?? ['accounts/1'])],
    locations: async (_at, a) => (o.locs ?? { 'accounts/1': [{ name: 'locations/9', title: 'Casa-Mia Wharf Side', address: '1 Wharf Rd, N1 7GR', postcode: 'N1 7GR', mapsUri: 'https://maps/9' }] })[a] ?? [],
    canReply: async (_at, l) => { const v = (o.vom ?? {})[l] ?? true; if (v === 'err') throw new GoogleError('not_found', 404, 'x'); return v },
    reviews: async () => ({ reviews: [], next: null }),
    putReply: async () => {},
  }
  return { g, calls }
}

describe('pkce', () => {
  it('RFC 7636 appendix B', async () => expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'))
  it('random tokens are url-safe and long enough', () => { const t = randomToken(32); expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(randomToken(32)).not.toBe(t) })
})

describe('start', () => {
  it('needs a caller; stores a 10-minute state with a verifier and returns the Google URL', async () => {
    const { d, s } = fakeDeps(); const { g } = fakeGoogle()
    expect((await handleConnect(d, g, null, { action: 'start' })).status).toBe(401)
    const r = await handleConnect(d, g, ME, { action: 'start' })
    expect(r.status).toBe(200)
    expect(s.states).toHaveLength(1)
    const st = s.states[0]
    expect(st).toMatchObject({ business_id: 'b1', profile_id: 'p1', expires_at: '2026-10-15T12:10:00.000Z' })
    expect(st.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(String(r.body.url)).toContain(`state=${st.state}`)
    expect(String(r.body.url)).toContain(`code_challenge=${await pkceChallenge(st.code_verifier)}`)
  })
})

describe('finish', () => {
  const state = (o: Partial<OAuthState> = {}): OAuthState => ({ state: 'S', business_id: 'b1', profile_id: 'p1', code_verifier: 'V', expires_at: '2026-10-15T12:05:00Z', ...o })

  it('happy path: token to Vault, connection, locations with suggested site (disabled until the manager turns them on)', async () => {
    const { d, s } = fakeDeps({ states: [state()] }); const { g, calls } = fakeGoogle()
    const r = await handleConnect(d, g, null, { action: 'finish', code: 'C', state: 'S' })
    expect(r.body).toEqual({ result: 'connected' })
    expect(calls).toContain('exchange C V')
    expect([...s.secrets.values()]).toContain('rt-new')
    expect(s.conns).toEqual([expect.objectContaining({ business_id: 'b1', google_email: 'owner@casamia.co.uk', status: 'active' })])
    expect(s.locations).toEqual([expect.objectContaining({ gbp_account: 'accounts/1', gbp_location: 'locations/9', title: 'Casa-Mia Wharf Side', postcode: 'N1 7GR', maps_uri: 'https://maps/9', can_reply: true, site_id: 'site1', enabled: false })])
  })
  it('state is single use', async () => {
    const { d } = fakeDeps({ states: [state()] }); const { g } = fakeGoogle()
    await handleConnect(d, g, null, { action: 'finish', code: 'C', state: 'S' })
    expect((await handleConnect(d, g, null, { action: 'finish', code: 'C', state: 'S' })).body).toEqual({ error: 'expired' })
  })
  it('expired state → expired, and no code exchange', async () => {
    const { d } = fakeDeps({ states: [state({ expires_at: '2026-10-15T11:59:00Z' })] }); const { g, calls } = fakeGoogle()
    expect((await handleConnect(d, g, null, { action: 'finish', code: 'C', state: 'S' })).body).toEqual({ error: 'expired' })
    expect(calls).toEqual([])
  })
  it('consent denied (Google sends error=access_denied) → denied, state burnt', async () => {
    const { d, s } = fakeDeps({ states: [state()] }); const { g } = fakeGoogle()
    expect((await handleConnect(d, g, null, { action: 'finish', state: 'S', error: 'access_denied' })).body).toEqual({ error: 'denied' })
    expect(s.states).toEqual([])
  })
  it('missing business.manage scope → missing_scope, token revoked, nothing stored', async () => {
    const { d, s } = fakeDeps({ states: [state()] }); const { g, calls } = fakeGoogle({ scopes: ['openid', 'email'] })
    expect((await handleConnect(d, g, null, { action: 'finish', code: 'C', state: 'S' })).body).toEqual({ error: 'missing_scope' })
    expect(calls).toContain('revoke rt-new')
    expect(s.conns).toEqual([])
  })
  it('no refresh token → no_refresh_token', async () => {
    const { d, s } = fakeDeps({ states: [state()] }); const { g } = fakeGoogle({ refresh: null })
    expect((await handleConnect(d, g, null, { action: 'finish', code: 'C', state: 'S' })).body).toEqual({ error: 'no_refresh_token' })
    expect(s.conns).toEqual([])
  })
  it('no accounts / no locations → error and the grant is revoked', async () => {
    for (const [opts, err] of [[{ accounts: [] }, 'no_accounts'], [{ locs: {} }, 'no_locations']] as const) {
      const { d, s } = fakeDeps({ states: [state()] }); const { g, calls } = fakeGoogle(opts)
      expect((await handleConnect(d, g, null, { action: 'finish', code: 'C', state: 'S' })).body).toEqual({ error: err })
      expect(calls).toContain('revoke rt-new')
      expect(s.conns).toEqual([])
    }
  })
  it('exchange failure → google', async () => {
    const { d } = fakeDeps({ states: [state()] }); const { g } = fakeGoogle({ exchangeFails: true })
    expect((await handleConnect(d, g, null, { action: 'finish', code: 'C', state: 'S' })).body).toEqual({ error: 'google' })
  })
  it('unverified location (no voice of merchant, or VoM call fails) → can_reply false, never enabled', async () => {
    const { d, s } = fakeDeps({ states: [state()], prevMap: [['locations/9', { site_id: 'site1', enabled: true }]] })
    const { g } = fakeGoogle({ vom: { 'locations/9': 'err' } })
    await handleConnect(d, g, null, { action: 'finish', code: 'C', state: 'S' })
    expect(s.locations[0]).toMatchObject({ can_reply: false, enabled: false, site_id: 'site1' })
  })
  it('the same location under two accounts is stored once', async () => {
    const loc = { name: 'locations/9', title: 'X', address: '', postcode: '', mapsUri: null }
    const { d, s } = fakeDeps({ states: [state()] }); const { g } = fakeGoogle({ accounts: ['accounts/1', 'accounts/2'], locs: { 'accounts/1': [loc], 'accounts/2': [loc] } })
    await handleConnect(d, g, null, { action: 'finish', code: 'C', state: 'S' })
    expect(s.locations.map((l) => l.gbp_account)).toEqual(['accounts/1'])
  })
  it('finish replaces a previous connection without calling revoke (Review Focus 1) and keeps the mapping', async () => {
    const old: Connection = { id: 'c0', business_id: 'b1', google_email: 'old@x', vault_secret_id: 'sec-old', status: 'active', connected_at: '2026-01-01T00:00:00Z', last_sync_at: null }
    const { d, s } = fakeDeps({ states: [state()], conns: [old], prevMap: [['locations/9', { site_id: 'site1', enabled: true }]] })
    const { g, calls } = fakeGoogle()
    await handleConnect(d, g, null, { action: 'finish', code: 'C', state: 'S' })
    expect(calls.filter((c) => c.startsWith('revoke'))).toEqual([])
    expect(s.secrets.has('sec-old')).toBe(false)
    expect(old.status).toBe('revoked')
    expect(s.conns.filter((c) => c.status === 'active')).toHaveLength(1)
    expect(s.locations[0]).toMatchObject({ site_id: 'site1', enabled: true })
  })
})

describe('disconnect', () => {
  it('revokes at Google, deletes the Vault secret, marks revoked, refreshes cards', async () => {
    const old: Connection = { id: 'c0', business_id: 'b1', google_email: 'old@x', vault_secret_id: 'sec-old', status: 'error', connected_at: '2026-01-01T00:00:00Z', last_sync_at: null }
    const { d, s } = fakeDeps({ conns: [old] }); const { g, calls } = fakeGoogle()
    expect((await handleConnect(d, g, ME, { action: 'disconnect' })).body).toEqual({ ok: true })
    expect(calls).toContain('revoke rt-old')
    expect(s.secrets.has('sec-old')).toBe(false)
    expect(old.status).toBe('revoked')
    expect(s.disconnected).toEqual(['b1'])
  })
  it('nothing connected → ok, no calls', async () => {
    const { d } = fakeDeps(); const { g, calls } = fakeGoogle()
    expect((await handleConnect(d, g, ME, { action: 'disconnect' })).body).toEqual({ ok: true })
    expect(calls).toEqual([])
  })
})

describe('refresh', () => {
  it('re-reads locations with the stored token', async () => {
    const live: Connection = { id: 'c0', business_id: 'b1', google_email: 'x', vault_secret_id: 'sec-old', status: 'active', connected_at: '2026-01-01T00:00:00Z', last_sync_at: null }
    const { d, s } = fakeDeps({ conns: [live] }); const { g, calls } = fakeGoogle()
    const r = await handleConnect(d, g, ME, { action: 'refresh' })
    expect(r.body).toEqual({ ok: true, locations: 1 })
    expect(calls).toContain('refresh rt-old')
    expect(s.locations[0]).toMatchObject({ connection_id: 'c0', gbp_location: 'locations/9' })
  })
  it('unknown action → 400', async () => {
    const { d } = fakeDeps(); const { g } = fakeGoogle()
    expect((await handleConnect(d, g, ME, { action: 'nope' })).status).toBe(400)
  })
})

const liveConn = (o: Partial<Connection> = {}): Connection => ({ id: 'c0', business_id: 'b1', google_email: 'old@x', vault_secret_id: 'sec-old', status: 'active', connected_at: '2026-01-01T00:00:00Z', last_sync_at: null, ...o })
const stateX = (): OAuthState => ({ state: 'S', business_id: 'b1', profile_id: 'p1', code_verifier: 'V', expires_at: '2026-10-15T12:05:00Z' })
const fin = { action: 'finish', code: 'C', state: 'S' }

describe('fix round 1', () => {
  it('abandon paths do not revoke when a live connection exists, and store nothing', async () => {
    for (const [opts, err] of [[{ scopes: ['openid'] }, 'missing_scope'], [{ locs: {} }, 'no_locations'], [{ accounts: [] }, 'no_accounts'], [{ refresh: null }, 'no_refresh_token']] as const) {
      const { d, s } = fakeDeps({ states: [stateX()], conns: [liveConn()] }); const { g, calls } = fakeGoogle(opts)
      expect((await handleConnect(d, g, null, fin)).body).toEqual({ error: err })
      expect(calls.filter((c) => c.startsWith('revoke'))).toEqual([])
      expect([...s.secrets.keys()]).toEqual(['sec-old'])
    }
  })
  it('without a live connection missing_scope and no_locations store nothing in Vault', async () => {
    for (const opts of [{ scopes: ['openid'] }, { locs: {} }]) {
      const { d, s } = fakeDeps({ states: [stateX()] }); const { g } = fakeGoogle(opts)
      await handleConnect(d, g, null, fin)
      expect([...s.secrets.keys()]).toEqual(['sec-old'])
    }
  })
  it('no_refresh_token revokes the access token when nothing is live', async () => {
    const { d } = fakeDeps({ states: [stateX()] }); const { g, calls } = fakeGoogle({ refresh: null })
    await handleConnect(d, g, null, fin)
    expect(calls).toContain('revoke at')
  })
  it('insertConnection failure: google error, new secret deleted, previous secret kept, new token revoked only if nothing live', async () => {
    for (const live of [true, false]) {
      const old = liveConn()
      const { d, s } = fakeDeps({ states: [stateX()], conns: live ? [old] : [] }); const { g, calls } = fakeGoogle()
      d.insertConnection = async () => { throw new Error('db down') }
      expect((await handleConnect(d, g, null, fin)).body).toEqual({ error: 'google' })
      expect(s.secrets.has('sec-old')).toBe(true)
      expect([...s.secrets.keys()]).toEqual(['sec-old'])
      expect(calls.some((c) => c.startsWith('revoke'))).toBe(!live)
    }
  })
  it('upsertLocations failure: google error, connection kept, previous secret already deleted', async () => {
    const { d, s } = fakeDeps({ states: [stateX()], conns: [liveConn()] }); const { g } = fakeGoogle()
    d.upsertLocations = async () => { throw new Error('db down') }
    expect((await handleConnect(d, g, null, fin)).body).toEqual({ error: 'google' })
    expect(s.conns.filter((c) => c.status === 'active')).toHaveLength(1)
    expect(s.secrets.has('sec-old')).toBe(false)
  })
  it('refresh: a Voice-of-Merchant error returns 502 and upserts nothing', async () => {
    const { d, s } = fakeDeps({ conns: [liveConn()] }); const { g } = fakeGoogle({ vom: { 'locations/9': 'err' } })
    const r = await handleConnect(d, g, ME, { action: 'refresh' })
    expect(r.status).toBe(502)
    expect(s.locations).toEqual([])
  })
  it('refresh on an error-status connection → 409', async () => {
    const { d } = fakeDeps({ conns: [liveConn({ status: 'error' })] }); const { g } = fakeGoogle()
    expect((await handleConnect(d, g, ME, { action: 'refresh' })).status).toBe(409)
  })
  it('disconnect and refresh need a caller', async () => {
    const { d } = fakeDeps(); const { g } = fakeGoogle()
    expect((await handleConnect(d, g, null, { action: 'disconnect' })).status).toBe(401)
    expect((await handleConnect(d, g, null, { action: 'refresh' })).status).toBe(401)
  })
  it('finish with error and an unknown state → denied', async () => {
    const { d } = fakeDeps(); const { g } = fakeGoogle()
    expect((await handleConnect(d, g, null, { action: 'finish', state: 'nope', error: 'access_denied' })).body).toEqual({ error: 'denied' })
  })
})

describe('reconnect carries location state (C2, I2)', () => {
  const PREV: PrevIn = { site_id: 'site1', enabled: true, enabled_at: '2026-03-01T00:00:00Z', last_review_update_time: '2026-09-30T08:00:00Z', last_full_pass_at: '2026-09-30T00:00:00Z' }
  it('finish carries site, enabled, enabled_at and both cursors from the previous row, then re-points reviews', async () => {
    const { d, s } = fakeDeps({ states: [stateX()], conns: [liveConn()], prevMap: [['locations/9', PREV]] }); const { g } = fakeGoogle()
    expect((await handleConnect(d, g, null, fin)).body).toEqual({ result: 'connected' })
    expect(s.locations[0]).toMatchObject({
      connection_id: 'c2', site_id: 'site1', enabled: true, enabled_at: '2026-03-01T00:00:00Z',
      last_review_update_time: '2026-09-30T08:00:00Z', last_full_pass_at: '2026-09-30T00:00:00Z',
    })
    expect(s.repointed).toEqual(['b1 c2'])
  })
  it('an enabled location without a previous enabled_at gets now', async () => {
    const { d, s } = fakeDeps({ states: [stateX()], prevMap: [['locations/9', { site_id: 'site1', enabled: true }]] }); const { g } = fakeGoogle()
    await handleConnect(d, g, null, fin)
    expect(s.locations[0]).toMatchObject({ enabled: true, enabled_at: NOW.toISOString() })
  })
  it('a location with no previous row stays off with empty state', async () => {
    const { d, s } = fakeDeps({ states: [stateX()] }); const { g } = fakeGoogle()
    await handleConnect(d, g, null, fin)
    expect(s.locations[0]).toMatchObject({ enabled: false, enabled_at: null, last_review_update_time: null, last_full_pass_at: null })
  })
  it('refresh also re-points (no-op when nothing is left behind) and keeps the carried state', async () => {
    const { d, s } = fakeDeps({ conns: [liveConn()], prevMap: [['locations/9', PREV]] }); const { g } = fakeGoogle()
    await handleConnect(d, g, ME, { action: 'refresh' })
    expect(s.locations[0]).toMatchObject({ enabled_at: '2026-03-01T00:00:00Z', last_review_update_time: '2026-09-30T08:00:00Z' })
    expect(s.repointed).toEqual(['b1 c0'])
  })
})
