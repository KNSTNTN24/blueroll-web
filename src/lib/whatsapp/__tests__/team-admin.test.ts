// src/lib/whatsapp/__tests__/team-admin.test.ts
import { describe, it, expect } from 'vitest'
import { handleInbound } from '../../../../supabase/functions/_shared/channels/bot'
import { TEAM_TEXT } from '../../../../supabase/functions/_shared/channels/team-text'
import { fakeTeamBot, textOf } from './fakes/team-bot-deps'
import { member, ANNA, BOSS } from './fakes/team-deps'

const MARIA = '447700900777'
const share = (from: string, name = 'Maria Lopez', phone = MARIA) => ({ kind: 'contact' as const, from, name, phone, id: `c${Math.random()}` })
const tap = (from: string, payload: string) => ({ kind: 'button' as const, from, payload, id: `b${Math.random()}` })
const say = (from: string, text: string) => ({ kind: 'text' as const, from, text, id: `t${Math.random()}` })
const extraTeams = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `g${i + 2}`, business_id: 'b', title: `Team ${i + 2}`, site_id: 's1' }))

describe('shared contact', () => {
  it('a manager with one team: no question, invite sent, "Invite sent to <name> ✓"', async () => {
    const f = fakeTeamBot()
    await handleInbound(share(BOSS.phone), f.d)
    expect(f.sent.map((m) => [m.to, m.type === 'template' ? m.template.name : textOf(m)])).toEqual([[MARIA, 'team_invite'], [BOSS.phone, 'Invite sent to Maria Lopez ✓']])
    expect(f.s.members.find((m) => m.phone === MARIA)).toMatchObject({ status: 'invited', invited_by: 'm1' })
  })
  it('staff share → only managers; no teams → create one first', async () => {
    const a = fakeTeamBot()
    await handleInbound(share(ANNA.phone), a.d)
    expect(textOf(a.sent[0])).toBe(TEAM_TEXT.onlyManagers)
    expect(a.s.members).toHaveLength(1)
    const b = fakeTeamBot({ teams: [] })
    await handleInbound(share(BOSS.phone), b.d)
    expect(textOf(b.sent[0])).toBe(TEAM_TEXT.noTeams)
  })
  it('3 teams → reply buttons with the contact in the id', async () => {
    const f = fakeTeamBot()
    f.s.teams.push(...extraTeams(2))
    await handleInbound(share(BOSS.phone), f.d)
    const m = f.sent[0].interactive
    expect(m.type).toBe('button')
    expect(m.body.text).toBe('Add Maria Lopez (+44 7••• ••77) to which team?')
    expect(m.action.buttons.map((b: any) => [b.reply.id, b.reply.title])).toEqual([
      [`add:g1:${MARIA}:Maria Lopez`, 'Kitchen'], [`add:g2:${MARIA}:Maria Lopez`, 'Team 2'], [`add:g3:${MARIA}:Maria Lopez`, 'Team 3']])
    expect(f.s.members).toHaveLength(1)                                   // nothing added before the pick
  })
  it('5 teams → a list with one row per team (site in the description)', async () => {
    const f = fakeTeamBot()
    f.s.teams.push(...extraTeams(4))
    await handleInbound(share(BOSS.phone), f.d)
    const m = f.sent[0].interactive
    expect(m.type).toBe('list')
    expect(m.action.button).toBe('Choose a team')
    expect(m.action.sections[0].title).toBe('Teams')
    expect(m.action.sections[0].rows).toHaveLength(5)
    expect(m.action.sections[0].rows[0]).toEqual({ id: `add:g1:${MARIA}:Maria Lopez`, title: 'Kitchen', description: 'Ashfield Row' })
  })
  it('the pick adds and invites; a deleted team answers "no longer exists"', async () => {
    const f = fakeTeamBot()
    f.s.teams.push(...extraTeams(2))
    await handleInbound(tap(BOSS.phone, `add:g2:${MARIA}:Maria Lopez`), f.d)
    expect(f.s.members.find((m) => m.phone === MARIA)).toMatchObject({ group_id: 'g2', status: 'invited' })
    expect(textOf(f.sent[1])).toBe('Invite sent to Maria Lopez ✓')
    f.s.teams[2].deleted = true
    await handleInbound(tap(BOSS.phone, `add:g3:${MARIA}:Maria Lopez`), f.d)
    expect(textOf(f.sent[2])).toBe(TEAM_TEXT.teamGone)
  })
  it('a staff member cannot use a pick payload', async () => {
    const f = fakeTeamBot()
    await handleInbound(tap(ANNA.phone, `add:g1:${MARIA}:Maria`), f.d)
    expect(textOf(f.sent[0])).toBe(TEAM_TEXT.onlyManagers)
    expect(f.s.members).toHaveLength(1)
  })
})

