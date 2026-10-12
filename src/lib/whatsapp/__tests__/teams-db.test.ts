import { describe, it, expect } from 'vitest'
import { makeTeamDeps, MEMBER_PROFILE_FK } from '../../../../supabase/functions/_shared/channels/teams-db'
import { fakeTeamDeps, BEN, ANNA, member, tpl } from './fakes/team-deps'

// Chainable PostgREST stand-in: records every builder call per query; `answer(q)` decides each query's result.
type Q = { table: string; ops: [string, ...any[]][] }
function proxyAdmin(answer: (q: Q) => { data: any; error: any }) {
  const queries: Q[] = []
  const admin = {
    from: (table: string) => {
      const q: Q = { table, ops: [] }
      queries.push(q)
      const b: any = new Proxy({}, {
        get: (_t, k: string) => k === 'then'
          ? (res: any, rej: any) => Promise.resolve(answer(q)).then(res, rej)
          : (...args: any[]) => { q.ops.push([k, ...args]); return b },
      })
      return b
    },
    rpc: async () => ({ data: true, error: null }),
  }
  return { admin, queries }
}
const op = (q: Q, name: string) => q.ops.find((o) => o[0] === name)
const ops = (q: Q, name: string) => q.ops.filter((o) => o[0] === name)
const KEY = { group_id: 'g1', template_id: 't', site_id: 's1', period_key: '2026-10-14' }

