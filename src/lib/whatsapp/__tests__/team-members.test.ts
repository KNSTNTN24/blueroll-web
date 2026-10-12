// src/lib/whatsapp/__tests__/team-members.test.ts
import { describe, it, expect } from 'vitest'
import { addPersonToTeam, resendInvite, handleJoin, applyDeliveryStatuses, sendTracked, INVITE_TTL_MS } from '../../../../supabase/functions/_shared/channels/team-members'
import { TEAM_TEXT } from '../../../../supabase/functions/_shared/channels/team-text'
import { textMessage } from '../../../../supabase/functions/_shared/channels/whatsapp'
import { fakeTeamDeps, fakeSend, member, TEAM, ANNA, BEN, BOSS, NOW } from './fakes/team-deps'

const MARIA = '447700900777'
const textOf = (m: any) => m?.text?.body
const invitedMaria = (o: Partial<Parameters<typeof member>[0]> = {}) =>
  member({ id: 'gm9', profile_id: 'p9', phone: MARIA, status: 'invited', full_name: 'Maria Lopez', joined_at: null, last_invite_sent_at: '2026-10-14T09:00:00Z', invited_at: '2026-10-14T09:00:00Z', ...o })

describe('addPersonToTeam', () => {
  it('a new number → chat-only member at the team site, invited, team_invite with Join payload', async () => {
    const { d, s } = fakeTeamDeps()
    const w = fakeSend()
    const r = await addPersonToTeam(d, w.send, { team: TEAM, phone: MARIA, name: 'Maria Lopez', invitedBy: BOSS.profile_id })
    expect(r.outcome).toBe('invited')
    expect(s.created).toEqual([{ businessId: 'b', siteId: 's1', fullName: 'Maria Lopez', profile_id: 'new1' }])
    expect(s.members.find((m) => m.profile_id === 'new1')).toMatchObject({ status: 'invited', phone: MARIA, invited_by: 'm1', last_invite_sent_at: NOW.toISOString() })
    expect(w.sent).toHaveLength(1)
    expect(w.sent[0]).toMatchObject({ to: MARIA, template: { name: 'team_invite', language: { code: 'en_GB' } } })
    expect(w.sent[0].template.components[0].parameters.map((p: any) => p.text)).toEqual(['Fern & Fig', 'Kitchen', 'Ashfield Row'])
    expect(w.sent[0].template.components[1].parameters[0].payload).toBe(`join:${r.member!.id}`)
    expect(s.logs).toMatchObject([{ kind: 'team_invite', template_name: 'team_invite', billable: true, direction: 'out' }])
  })
  it('a number linked in this business → that profile is reused', async () => {
    const { d, s } = fakeTeamDeps({ members: [] })
    const r = await addPersonToTeam(d, fakeSend().send, { team: TEAM, phone: ANNA.phone, name: 'Whatever', invitedBy: 'm1' })
    expect(r.member).toMatchObject({ profile_id: ANNA.profile_id, status: 'invited' })
    expect(s.created).toEqual([])
  })
  it('a picked Team member with a phone → that profile', async () => {
    const { d, s } = fakeTeamDeps()
    const r = await addPersonToTeam(d, fakeSend().send, { team: TEAM, phone: BEN.phone, name: 'Ben Jones', profileId: BEN.profile_id, invitedBy: 'm1' })
    expect(r.member).toMatchObject({ profile_id: BEN.profile_id, phone: BEN.phone })
    expect(s.created).toEqual([])
  })
  it('an active, connected member → already_member, nothing sent', async () => {
    const { d } = fakeTeamDeps()
    const w = fakeSend()
    expect((await addPersonToTeam(d, w.send, { team: TEAM, phone: ANNA.phone, name: 'Anna', invitedBy: 'm1' })).outcome).toBe('already_member')
    expect(w.sent).toEqual([])
  })
  it('a removed member added again → same profile, invited again (the earlier send was > 1 h ago)', async () => {
    const { d, s } = fakeTeamDeps({ members: [member({ id: 'gm1', profile_id: 'p7', phone: MARIA, status: 'removed', removed_at: '2026-10-10T09:00:00Z' })] })
    const r = await addPersonToTeam(d, fakeSend().send, { team: TEAM, phone: MARIA, name: 'Maria', invitedBy: 'm1' })
    expect(r).toMatchObject({ outcome: 'invited', member: { id: 'gm1', profile_id: 'p7' } })
    expect(s.members[0].status).toBe('invited')
    expect(s.created).toEqual([])
  })
  it('a member who sent STOP (identity revoked) is invited again, not "already in"', async () => {
    const { d, s } = fakeTeamDeps()
    s.identities[0].revoked = true
    expect((await addPersonToTeam(d, fakeSend().send, { team: TEAM, phone: ANNA.phone, name: 'Anna', invitedBy: 'm1' })).outcome).toBe('invited')
  })
  it('Meta error 131026 → member flagged unreachable, outcome failed, resend slot given back', async () => {
    const { d, s } = fakeTeamDeps()
    const w = fakeSend(() => ({ ok: false, status: 400, id: null, errorCode: 131026 }))
    const r = await addPersonToTeam(d, w.send, { team: TEAM, phone: MARIA, name: 'Maria', invitedBy: 'm1' })
    expect(r.outcome).toBe('failed')
    expect(s.members.find((m) => m.phone === MARIA)).toMatchObject({ unreachable_at: NOW.toISOString(), last_invite_sent_at: null })
  })
  // Review Focus 5: the template is not approved yet.
  it('template not approved (132001) → template_missing; not unreachable; resend possible right away', async () => {
    const { d, s } = fakeTeamDeps()
    const down = fakeSend(() => ({ ok: false, status: 404, id: null, errorCode: 132001 }))
    const r = await addPersonToTeam(d, down.send, { team: TEAM, phone: MARIA, name: 'Maria', invitedBy: 'm1' })
    expect(r.outcome).toBe('template_missing')
    expect(s.members.find((m) => m.phone === MARIA)).toMatchObject({ unreachable_at: null, last_invite_sent_at: null })
    expect((await resendInvite(d, fakeSend().send, r.member!.id)).outcome).toBe('invited')
  })
})

