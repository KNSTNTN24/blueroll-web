import { describe, it, expect } from 'vitest'
import { makeReviewDeps, makeConnectDeps } from '../../../../supabase/functions/_shared/reviews/reviews-db'
import { GoogleError, type Google } from '../../../../supabase/functions/_shared/reviews/google'
import { CONN, ANNA } from './fakes/review-deps'

type Q = { table: string; ops: string[] }
function recorder(respond: (q: Q) => { data: unknown; error: unknown } = () => ({ data: [], error: null })) {
  const queries: Q[] = []
  const chain = (q: Q): any => new Proxy({}, {
    get(_t, k: string) {
      if (k === 'then') return (res: any, rej: any) => Promise.resolve(respond(q)).then(res, rej)
      return (...args: unknown[]) => { q.ops.push(`${k}(${args.map((a) => JSON.stringify(a)).join(',')})`); return chain(q) }
    },
  })
  const admin = {
    from: (table: string) => { const q = { table, ops: [] as string[] }; queries.push(q); return chain(q) },
    rpc: (fn: string, args: unknown) => { const q = { table: `rpc:${fn}`, ops: [JSON.stringify(args)] }; queries.push(q); return chain(q) },
  }
  return { admin, queries }
}
const google = (refresh: Google['refresh']): Google => ({ refresh } as unknown as Google)

