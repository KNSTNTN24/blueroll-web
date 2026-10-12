// src/lib/whatsapp/__tests__/team-cron.test.ts
import { describe, it, expect } from 'vitest'
import { runWhatsAppTeams, celebrateTeam } from '../../../../supabase/functions/_shared/channels/team-cron'
import { fakeTeamDeps, fakeSend, member, tpl, TEAM, ANNA, BEN, BOSS } from './fakes/team-deps'

const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })   // 10:00Z
const CLEAN = tpl({ id: 'tB', name: 'Cleaning' })
const MAP = [{ group_id: 'g1', template_id: 'tA' }, { group_id: 'g1', template_id: 'tB' }]
const at = (iso: string) => new Date(iso)
const params = (m: any) => m.template.components[0].parameters.map((p: any) => p.text)
const payloads = (m: any) => m.template.components.slice(1).map((c: any) => c.parameters[0].payload)
// Anna active+linked (default); Ben active but never linked; Carl invited; Dee removed.
const crowd = () => fakeTeamDeps({
  templates: [FRIDGE, CLEAN], mappings: MAP,
  members: [
    member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }),
    member({ id: 'gm2', profile_id: BEN.profile_id, phone: BEN.phone }),
    member({ id: 'gm3', profile_id: 'p3', phone: '447700900333', status: 'invited' }),
    member({ id: 'gm4', profile_id: 'p4', phone: '447700900444', status: 'removed' }),
  ],
})