describe('makeTeamDeps', () => {
  it('claimEvent: insert wins once; a duplicate key (23505) is "already sent"; other errors throw', async () => {
    let code: string | null = null
    const { admin, queries } = proxyAdmin(() => ({ data: null, error: code ? { code, message: 'x' } : null }))
    const t = makeTeamDeps(admin)
    expect(await t.claimEvent('g1', 'day_end', '2026-10-14')).toBe(true)
    expect(op(queries[0], 'insert')![1]).toEqual({ group_id: 'g1', kind: 'day_end', key: '2026-10-14' })
    code = '23505'
    expect(await t.claimEvent('g1', 'day_end', '2026-10-14')).toBe(false)
    code = '42P01'
    await expect(t.claimEvent('g1', 'day_end', '2026-10-14')).rejects.toMatchObject({ code: '42P01' })
  })
  it('claimTake: one multi-row INSERT for every live WhatsApp team mapping the checklist at the site, in group id order', async () => {
    const { admin, queries } = proxyAdmin((q) => (q.table === 'channel_group_checklists'
      ? { data: [{ group_id: 'g2' }, { group_id: 'g1' }], error: null } : { data: null, error: null }))
    const now = new Date('2026-10-14T09:40:00Z')
    // Submitted from g2: rows still go g1, g2 — concurrent claims lock in the same order (no deadlock).
    expect(await makeTeamDeps(admin).claimTake({ ...KEY, group_id: 'g2' }, 'p1', now)).toBe(true)
    const [look, ins] = queries
    expect(look.table).toBe('channel_group_checklists')
    expect(String(op(look, 'select')![1])).toContain('team:channel_groups!inner(')
    expect(ops(look, 'eq')).toEqual([['eq', 'template_id', 't'], ['eq', 'team.channel', 'whatsapp'], ['eq', 'team.site_id', 's1']])
    expect(op(look, 'is')).toEqual(['is', 'team.unlinked_at', null])
    expect(ins.table).toBe('channel_group_takes')
    const row = { template_id: 't', site_id: 's1', period_key: '2026-10-14', profile_id: 'p1', taken_at: now.toISOString() }
    expect(op(ins, 'insert')![1]).toEqual([{ group_id: 'g1', ...row }, { group_id: 'g2', ...row }])
    expect(queries).toHaveLength(2)
  })
  it('claimTake: a conflict on any row (23505) or a deadlock with a concurrent claim (40P01) loses the take; other errors throw', async () => {
    let code = '23505'
    const { admin } = proxyAdmin((q) => (q.table === 'channel_group_checklists' ? { data: [], error: null } : { data: null, error: { code, message: 'x' } }))
    const t = makeTeamDeps(admin)
    expect(await t.claimTake(KEY, 'p1', new Date())).toBe(false)
    code = '40P01'
    expect(await t.claimTake(KEY, 'p1', new Date())).toBe(false)
    code = '42P01'
    await expect(t.claimTake(KEY, 'p1', new Date())).rejects.toMatchObject({ code: '42P01' })
  })
  it('takeOwner: any team\'s take of that checklist/site/period; releaseTake: every row of the taker\'s claim', async () => {
    const { admin, queries } = proxyAdmin((q) => ({ data: q.ops.some((o) => o[0] === 'select') ? [{ profile_id: 'p1', taken_at: 'x' }] : null, error: null }))
    const t = makeTeamDeps(admin)
    expect(await t.takeOwner(KEY)).toEqual({ profile_id: 'p1', taken_at: 'x' })
    expect(ops(queries[0], 'eq')).toEqual([['eq', 'template_id', 't'], ['eq', 'site_id', 's1'], ['eq', 'period_key', '2026-10-14']])
    await t.releaseTake(KEY, 'p1')
    expect(op(queries[1], 'delete')).toBeTruthy()
    expect(ops(queries[1], 'eq')).toEqual([['eq', 'template_id', 't'], ['eq', 'site_id', 's1'], ['eq', 'period_key', '2026-10-14'], ['eq', 'profile_id', 'p1']])
  })
  it('claimInviteSend: first send (null) or more than an hour since the last one', async () => {
    let calls = 0
    const { admin, queries } = proxyAdmin(() => ({ data: ++calls === 1 ? [] : [{ id: 'gm1' }], error: null }))
    const now = new Date('2026-10-14T09:40:00Z')
    expect(await makeTeamDeps(admin).claimInviteSend('gm1', now)).toBe(true)
    expect(op(queries[0], 'is')).toEqual(['is', 'last_invite_sent_at', null])
    expect(op(queries[1], 'lte')).toEqual(['lte', 'last_invite_sent_at', '2026-10-14T08:40:00.000Z'])
  })
  it('member reads disambiguate the profiles embed (two FKs point at profiles)', async () => {
    const { admin, queries } = proxyAdmin(() => ({ data: { id: 'gm1', group_id: 'g1', profile_id: 'p1', phone: '447700900123', status: 'active', profile: { full_name: 'Anna Smith' } }, error: null }))
    const m = await makeTeamDeps(admin).memberById('gm1')
    expect(String(op(queries[0], 'select')![1])).toContain(`profile:profiles!${MEMBER_PROFILE_FK}(full_name)`)
    expect(m).toMatchObject({ id: 'gm1', full_name: 'Anna Smith' })
    expect(m).not.toHaveProperty('profile')
  })
  it('teams of soft-removed sites are skipped (removed_at filter + status), and the site embed is not returned', async () => {
    const { admin, queries } = proxyAdmin(() => ({ data: [
      { id: 'g1', business_id: 'b', title: 'Kitchen', site_id: 's1', site: { removed_at: null, status: 'active' } },
      { id: 'g2', business_id: 'b', title: 'Bar', site_id: 's2', site: { removed_at: null, status: 'removed' } },
    ], error: null }))
    const t = makeTeamDeps(admin)
    expect(await t.liveTeams()).toEqual([{ id: 'g1', business_id: 'b', title: 'Kitchen', site_id: 's1' }])
    expect(await t.teamsForBusiness('b')).toEqual([{ id: 'g1', business_id: 'b', title: 'Kitchen', site_id: 's1' }])
    for (const q of queries) {
      expect(String(op(q, 'select')![1])).toContain('site:sites!inner(removed_at, status)')
      expect(ops(q, 'is')).toContainEqual(['is', 'site.removed_at', null])
      expect(op(q, 'eq')).toEqual(['eq', 'channel', 'whatsapp'])
    }
  })
  it('activeMemberships skips deleted teams and teams of soft-removed sites, and returns plain members', async () => {
    const row = (id: string, status: string) => ({ id, group_id: 'g1', profile_id: 'p1', phone: '447700900123', status: 'active',
      profile: { full_name: 'Anna Smith' }, team: { channel: 'whatsapp', unlinked_at: null, site: { removed_at: null, status } } })
    const { admin, queries } = proxyAdmin(() => ({ data: [row('gm1', 'active'), row('gm2', 'removed')], error: null }))
    const out = await makeTeamDeps(admin).activeMemberships('p1')
    expect(out.map((m) => m.id)).toEqual(['gm1'])
    expect(out[0]).not.toHaveProperty('team')
    expect(out[0].full_name).toBe('Anna Smith')
    expect(String(op(queries[0], 'select')![1])).toContain('team:channel_groups!inner(channel, unlinked_at, site:sites!inner(removed_at, status))')
    expect(ops(queries[0], 'is')).toEqual([['is', 'team.unlinked_at', null], ['is', 'team.site.removed_at', null]])
  })
  it('teamTemplates keeps active templates of the team business at its site (or all sites)', async () => {
    const t = (o: any) => ({ id: 'x', business_id: 'b', site_id: null, name: 'n', frequency: 'daily', deadline_time: null, multi_per_day: false, min_per_day: null, assigned_roles: null, assigned_role_ids: null, active: true, ...o })
    const { admin } = proxyAdmin(() => ({ data: [
      { template: t({ id: 'all' }) }, { template: t({ id: 'here', site_id: 's1' }) }, { template: t({ id: 'there', site_id: 's2' }) },
      { template: t({ id: 'off', active: false }) }, { template: t({ id: 'foreign', business_id: 'zz' }) }, { template: null },
    ], error: null }))
    const out = await makeTeamDeps(admin).teamTemplates({ id: 'g1', business_id: 'b', title: 'Kitchen', site_id: 's1' })
    expect(out.map((x) => x.id)).toEqual(['all', 'here'])
    expect(out[0].assigned_roles).toEqual([])
  })
  it('linkIdentity: the number linked elsewhere → revoke by number and by profile, then insert a team_invite identity', async () => {
    const { admin, queries } = proxyAdmin((q) => (q.ops[0][0] === 'select' ? { data: { id: 'old', business_id: 'other', profile_id: 'x' }, error: null } : { data: null, error: null }))
    const now = new Date('2026-10-14T09:40:00Z')
    await makeTeamDeps(admin).linkIdentity({ business_id: 'b', profile_id: 'p1', phone: '447700900123', linked_by: 'm1', now })
    const kinds = queries.map((q) => [q.table, q.ops[0][0]])
    expect(kinds).toEqual([['channel_identities', 'select'], ['channel_identities', 'update'], ['channel_identities', 'update'], ['channel_identities', 'insert']])
    expect(op(queries[3], 'insert')![1]).toMatchObject({ business_id: 'b', profile_id: 'p1', channel: 'whatsapp', external_id: '447700900123', consent_source: 'team_invite', linked_by: 'm1' })
  })
  it('linkIdentity: already linked to this person here → only touch last_inbound_at', async () => {
    const { admin, queries } = proxyAdmin((q) => (q.ops[0][0] === 'select' ? { data: { id: 'id1', business_id: 'b', profile_id: 'p1' }, error: null } : { data: null, error: null }))
    await makeTeamDeps(admin).linkIdentity({ business_id: 'b', profile_id: 'p1', phone: '447700900123', linked_by: 'm1', now: new Date() })
    expect(queries.map((q) => q.ops[0][0])).toEqual(['select', 'update'])
    expect(Object.keys(op(queries[1], 'update')![1])).toEqual(['last_inbound_at'])
  })
})