describe('makeReviewDeps', () => {
  it('claimPublishing is one conditional UPDATE on id + version + publishable status', async () => {
    const { admin, queries } = recorder(() => ({ data: [{ id: 'r1' }], error: null }))
    expect(await makeReviewDeps(admin, google(async () => 'at')).claimPublishing('r1', 3, ANNA)).toBe(true)
    const ops = queries[0].ops.join(' ')
    expect(queries[0].table).toBe('reviews')
    expect(ops).toContain('"status":"publishing"')
    expect(ops).toContain('eq("id","r1")')
    expect(ops).toContain('eq("version",3)')
    expect(ops).toContain('in("status",["new","drafted","skipped"])')
  })
  it('markDelivered clears notify only for that version', async () => {
    const { admin, queries } = recorder(() => ({ data: null, error: null }))
    await makeReviewDeps(admin, google(async () => 'at')).markDelivered('r1', 2)
    expect(queries[0].ops.join(' ')).toMatch(/update\(\{"delivered_version":2,"notify":false\}\).*eq\("id","r1"\).*eq\("version",2\)/)
  })
  it('routedGroups only returns linked reviews groups of the same business', async () => {
    const { admin, queries } = recorder(() => ({ data: [
      { group: { id: 'g1', business_id: 'b1', chat_id: '-100', channel: 'telegram_reviews', unlinked_at: null } },
      { group: { id: 'g2', business_id: 'OTHER', chat_id: '-200', channel: 'telegram_reviews', unlinked_at: null } },
    ], error: null }))
    expect(await makeReviewDeps(admin, google(async () => 'at')).routedGroups('b1', 's1')).toEqual([{ id: 'g1', business_id: 'b1', chat_id: '-100' }])
    const ops = queries[0].ops.join(' ')
    expect(ops).toContain('eq("group.channel","telegram_reviews")')
    expect(ops).toContain('is("group.unlinked_at",null)')
    expect(ops).toContain('eq("business_id","b1")')
  })
  it('connectionFailed flips only an active connection', async () => {
    const { admin, queries } = recorder(() => ({ data: [], error: null }))
    expect(await makeReviewDeps(admin, google(async () => 'at')).connectionFailed(CONN, 'revoked')).toBe(false)
    expect(queries[0].ops.join(' ')).toContain('eq("status","active")')
  })
  it('accessToken refreshes once per connection and caches; no stored token → invalid_grant', async () => {
    let n = 0
    const { admin } = recorder((q) => (q.table === 'rpc:reviews_read_token' ? { data: 'rt1', error: null } : { data: null, error: null }))
    const d = makeReviewDeps(admin, google(async () => `at${++n}`))
    expect(await d.accessToken(CONN)).toBe('at1')
    expect(await d.accessToken(CONN)).toBe('at1')
    const none = makeReviewDeps(recorder(() => ({ data: null, error: null })).admin, google(async () => 'x'))
    const err = await none.accessToken(CONN).catch((e) => e)
    expect(err).toBeInstanceOf(GoogleError)
    expect(err.kind).toBe('invalid_grant')
  })
  it('reviewManagerIds accepts either shape PostgREST returns for setof uuid', async () => {
    const a = recorder(() => ({ data: ['p1', 'p2'], error: null }))
    expect(await makeReviewDeps(a.admin, google(async () => 'at')).reviewManagerIds('b1')).toEqual(['p1', 'p2'])
    const b = recorder(() => ({ data: [{ profiles_with_capability: 'p1' }], error: null }))
    expect(await makeReviewDeps(b.admin, google(async () => 'at')).reviewManagerIds('b1')).toEqual(['p1'])
  })
  it('lastDraftVersion reads the highest draft_version of the review (any review_version); 0 when none', async () => {
    const a = recorder(() => ({ data: [{ draft_version: 7 }], error: null }))
    expect(await makeReviewDeps(a.admin, google(async () => 'at')).lastDraftVersion('r1')).toBe(7)
    expect(a.queries[0].table).toBe('review_drafts')
    const ops = a.queries[0].ops.join(' ')
    expect(ops).toContain('eq("review_id","r1")')
    expect(ops).toContain('order("draft_version",{"ascending":false})')
    expect(ops).toContain('limit(1)')
    expect(ops).not.toContain('review_version')
    const none = recorder(() => ({ data: [], error: null }))
    expect(await makeReviewDeps(none.admin, google(async () => 'at')).lastDraftVersion('r1')).toBe(0)
  })
  it('releaseStalePublishing releases only old publishing rows and returns the count', async () => {
    const { admin, queries } = recorder(() => ({ data: [{ id: 'r1' }, { id: 'r2' }], error: null }))
    const n = await makeReviewDeps(admin, google(async () => 'at')).releaseStalePublishing(new Date('2026-10-15T12:00:00Z'))
    expect(n).toBe(2)
    const ops = queries[0].ops.join(' ')
    expect(queries[0].table).toBe('reviews')
    expect(ops).toContain('update({"status":"drafted","publishing_by":null,"publishing_at":null})')
    expect(ops).toContain('eq("status","publishing")')
    expect(ops).toContain('lt("publishing_at","2026-10-15T12:00:00.000Z")')
  })
  it('insertDraft rethrows the original error so the unique-violation code survives', async () => {
    const { admin } = recorder(() => ({ data: null, error: { message: 'dup', code: '23505' } }))
    const err = await makeReviewDeps(admin, google(async () => 'at'))
      .insertDraft({ review_id: 'r1', review_version: 1, draft_version: 1, text: 't', source: 'ai', actor: null }).catch((e) => e)
    expect(err.code).toBe('23505')
  })
  it('errors are thrown, not swallowed', async () => {
    const { admin } = recorder(() => ({ data: null, error: { message: 'boom' } }))
    await expect(makeReviewDeps(admin, google(async () => 'at')).review('r1')).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('makeConnectDeps', () => {
  it('takeState is one conditional UPDATE (unused, unexpired)', async () => {
    const { admin, queries } = recorder(() => ({ data: [{ state: 'S', business_id: 'b1', profile_id: 'p1', code_verifier: 'V', expires_at: 'x' }], error: null }))
    const st = await makeConnectDeps(admin, async () => {}).takeState('S', new Date('2026-10-15T12:00:00Z'))
    expect(st).toMatchObject({ state: 'S', business_id: 'b1' })
    const ops = queries[0].ops.join(' ')
    expect(ops).toContain('is("used_at",null)')
    expect(ops).toContain('gt("expires_at","2026-10-15T12:00:00.000Z")')
  })
  it('previousMapping keeps the newest row per Google location', async () => {
    const { admin } = recorder(() => ({ data: [
      { gbp_location: 'locations/9', site_id: 's-new', enabled: true },
      { gbp_location: 'locations/9', site_id: 's-old', enabled: false },
    ], error: null }))
    const m = await makeConnectDeps(admin, async () => {}).previousMapping('b1')
    expect(m.get('locations/9')).toEqual({ site_id: 's-new', enabled: true })
  })
})