describe('resendInvite', () => {
  it('at most once per hour; only for invited members', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria()] })
    const w = fakeSend()
    expect((await resendInvite(d, w.send, 'gm9')).outcome).toBe('too_soon')        // sent 40 min ago
    s.now = new Date('2026-10-14T10:00:00Z')
    expect((await resendInvite(d, w.send, 'gm9')).outcome).toBe('invited')
    expect(w.sent).toHaveLength(1)
    const active = fakeTeamDeps()
    expect((await resendInvite(active.d, w.send, 'gm1')).outcome).toBe('not_invited')
  })
})

describe('handleJoin', () => {
  it('from the invited phone → identity (team_invite), active, reply, inviter told in the app', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria()], people: [{ profile_id: 'p9', business_id: 'b', full_name: 'Maria Lopez', role: 'kitchen_staff', role_id: null }, { profile_id: 'm1', business_id: 'b', full_name: 'Kostya Boss', role: 'owner', role_id: null }] })
    const w = fakeSend()
    await handleJoin(d, w.send, { from: MARIA, memberId: 'gm9' })
    expect(s.members[0]).toMatchObject({ status: 'active', joined_at: NOW.toISOString() })
    expect(s.identities.find((i) => i.phone === MARIA && !i.revoked)).toMatchObject({ business_id: 'b', profile_id: 'p9', consent_source: 'team_invite' })
    expect(textOf(w.sent[0])).toBe(TEAM_TEXT.joined('Kitchen', 'Ashfield Row'))
    expect(w.sent).toHaveLength(1)                                      // Kostya's window is closed → app notification instead
    expect(s.notifications).toEqual([{ user_id: 'm1', type: 'team', title: 'Joined WhatsApp team', message: 'Maria joined Kitchen ✓', link: '/settings' }])
  })
  it('the inviter with an open window gets it in WhatsApp', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria()] })
    s.identities[1].last_inbound_at = '2026-10-14T08:00:00Z'
    const w = fakeSend()
    await handleJoin(d, w.send, { from: MARIA, memberId: 'gm9' })
    expect(w.sent.map((m) => [m.to, textOf(m)])).toEqual([[MARIA, TEAM_TEXT.joined('Kitchen', 'Ashfield Row')], [BOSS.phone, 'Maria joined Kitchen ✓']])
    expect(s.notifications).toEqual([])
  })
  it('a join payload from any other phone is ignored', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria()] })
    const w = fakeSend()
    await handleJoin(d, w.send, { from: BEN.phone, memberId: 'gm9' })
    expect(w.sent).toEqual([])
    expect(s.members[0].status).toBe('invited')
  })
  it('older than 14 days → expired; removed → expired', async () => {
    const old = new Date(NOW.getTime() - INVITE_TTL_MS - 60_000).toISOString()
    const a = fakeTeamDeps({ members: [invitedMaria({ last_invite_sent_at: old, invited_at: old })] })
    const w = fakeSend()
    await handleJoin(a.d, w.send, { from: MARIA, memberId: 'gm9' })
    expect(textOf(w.sent[0])).toBe(TEAM_TEXT.inviteExpired)
    expect(a.s.members[0].status).toBe('invited')
    const b = fakeTeamDeps({ members: [invitedMaria({ status: 'removed' })] })
    await handleJoin(b.d, w.send, { from: MARIA, memberId: 'gm9' })
    expect(textOf(w.sent[1])).toBe(TEAM_TEXT.inviteExpired)
  })
  it('business cannot use WhatsApp now → unavailable, still invited', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria()], ready: { b: false } })
    const w = fakeSend()
    await handleJoin(d, w.send, { from: MARIA, memberId: 'gm9' })
    expect(textOf(w.sent[0])).toBe(TEAM_TEXT.unavailable)
    expect(s.members[0].status).toBe('invited')
  })
  // Review Focus 4: the number is linked in another business.
  it('a number linked in another business: the invite goes out; Join moves the number here', async () => {
    const { d, s } = fakeTeamDeps({ members: [] })
    s.identities.push({ id: 'idX', business_id: 'other', profile_id: 'px', phone: MARIA, last_inbound_at: null, revoked: false, consent_source: 'qr_code' })
    const w = fakeSend()
    const r = await addPersonToTeam(d, w.send, { team: TEAM, phone: MARIA, name: 'Maria', invitedBy: 'm1' })
    expect(r.outcome).toBe('invited')
    expect(s.created.map((c) => c.businessId)).toEqual(['b'])           // a profile in THIS business, not the other one's
    await handleJoin(d, w.send, { from: MARIA, memberId: r.member!.id })
    expect(s.identities.find((i) => i.id === 'idX')!.revoked).toBe(true)
    expect(s.identities.filter((i) => i.phone === MARIA && !i.revoked)).toMatchObject([{ business_id: 'b', profile_id: 'new1', consent_source: 'team_invite' }])
  })
})