describe('runWhatsAppTeams — morning list', () => {
  it('nothing before earliest deadline − 1 h; then once per member per day, active+linked only', async () => {
    const { d, s } = crowd()
    const w = fakeSend()
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T08:59:00Z'))).toMatchObject({ morning: 0 })
    expect(w.sent).toEqual([])
    s.now = at('2026-10-14T09:00:00Z')
    expect(await runWhatsAppTeams(d, w.send, s.now)).toMatchObject({ morning: 1, failed: 0 })
    expect(w.sent.map((m) => m.to)).toEqual([ANNA.phone])
    expect(w.sent[0].template.name).toBe('checklist_reminder_list')
    expect(params(w.sent[0])).toEqual(['2', 'Kitchen (Ashfield Row)', 'Fridge temps (11:00), Cleaning'])
    expect(payloads(w.sent[0])).toEqual(['checks:g1'])
    expect(s.events.has('g1|morning:gm1|2026-10-14')).toBe(true)
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T09:10:00Z'))).toMatchObject({ morning: 0 })
    expect(w.sent).toHaveLength(1)
  })
  // Ruling F2: the morning list always uses checklist_reminder_list, even with exactly one open checklist.
  it('one open checklist with a deadline → still checklist_reminder_list (Show checks)', async () => {
    const { d } = fakeTeamDeps({ templates: [FRIDGE], mappings: [MAP[0]] })
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T09:00:00Z'))
    expect(w.sent[0].template.name).toBe('checklist_reminder_list')
    expect(params(w.sent[0])).toEqual(['1', 'Kitchen (Ashfield Row)', 'Fridge temps (11:00)'])
    expect(payloads(w.sent[0])).toEqual(['checks:g1'])
  })
  it('no deadlines → 08:00 site time', async () => {
    const { d } = fakeTeamDeps({ templates: [CLEAN], mappings: [MAP[1]] })
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T06:59:00Z'))
    expect(w.sent).toEqual([])
    await runWhatsAppTeams(d, w.send, at('2026-10-14T07:00:00Z'))
    expect(w.sent).toHaveLength(1)
  })
  it('nothing open → nothing sent and nothing claimed', async () => {
    const { d, s } = fakeTeamDeps({ templates: [CLEAN], mappings: [MAP[1]],
      completions: [{ template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T06:30:00Z', completed_by: 'p1' }] })
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T07:00:00Z'))
    expect(w.sent).toEqual([])
    expect(s.events.size).toBe(0)
  })
  it('a failed send releases the claim (next run retries); an unreachable number does not', async () => {
    const { d, s } = fakeTeamDeps({ templates: [CLEAN], mappings: [MAP[1]] })
    const down = fakeSend(() => ({ ok: false, status: 500, id: null }))
    expect(await runWhatsAppTeams(d, down.send, at('2026-10-14T07:00:00Z'))).toMatchObject({ morning: 0, failed: 1 })
    expect(s.events.size).toBe(0)
    const gone = fakeSend(() => ({ ok: false, status: 400, id: null, errorCode: 131026 }))
    await runWhatsAppTeams(d, gone.send, at('2026-10-14T07:10:00Z'))
    expect(s.events.has('g1|morning:gm1|2026-10-14')).toBe(true)
    expect(s.members[0].unreachable_at).not.toBeNull()
  })
  it('team at a removed site → nothing (no sends, no claims)', async () => {
    const { d, s } = fakeTeamDeps({ templates: [FRIDGE, CLEAN], mappings: MAP, sites: [] })
    const w = fakeSend()
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T11:00:00Z'))).toEqual({ morning: 0, overdue: 0, summaries: 0, failed: 0 })
    expect(w.sent).toEqual([])
    expect(s.events.size).toBe(0)
    expect(s.notifications).toEqual([])
  })
  it('a site-specific checklist of another site is not in the team list', async () => {
    const OTHER = tpl({ id: 'tC', name: 'Bar fridge', site_id: 's2' })
    const { d } = fakeTeamDeps({ templates: [CLEAN, OTHER], mappings: [MAP[1], { group_id: 'g1', template_id: 'tC' }] })
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T07:00:00Z'))
    expect(params(w.sent[0])).toEqual(['1', 'Kitchen (Ashfield Row)', 'Cleaning'])
  })
  it('business not ready → nothing', async () => {
    const { d } = fakeTeamDeps({ templates: [CLEAN], mappings: [MAP[1]], ready: { b: false } })
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T07:00:00Z'))
    expect(w.sent).toEqual([])
  })
})

describe('runWhatsAppTeams — overdue', () => {
  it('at the deadline, still open → once per (team, checklist, period) to every active member', async () => {
    const { d, s } = crowd()
    s.identities.push({ id: 'idb', business_id: 'b', profile_id: BEN.profile_id, phone: BEN.phone, last_inbound_at: null, revoked: false, consent_source: 'team_invite' })
    s.events.add('g1|morning:gm1|2026-10-14'); s.events.add('g1|morning:gm2|2026-10-14')
    const w = fakeSend()
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T10:00:00Z'))).toMatchObject({ overdue: 1 })
    expect(w.sent.map((m) => [m.to, m.template.name, payloads(m)[0]])).toEqual([
      [ANNA.phone, 'checklist_reminder', 'tfill:g1:tA'], [BEN.phone, 'checklist_reminder', 'tfill:g1:tA']])
    expect(params(w.sent[0])).toEqual(['Fridge temps', '11:00', 'Kitchen (Ashfield Row)'])
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T10:10:00Z'))).toMatchObject({ overdue: 0 })
    expect(w.sent).toHaveLength(2)
  })
})

describe('runWhatsAppTeams — missed summary', () => {
  it('1 h after the latest deadline: to members and managers, once; plus one app notification', async () => {
    const { d, s } = fakeTeamDeps({ templates: [FRIDGE, CLEAN], mappings: MAP,
      completions: [{ template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }] })
    s.events.add('g1|morning:gm1|2026-10-14'); s.events.add('g1|overdue|tA:2026-10-14')
    const w = fakeSend()
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T10:59:00Z'))).toMatchObject({ summaries: 0 })
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T11:00:00Z'))).toMatchObject({ summaries: 1 })
    expect(w.sent.map((m) => [m.to, m.template.name])).toEqual([[ANNA.phone, 'team_day_summary'], [BOSS.phone, 'team_day_summary']])
    expect(params(w.sent[0])).toEqual(['Kitchen', 'Ashfield Row', '1', '2', 'Fridge temps'])
    expect(s.notifications).toEqual([{ user_id: 'm1', type: 'team', title: 'Kitchen: checks missed today',
      message: 'Kitchen at Ashfield Row today: 1 of 2 done. Missed: Fridge temps.', link: '/checklists' }])
    await runWhatsAppTeams(d, w.send, at('2026-10-14T11:10:00Z'))
    expect(w.sent).toHaveLength(2)
    expect(s.notifications).toHaveLength(1)
  })
  it('all done → no summary', async () => {
    const done = ['tA', 'tB'].map((id) => ({ template_id: id, site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }))
    const { d, s } = fakeTeamDeps({ templates: [FRIDGE, CLEAN], mappings: MAP, completions: done })
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T11:00:00Z'))
    expect(w.sent).toEqual([])
    expect(s.notifications).toEqual([])
  })
  // Review Focus 3: the manager is also a member of the team.
  it('a manager who is also a member gets one summary, not two', async () => {
    const { d, s } = fakeTeamDeps({ templates: [FRIDGE], mappings: [MAP[0]],
      members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm5', profile_id: BOSS.profile_id, phone: BOSS.phone })] })
    s.events.add('g1|morning:gm1|2026-10-14'); s.events.add('g1|morning:gm5|2026-10-14'); s.events.add('g1|overdue|tA:2026-10-14')
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T11:00:00Z'))
    expect(w.sent.map((m) => m.to)).toEqual([ANNA.phone, BOSS.phone])
    expect(s.notifications).toHaveLength(1)
  })
  // Ruling D1: owners (every team) + managers of the team's site only; scoping as can_see_site_row.
  it('summary goes to the owner and the site\'s managers, not to a manager of another site', async () => {
    const mgr = (pid: string, phone: string, name: string) => ({
      person: { profile_id: pid, business_id: 'b', full_name: name, role: 'manager', role_id: null },
      ident: { id: `id-${pid}`, business_id: 'b', profile_id: pid, phone, last_inbound_at: null, revoked: false, consent_source: 'qr_code' },
    })
    const here = mgr('m2', '447700900002', 'Sam Here'), there = mgr('m3', '447700900003', 'Tom There')
    const anywhere = mgr('m4', '447700900004', 'Una Unassigned'), admin = mgr('m5', '447700900005', 'Gia Group')
    const { d, s } = fakeTeamDeps({ templates: [FRIDGE], mappings: [MAP[0]],
      managers: [BOSS.profile_id, 'm2', 'm3', 'm4', 'm5'], memberSites: { m1: ['s2'], m2: ['s1'], m3: ['s2'], m5: ['s2'] }, groupAdmins: ['m5'] })
    for (const x of [here, there, anywhere, admin]) { s.people.push(x.person); s.identities.push(x.ident) }
    s.events.add('g1|morning:gm1|2026-10-14'); s.events.add('g1|overdue|tA:2026-10-14')
    const w = fakeSend()
    await runWhatsAppTeams(d, w.send, at('2026-10-14T11:00:00Z'))
    expect(w.sent.map((m) => m.to)).toEqual([ANNA.phone, BOSS.phone, '447700900002', '447700900004', '447700900005'])
    expect(s.notifications.map((n) => n.user_id)).toEqual(['m1', 'm2', 'm4', 'm5'])
  })
  // Review Focus 5: team_day_summary not approved yet. Spec §5: managers ALWAYS get the app notification.
  it('template not approved → app notification once anyway; WhatsApp claim released, the next run retries WhatsApp only', async () => {
    const { d, s } = fakeTeamDeps({ templates: [FRIDGE], mappings: [MAP[0]] })
    s.events.add('g1|morning:gm1|2026-10-14'); s.events.add('g1|overdue|tA:2026-10-14')
    const down = fakeSend(() => ({ ok: false, status: 404, id: null, errorCode: 132001 }))
    expect(await runWhatsAppTeams(d, down.send, at('2026-10-14T11:00:00Z'))).toMatchObject({ summaries: 0 })
    expect(s.events.has('g1|day_end|2026-10-14')).toBe(false)
    expect(s.events.has('g1|day_end_app|2026-10-14')).toBe(true)
    expect(s.notifications).toEqual([{ user_id: 'm1', type: 'team', title: 'Kitchen: checks missed today',
      message: 'Kitchen at Ashfield Row today: 0 of 1 done. Missed: Fridge temps.', link: '/checklists' }])
    const up = fakeSend()
    expect(await runWhatsAppTeams(d, up.send, at('2026-10-14T11:10:00Z'))).toMatchObject({ summaries: 1 })
    expect(up.sent.map((m) => m.template.name)).toEqual(['team_day_summary', 'team_day_summary'])
    expect(s.notifications).toHaveLength(1)
    await runWhatsAppTeams(d, up.send, at('2026-10-14T11:20:00Z'))
    expect(up.sent).toHaveLength(2)
    expect(s.notifications).toHaveLength(1)
  })
})

describe('runWhatsAppTeams — run budget', () => {
  const counting = (init: Parameters<typeof fakeTeamDeps>[0]) => {
    const calls: string[] = []
    const base = fakeTeamDeps(init)
    const real = base.d.completionsSince
    base.d.completionsSince = async (b, since) => { calls.push(b); return real(b, since) }
    return { ...base, calls }
  }
  it('before the morning time a team costs no completions query', async () => {
    const { d, calls } = counting({ templates: [FRIDGE, CLEAN], mappings: MAP })
    const w = fakeSend()
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T08:59:00Z'))).toEqual({ morning: 0, overdue: 0, summaries: 0, failed: 0 })
    expect(calls).toEqual([])
    await runWhatsAppTeams(d, w.send, at('2026-10-14T09:00:00Z'))
    expect(calls).toEqual(['b'])
  })
  it('two teams of one business share one completions fetch per run', async () => {
    const { d, s, calls } = counting({ templates: [FRIDGE, CLEAN], mappings: [...MAP, { group_id: 'g2', template_id: 'tA' }, { group_id: 'g2', template_id: 'tB' }] })
    s.teams.push({ ...TEAM, id: 'g2', title: 'Bar' })
    s.members.push(member({ id: 'gm9', group_id: 'g2', profile_id: ANNA.profile_id, phone: ANNA.phone }))
    const w = fakeSend()
    expect(await runWhatsAppTeams(d, w.send, at('2026-10-14T09:00:00Z'))).toMatchObject({ morning: 2 })
    expect(calls).toEqual(['b'])
    expect(params(w.sent[1])).toEqual(['2', 'Bar (Ashfield Row)', 'Fridge temps (11:00), Cleaning'])
  })
})

describe('celebrateTeam', () => {
  it('🎉 only to members whose 24 h window is open; once per team per day; blocks the summary', async () => {
    const { d, s } = crowd()
    s.identities.push({ id: 'idb', business_id: 'b', profile_id: BEN.profile_id, phone: BEN.phone, last_inbound_at: '2026-10-13T08:00:00Z', revoked: false, consent_source: 'team_invite' })
    s.identities[0].last_inbound_at = '2026-10-14T09:39:00Z'
    const w = fakeSend()
    const now = at('2026-10-14T09:40:00Z')
    expect(await celebrateTeam(d, w.send, TEAM, '2026-10-14', now)).toBe(1)
    expect(w.sent.map((m) => [m.to, m.text.body])).toEqual([[ANNA.phone, '🎉 All Kitchen checks done today']])
    expect(await celebrateTeam(d, w.send, TEAM, '2026-10-14', now)).toBe(0)
    expect(s.events.has('g1|day_end|2026-10-14')).toBe(true)
  })
})