describe('`team` command and Remove', () => {
  it('one message per team: members with status; rows "Remove <name>"', async () => {
    const f = fakeTeamBot({ members: [
      member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone, full_name: 'Anna Smith' }),
      member({ id: 'gm2', profile_id: 'p9', phone: MARIA, full_name: 'Maria Lopez', status: 'invited' }),
      member({ id: 'gm3', profile_id: 'p8', phone: '447700900888', full_name: 'Dan Cole', status: 'invited', unreachable_at: '2026-10-14T08:00:00Z' }),
      member({ id: 'gm4', profile_id: 'p7', phone: '447700900999', full_name: 'Gone Person', status: 'removed' }),
    ] })
    f.s.teams.push({ id: 'g2', business_id: 'b', title: 'Bar', site_id: 's1' })
    await handleInbound(say(BOSS.phone, 'TEAM'), f.d)
    expect(textOf(f.sent[0])).toBe(`Bar · Ashfield Row\n${TEAM_TEXT.noPeople}`)   // teams by title
    const kitchen = f.sent[1].interactive
    expect(kitchen.header.text).toBe('Kitchen · Ashfield Row')
    expect(kitchen.body.text).toBe('Anna Smith — Active\nMaria Lopez — Invited\nDan Cole — Not reachable')
    expect(kitchen.action.sections[0].rows.map((r: any) => [r.id, r.title])).toEqual([['rm:gm1', 'Remove Anna'], ['rm:gm2', 'Remove Maria'], ['rm:gm3', 'Remove Dan']])
  })
  it('more than 10 people → several messages of at most 10 rows', async () => {
    const f = fakeTeamBot({ members: Array.from({ length: 12 }, (_, i) => member({ id: `gm${i}`, profile_id: `q${i}`, phone: `4477009010${String(i).padStart(2, '0')}`, full_name: `Person ${i}` })) })
    await handleInbound(say(BOSS.phone, 'team'), f.d)
    expect(f.sent.map((m) => m.interactive.action.sections[0].rows.length)).toEqual([10, 2])
  })
  it('rm → confirm buttons; rmyes → removed; rmno → cancelled', async () => {
    const f = fakeTeamBot()
    await handleInbound(tap(BOSS.phone, 'rm:gm1'), f.d)
    expect(f.sent[0].interactive.body.text).toBe('Remove Anna Smith from Kitchen?')
    expect(f.sent[0].interactive.action.buttons.map((b: any) => [b.reply.id, b.reply.title])).toEqual([['rmyes:gm1', 'Remove'], ['rmno', 'Cancel']])
    await handleInbound(tap(BOSS.phone, 'rmno'), f.d)
    expect(textOf(f.sent[1])).toBe('Cancelled.')
    expect(f.s.members[0].status).toBe('active')
    await handleInbound(tap(BOSS.phone, 'rmyes:gm1'), f.d)
    expect(textOf(f.sent[2])).toBe('Anna Smith removed from Kitchen.')
    expect(f.s.members[0]).toMatchObject({ status: 'removed', removed_at: '2026-10-14T09:40:00.000Z' })
  })
  it('staff: `team` → only managers; a forged rmyes does nothing', async () => {
    const f = fakeTeamBot()
    await handleInbound(say(ANNA.phone, 'team'), f.d)
    expect(textOf(f.sent[0])).toBe(TEAM_TEXT.onlyManagers)
    await handleInbound(tap(ANNA.phone, 'rmyes:gm1'), f.d)
    expect(f.s.members[0].status).toBe('active')
  })
})

describe('edge cases', () => {
  it('a contact with an empty name is added as "New person"; long names are capped at 60', async () => {
    const f = fakeTeamBot()
    await handleInbound(share(BOSS.phone, ''), f.d)
    expect(textOf(f.sent[1])).toBe('Invite sent to New person ✓')
    const g = fakeTeamBot()
    await handleInbound(share(BOSS.phone, 'x'.repeat(80)), g.d)
    expect(textOf(g.sent[1])).toBe(`Invite sent to ${'x'.repeat(60)} ✓`)
  })
  it('a team at a removed site is not offered and not listed', async () => {
    const f = fakeTeamBot()
    f.s.teams.push({ id: 'g2', business_id: 'b', title: 'Ghost', site_id: 'sGone' })
    await handleInbound(share(BOSS.phone), f.d)
    expect(f.s.members.find((m) => m.phone === MARIA)).toMatchObject({ group_id: 'g1' })   // single visible team: no question
    await handleInbound(say(BOSS.phone, 'team'), f.d)
    expect(f.sent.some((m) => JSON.stringify(m).includes('Ghost'))).toBe(false)
  })
  it('a member of another business cannot be removed', async () => {
    const f = fakeTeamBot()
    f.s.teams.push({ id: 'gx', business_id: 'other', title: 'Foreign', site_id: 's1' })
    f.s.members.push(member({ id: 'gmx', group_id: 'gx', profile_id: 'px', phone: '447700900555', full_name: 'Zed' }))
    await handleInbound(tap(BOSS.phone, 'rmyes:gmx'), f.d)
    expect(textOf(f.sent[0])).toBe(TEAM_TEXT.teamGone)
    expect(f.s.members.find((m) => m.id === 'gmx')!.status).toBe('active')
  })
})

