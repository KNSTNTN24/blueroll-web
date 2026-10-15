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
  it('claimDelivery is one conditional UPDATE (id + version + notify on) returning the id', async () => {
    const { admin, queries } = recorder(() => ({ data: [{ id: 'r1' }], error: null }))
    expect(await makeReviewDeps(admin, google(async () => 'at')).claimDelivery('r1', 2)).toBe(true)
    expect(queries[0].ops.join(' ')).toMatch(/update\(\{"notify":false\}\).*eq\("id","r1"\).*eq\("version",2\).*eq\("notify",true\).*select\("id"\)/)
    const none = recorder(() => ({ data: [], error: null }))
    expect(await makeReviewDeps(none.admin, google(async () => 'at')).claimDelivery('r1', 2)).toBe(false)
  })
  it('setNotify is conditional on the version', async () => {
    const { admin, queries } = recorder(() => ({ data: null, error: null }))
    await makeReviewDeps(admin, google(async () => 'at')).setNotify('r1', 2, true)
    expect(queries[0].ops.join(' ')).toMatch(/update\(\{"notify":true\}\).*eq\("id","r1"\).*eq\("version",2\)/)
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
  it('routedGroups ignores removed sites (M2)', async () => {
    const { admin, queries } = recorder(() => ({ data: [
      { site: { removed_at: null }, group: { id: 'g1', business_id: 'b1', chat_id: '-100', channel: 'telegram_reviews', unlinked_at: null } },
      { site: { removed_at: '2026-10-01T00:00:00Z' }, group: { id: 'g2', business_id: 'b1', chat_id: '-200', channel: 'telegram_reviews', unlinked_at: null } },
    ], error: null }))
    expect(await makeReviewDeps(admin, google(async () => 'at')).routedGroups('b1', 's1')).toEqual([{ id: 'g1', business_id: 'b1', chat_id: '-100' }])
    const ops = queries[0].ops.join(' ')
    expect(ops).toContain('site:sites!inner(removed_at)')
    expect(ops).toContain('is("site.removed_at",null)')
  })
  it('enabledLocations skips locations whose site was removed (M2)', async () => {
    const { admin, queries } = recorder(() => ({ data: [
      { id: 'l1', site_id: 's1', enabled: true, site: { removed_at: null } },
      { id: 'l2', site_id: 's2', enabled: true, site: { removed_at: '2026-10-01T00:00:00Z' } },
    ], error: null }))
    expect(await makeReviewDeps(admin, google(async () => 'at')).enabledLocations('c1')).toEqual([{ id: 'l1', site_id: 's1', enabled: true }])
    const ops = queries[0].ops.join(' ')
    expect(ops).toContain('site:sites!inner(removed_at)')
    expect(ops).toContain('eq("connection_id","c1")')
    expect(ops).toContain('eq("enabled",true)')
    expect(ops).toContain('is("site.removed_at",null)')
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
  it('stillAllowed: active member of the business, holds manage_reviews, business entitled', async () => {
    const run = async (o: { profile?: unknown; caps?: unknown; entitled?: boolean }) => {
      const r = recorder((q) => {
        if (q.table === 'profiles') return { data: o.profile ?? null, error: null }
        if (q.table === 'rpc:profiles_with_capability') return { data: o.caps ?? [], error: null }
        if (q.table === 'rpc:is_business_entitled') return { data: o.entitled ?? false, error: null }
        return { data: null, error: null }
      })
      return { ok: await makeConnectDeps(r.admin, async () => {}).stillAllowed('p1', 'b1'), queries: r.queries }
    }
    const all = await run({ profile: { id: 'p1' }, caps: ['p1'], entitled: true })
    expect(all.ok).toBe(true)
    const prof = all.queries.find((q) => q.table === 'profiles')!.ops.join(' ')
    expect(prof).toContain('eq("id","p1")')
    expect(prof).toContain('eq("business_id","b1")')
    expect(prof).toContain('is("removed_at",null)')
    expect(all.queries.find((q) => q.table === 'rpc:profiles_with_capability')!.ops[0]).toBe('{"b":"b1","cap":"manage_reviews"}')
    expect((await run({ caps: ['p1'], entitled: true })).ok).toBe(false)
    expect((await run({ profile: { id: 'p1' }, caps: [{ profiles_with_capability: 'p2' }], entitled: true })).ok).toBe(false)
    expect((await run({ profile: { id: 'p1' }, caps: [{ profiles_with_capability: 'p1' }], entitled: false })).ok).toBe(false)
  })
  it('takeState is one conditional UPDATE (unused, unexpired)', async () => {
    const { admin, queries } = recorder(() => ({ data: [{ state: 'S', business_id: 'b1', profile_id: 'p1', code_verifier: 'V', expires_at: 'x' }], error: null }))
    const st = await makeConnectDeps(admin, async () => {}).takeState('S', new Date('2026-10-15T12:00:00Z'))
    expect(st).toMatchObject({ state: 'S', business_id: 'b1' })
    const ops = queries[0].ops.join(' ')
    expect(ops).toContain('is("used_at",null)')
    expect(ops).toContain('gt("expires_at","2026-10-15T12:00:00.000Z")')
  })
  it('previousMapping keeps the newest row per Google location, with its start and cursors', async () => {
    const { admin, queries } = recorder(() => ({ data: [
      { gbp_location: 'locations/9', site_id: 's-new', enabled: true, enabled_at: '2026-03-01T00:00:00Z', last_review_update_time: '2026-09-30T08:00:00Z', last_full_pass_at: '2026-09-30T00:00:00Z' },
      { gbp_location: 'locations/9', site_id: 's-old', enabled: false, enabled_at: null, last_review_update_time: null, last_full_pass_at: null },
    ], error: null }))
    const m = await makeConnectDeps(admin, async () => {}).previousMapping('b1')
    expect(m.get('locations/9')).toEqual({ site_id: 's-new', enabled: true, enabled_at: '2026-03-01T00:00:00Z', last_review_update_time: '2026-09-30T08:00:00Z', last_full_pass_at: '2026-09-30T00:00:00Z' })
    expect(queries[0].ops.join(' ')).toContain('enabled_at, last_review_update_time, last_full_pass_at')
  })
  it('upsertLocations inserts a new row with its carried start and cursors', async () => {
    const { admin, queries } = recorder((q) => ({ data: q.ops.some((o) => o.startsWith('maybeSingle')) ? null : [], error: null }))
    await makeConnectDeps(admin, async () => {}).upsertLocations([{
      connection_id: 'c2', business_id: 'b1', gbp_account: 'accounts/1', gbp_location: 'locations/9', title: 'T', address: '', postcode: '',
      maps_uri: null, can_reply: true, site_id: 's1', enabled: true, enabled_at: '2026-03-01T00:00:00Z', last_review_update_time: '2026-09-30T08:00:00Z', last_full_pass_at: null,
    }])
    const ins = queries.find((q) => q.ops.some((o) => o.startsWith('insert(')))!
    expect(ins.ops.join(' ')).toContain('"enabled_at":"2026-03-01T00:00:00Z","last_review_update_time":"2026-09-30T08:00:00Z"')
  })
  it('repointReviews moves reviews of older rows of the same Google location to the new row (and its site)', async () => {
    const { admin, queries } = recorder((q) => {
      const ops = q.ops.join(' ')
      if (q.table === 'google_locations' && ops.includes('eq("connection_id","c2")')) return { data: [{ id: 'l2', gbp_location: 'locations/9', site_id: 's1' }, { id: 'l3', gbp_location: 'locations/7', site_id: null }], error: null }
      if (q.table === 'google_locations' && ops.includes('eq("gbp_location","locations/9")')) return { data: [{ id: 'l1' }, { id: 'l0' }], error: null }
      if (q.table === 'google_locations' && ops.includes('eq("gbp_location","locations/7")')) return { data: [{ id: 'l5' }], error: null }
      return { data: [], error: null }
    })
    await makeConnectDeps(admin, async () => {}).repointReviews('b1', 'c2')
    const upd = queries.filter((q) => q.table === 'reviews').map((q) => q.ops.join(' '))
    expect(upd).toHaveLength(2)
    expect(upd[0]).toContain('update({"location_id":"l2","site_id":"s1"})')
    expect(upd[0]).toContain('eq("business_id","b1")')
    expect(upd[0]).toContain('in("location_id",["l1","l0"])')
    expect(upd[1]).toContain('update({"location_id":"l3"})')
    expect(upd[1]).toContain('in("location_id",["l5"])')
    const olderQ = queries.filter((q) => q.table === 'google_locations' && q.ops.join(' ').includes('gbp_location","locations/9'))[0].ops.join(' ')
    expect(olderQ).toContain('eq("business_id","b1")')
    expect(olderQ).toContain('neq("id","l2")')
  })
})