describe('delivery statuses and tracked sends', () => {
  it('131047 / 131051 failures flag the number; delivered or read clears it', async () => {
    const { d, s } = fakeTeamDeps({ members: [invitedMaria(), member({ id: 'gm2', profile_id: 'p2', phone: BEN.phone })] })
    await applyDeliveryStatuses(d, [{ id: 'w1', recipient: MARIA, status: 'failed', errorCode: 131047 }, { id: 'w2', recipient: BEN.phone, status: 'failed', errorCode: 131051 }])
    expect(s.members.map((m) => m.unreachable_at)).toEqual([NOW.toISOString(), NOW.toISOString()])
    await applyDeliveryStatuses(d, [{ id: 'w3', recipient: MARIA, status: 'delivered', errorCode: null }, { id: 'w4', recipient: BEN.phone, status: 'failed', errorCode: 130472 }])
    expect(s.members.map((m) => m.unreachable_at)).toEqual([null, NOW.toISOString()])
  })
  it('sendTracked logs billable only for a template outside the window', async () => {
    const { d, s } = fakeTeamDeps()
    await sendTracked(d, fakeSend().send, { to: ANNA.phone, msg: textMessage(ANNA.phone, 'hi'), business_id: 'b', site_id: null, profile_id: 'p1', kind: 'reply', lastInboundAt: null })
    expect(s.logs[0]).toMatchObject({ kind: 'reply', billable: false, wa_message_id: 'w1' })
  })
})