describe('fakeTeamDeps takes (first submit wins across teams)', () => {
  const twoTeams = () => {
    const f = fakeTeamDeps({
      templates: [tpl({ id: 'tA', name: 'Fridge temps' })],
      mappings: [{ group_id: 'g1', template_id: 'tA' }, { group_id: 'g2', template_id: 'tA' }],
      members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm2', group_id: 'g2', profile_id: BEN.profile_id, phone: BEN.phone })],
    })
    f.s.teams.push({ id: 'g2', business_id: 'b', title: 'Bar', site_id: 's1' })
    return f
  }
  const k = (group_id: string) => ({ group_id, template_id: 'tA', site_id: 's1', period_key: '2026-10-14' })

  it('two teams claim the same checklist/site/period at once → exactly one wins, both teams hold its take', async () => {
    const { d, s } = twoTeams()
    const won = await Promise.all([d.claimTake(k('g1'), ANNA.profile_id, s.now), d.claimTake(k('g2'), BEN.profile_id, s.now)])
    expect(won.filter(Boolean)).toHaveLength(1)
    expect([...s.takes.keys()].sort()).toEqual(['g1|tA|s1|2026-10-14', 'g2|tA|s1|2026-10-14'])
    expect([...s.takes.values()].map((t) => t.profile_id)).toEqual([ANNA.profile_id, ANNA.profile_id])
    expect(await d.takeOwner(k('g2'))).toEqual({ profile_id: ANNA.profile_id, taken_at: s.now.toISOString() })
  })
  it('a team mapped after the take still sees the owner; release frees every team', async () => {
    const { d, s } = twoTeams()
    s.mappings = [{ group_id: 'g1', template_id: 'tA' }]
    expect(await d.claimTake(k('g1'), ANNA.profile_id, s.now)).toBe(true)
    expect([...s.takes.keys()]).toEqual(['g1|tA|s1|2026-10-14'])
    expect(await d.claimTake(k('g2'), BEN.profile_id, s.now)).toBe(false)
    expect((await d.takeOwner(k('g2')))?.profile_id).toBe(ANNA.profile_id)
    await d.releaseTake(k('g1'), BEN.profile_id)
    expect(s.takes.size).toBe(1)
    await d.releaseTake(k('g1'), ANNA.profile_id)
    expect(s.takes.size).toBe(0)
    expect(await d.claimTake(k('g2'), BEN.profile_id, s.now)).toBe(true)
  })
  it('memberships and team lists skip a soft-removed site (missing from s.sites)', async () => {
    const { d, s } = twoTeams()
    s.teams.push({ id: 'g4', business_id: 'b', title: 'Far', site_id: 's2' })
    s.members.push(member({ id: 'gm4', group_id: 'g4', profile_id: ANNA.profile_id, phone: ANNA.phone }))
    expect((await d.activeMemberships(ANNA.profile_id)).map((m) => m.group_id)).toEqual(['g1'])
    expect((await d.liveTeams()).map((t) => t.id)).toEqual(['g1', 'g2'])
    expect(await d.teamById('g4')).toBeNull()
  })
  it('a deleted team or a team at another site gets no take row', async () => {
    const { d, s } = twoTeams()
    s.teams.push({ id: 'g3', business_id: 'b', title: 'Old', site_id: 's1', deleted: true }, { id: 'g4', business_id: 'b', title: 'Far', site_id: 's2' })
    s.mappings.push({ group_id: 'g3', template_id: 'tA' }, { group_id: 'g4', template_id: 'tA' })
    expect(await d.claimTake(k('g1'), ANNA.profile_id, s.now)).toBe(true)
    expect([...s.takes.keys()]).toEqual(['g1|tA|s1|2026-10-14', 'g2|tA|s1|2026-10-14'])
  })
})
