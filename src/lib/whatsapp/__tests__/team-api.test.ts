// src/lib/whatsapp/__tests__/team-api.test.ts
import { describe, it, expect } from 'vitest'
import { handleTeamMemberRequest } from '../../../../supabase/functions/_shared/channels/team-api'
import { fakeTeamDeps, fakeSend, member, ANNA, BEN, BOSS } from './fakes/team-deps'

const boss = { profile_id: BOSS.profile_id, business_id: 'b' }

describe('handleTeamMemberRequest', () => {
  it('add: a new person by name and phone → 200 invited', async () => {
    const { d, s } = fakeTeamDeps()
    const w = fakeSend()
    const r = await handleTeamMemberRequest(d, w.send, boss, { action: 'add', group_id: 'g1', full_name: '  Maria  Lopez ', phone: '07700 900777' })
    expect(r).toEqual({ status: 200, body: { outcome: 'invited', member_id: 'gm2' } })
    expect(s.created[0]).toMatchObject({ fullName: 'Maria Lopez' })
    expect(w.sent[0].to).toBe('447700900777')
  })
  it('add: an existing Team member picked + phone', async () => {
    const { d, s } = fakeTeamDeps()
    const r = await handleTeamMemberRequest(d, fakeSend().send, boss, { action: 'add', group_id: 'g1', profile_id: BEN.profile_id, phone: '+44 7700 900456' })
    expect(r.status).toBe(200)
    expect(s.members.find((m) => m.id === r.body.member_id)).toMatchObject({ profile_id: BEN.profile_id, phone: BEN.phone })
  })
  it('validation and permissions', async () => {
    const { d } = fakeTeamDeps()
    const send = fakeSend().send
    expect((await handleTeamMemberRequest(d, send, { profile_id: ANNA.profile_id, business_id: 'b' }, { action: 'add', group_id: 'g1', full_name: 'X', phone: '07700900777' })).status).toBe(403)
    expect(await handleTeamMemberRequest(d, send, boss, null)).toEqual({ status: 400, body: { error: 'body' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'nope' })).toEqual({ status: 400, body: { error: 'action' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'add', group_id: 'zz', full_name: 'X', phone: '07700900777' })).toEqual({ status: 404, body: { error: 'team' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'add', group_id: 'g1', full_name: 'X', phone: '12' })).toEqual({ status: 400, body: { error: 'phone' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'add', group_id: 'g1', full_name: ' ', phone: '07700900777' })).toEqual({ status: 400, body: { error: 'name' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'add', group_id: 'g1', profile_id: 'nobody', phone: '07700900777' })).toEqual({ status: 400, body: { error: 'profile' } })
  })
  it('WhatsApp off → 409; template not approved → 502 template; send failure → 502 send', async () => {
    const off = fakeTeamDeps({ ready: { b: false } })
    expect(await handleTeamMemberRequest(off.d, fakeSend().send, boss, { action: 'add', group_id: 'g1', full_name: 'Maria', phone: '07700900777' })).toEqual({ status: 409, body: { error: 'whatsapp_off' } })
    const a = fakeTeamDeps()
    expect(await handleTeamMemberRequest(a.d, fakeSend(() => ({ ok: false, status: 404, id: null, errorCode: 132001 })).send, boss, { action: 'add', group_id: 'g1', full_name: 'Maria', phone: '07700900777' }))
      .toEqual({ status: 502, body: { error: 'template' } })
    const b = fakeTeamDeps()
    expect(await handleTeamMemberRequest(b.d, fakeSend(() => ({ ok: false, status: 500, id: null })).send, boss, { action: 'add', group_id: 'g1', full_name: 'Maria', phone: '07700900777' }))
      .toEqual({ status: 502, body: { error: 'send' } })
  })
  it('resend: once per hour; only invited members of the caller’s business', async () => {
    const { d, s } = fakeTeamDeps({ members: [member({ id: 'gm9', profile_id: 'p9', phone: '447700900777', status: 'invited', last_invite_sent_at: '2026-10-14T09:00:00Z' }), member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone })] })
    const send = fakeSend().send
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'resend', member_id: 'gm9' })).toEqual({ status: 429, body: { error: 'too_soon' } })
    s.now = new Date('2026-10-14T10:00:00Z')
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'resend', member_id: 'gm9' })).toEqual({ status: 200, body: { outcome: 'invited', member_id: 'gm9' } })
    expect(await handleTeamMemberRequest(d, send, boss, { action: 'resend', member_id: 'gm1' })).toEqual({ status: 409, body: { error: 'not_invited' } })
    expect(await handleTeamMemberRequest(d, send, { profile_id: 'm1', business_id: 'other' }, { action: 'resend', member_id: 'gm9' })).toMatchObject({ status: 403 })
  })
  it('never crosses businesses: another business\'s team, member or person; teams at removed sites', async () => {
    const other = { profile_id: 'm2', business_id: 'o' }
    const people = [
      { profile_id: ANNA.profile_id, business_id: 'b', full_name: ANNA.name, role: 'kitchen_staff', role_id: null },
      { profile_id: BOSS.profile_id, business_id: 'b', full_name: BOSS.name, role: 'owner', role_id: null },
      { profile_id: 'm2', business_id: 'o', full_name: 'Olga Other', role: 'owner', role_id: null },
      { profile_id: 'p9', business_id: 'o', full_name: 'Pat Other', role: 'kitchen_staff', role_id: null },
    ]
    const { d, s } = fakeTeamDeps({ people, managers: [BOSS.profile_id, 'm2'], ready: { b: true, o: true },
      members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone, status: 'invited', last_invite_sent_at: null })] })
    const w = fakeSend()
    expect(await handleTeamMemberRequest(d, w.send, other, { action: 'add', group_id: 'g1', full_name: 'X', phone: '07700900777' })).toEqual({ status: 404, body: { error: 'team' } })
    expect(await handleTeamMemberRequest(d, w.send, other, { action: 'resend', member_id: 'gm1' })).toEqual({ status: 404, body: { error: 'member' } })
    expect(await handleTeamMemberRequest(d, w.send, boss, { action: 'add', group_id: 'g1', profile_id: 'p9', phone: '07700900777' })).toEqual({ status: 400, body: { error: 'profile' } })
    expect(w.sent).toHaveLength(0)
    s.sites = []
    expect(await handleTeamMemberRequest(d, w.send, boss, { action: 'add', group_id: 'g1', full_name: 'X', phone: '07700900777' })).toEqual({ status: 404, body: { error: 'team' } })
    expect(await handleTeamMemberRequest(d, w.send, boss, { action: 'resend', member_id: 'gm1' })).toEqual({ status: 404, body: { error: 'member' } })
    expect(await handleTeamMemberRequest(d, w.send, boss, { action: 'resend', member_id: 'nope' })).toEqual({ status: 404, body: { error: 'member' } })
  })
  it('names are capped at 60 characters', async () => {
    const { d, s } = fakeTeamDeps()
    await handleTeamMemberRequest(d, fakeSend().send, boss, { action: 'add', group_id: 'g1', full_name: 'A'.repeat(70), phone: '07700900777' })
    expect(s.created[0].fullName).toBe('A'.repeat(60))
  })
})
