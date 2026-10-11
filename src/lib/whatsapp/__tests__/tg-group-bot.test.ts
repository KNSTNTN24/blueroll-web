// src/lib/whatsapp/__tests__/tg-group-bot.test.ts
import { describe, it, expect } from 'vitest'
import { handleGroupEvent, checkGroupPermissions, GROUP_TEXT } from '../../../../supabase/functions/_shared/channels/tg-group-bot'
import type { TgEvent } from '../../../../supabase/functions/_shared/channels/telegram'
import { fakeGroupDeps, fakeTgApi, groupRow, GROUP, NOW, tpl } from './fakes/group-deps'

const CODE = { code: '482913', business_id: 'b', issued_by: 'm1', expires_at: '2026-10-14T09:50:00Z', used_at: null }
let n = 0
const cmd = (command: 'link' | 'checks' | 'help', arg = '', chatId = '-1002'): TgEvent => ({ kind: 'command', chatId, chatTitle: 'Kitchen', userId: '42', command, arg, id: `u${++n}` })
const texts = (calls: { method: string; body: any }[]) => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text)

describe('copy', () => {
  it('spec strings', () => {
    expect(GROUP_TEXT.privateHelp).toBe("Blueroll checks happen in your team's Telegram group. Ask your manager to add you.")
    expect(GROUP_TEXT.linked('Fern & Fig')).toBe('Linked to Fern & Fig. A manager will choose which checks this group does.')
    expect(GROUP_TEXT.nothingDue).toBe('Nothing is due right now 👍')
    expect(GROUP_TEXT.permissionWarning).toBe("Anyone in this group can add people. To keep checks safe, an admin should turn off 'Add members' for members in group settings.")
  })
})

describe('private chats', () => {
  it('any private message (incl. an old /start code) gets the "use your team\'s group" reply and links nothing', async () => {
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent({ kind: 'private', chatId: '42', id: 'p1' }, d, api)
    expect(calls).toEqual([{ method: 'sendMessage', body: { chat_id: '42', text: GROUP_TEXT.privateHelp } }])
    expect(s.codes[0].used_at).toBeNull()
  })
})

describe('/link', () => {
  it('valid code → group linked with its title, reply, permission check (members can invite → warning + manager note)', async () => {
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE }] })
    const { api, calls } = fakeTgApi((m) => (m === 'getChat' ? { result: { permissions: { can_invite_users: true } } } : undefined))
    await handleGroupEvent(cmd('link', '482913'), d, api)
    expect(s.groups).toEqual([expect.objectContaining({ business_id: 'b', channel: 'telegram', chat_id: '-1002', title: 'Kitchen', linked_by: 'm1', unlinked_at: null })])
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'getChat', 'sendMessage'])
    expect(texts(calls)).toEqual([GROUP_TEXT.linked('Fern & Fig'), GROUP_TEXT.permissionWarning])
    expect(calls[1].body).toEqual({ chat_id: '-1002' })
    expect(s.notifications).toEqual([expect.objectContaining({ user_id: 'm1', type: 'team', title: 'Telegram group is open to new members', link: '/settings' })])
  })
  it('members cannot invite → no warning', async () => {
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE }] })
    const { api, calls } = fakeTgApi((m) => (m === 'getChat' ? { result: { permissions: { can_invite_users: false } } } : undefined))
    await handleGroupEvent(cmd('link', '482913'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.linked('Fern & Fig')])
    expect(s.notifications).toEqual([])
  })
  it('expired or used code → invalid reply and a recorded failure; no group', async () => {
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE, expires_at: '2026-10-14T09:00:00Z' }, { ...CODE, code: '111111', used_at: '2026-10-14T09:00:00Z' }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('link', '482913'), d, api)
    await handleGroupEvent(cmd('link', '111111'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.linkInvalid, GROUP_TEXT.linkInvalid])
    expect(s.linkFails).toHaveLength(2)
    expect(s.groups).toEqual([])
  })
  it('after 5 failures in an hour the chat is refused without trying the code', async () => {
    const fails = Array.from({ length: 5 }, () => ({ chatId: '-1002', at: new Date('2026-10-14T09:10:00Z') }))
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE }], linkFails: fails })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('link', '482913'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.linkLimited])
    expect(s.codes[0].used_at).toBeNull()
  })
  it('/link without a 6-digit code → how-to, not a failure', async () => {
    const { d, s } = fakeGroupDeps({ groups: [] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('link', 'abc'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.linkUsage])
    expect(s.linkFails).toEqual([])
  })
  it('team cannot use Telegram right now → code given back, unavailable reply', async () => {
    const { d, s } = fakeGroupDeps({ groups: [], codes: [{ ...CODE }], ready: { b: false } })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('link', '482913'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.unavailable])
    expect(s.codes[0].used_at).toBeNull()
    expect(s.groups).toEqual([])
  })
  it('relinking to another business takes the old lists down and clears checklists + alerts', async () => {
    const old = groupRow({ id: 'g1', business_id: 'old', channel: 'telegram', chat_id: '-1002', title: 'Kitchen', alerts: true })
    const { d, s } = fakeGroupDeps({
      groups: [old], codes: [{ ...CODE }], mappings: [{ group_id: 'g1', template_id: 'tX' }],
      lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '77', tokens: {}, rendered_hash: 'h' }],
    })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('link', '482913'), d, api)
    expect(calls[0]).toEqual({ method: 'deleteMessage', body: { chat_id: '-1002', message_id: 77 } })
    expect(s.lists).toEqual([])
    expect(s.mappings).toEqual([])
    expect(s.groups[0]).toMatchObject({ business_id: 'b', alerts: false, unlinked_at: null })
  })
  it('relinking to another business expires the old lists\' open forms', async () => {
    const old = groupRow({ id: 'g1', business_id: 'old', channel: 'telegram', chat_id: '-1002', title: 'Kitchen', alerts: false })
    const tok = { token: 'tkOld', kind: 'group_checklist' as const, business_id: 'old', group_id: 'g1', site_id: 's1', template_id: 'tX', item_ids: ['i1'], expires_at: '2026-10-15T09:00:00Z', used_at: null, used_by_name: null }
    const { d, s } = fakeGroupDeps({
      groups: [old], codes: [{ ...CODE }], tokens: [tok],
      lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '77', tokens: { tX: 'tkOld' }, rendered_hash: 'h' }],
    })
    await handleGroupEvent(cmd('link', '482913'), d, fakeTgApi().api)
    expect(s.tokens[0].expires_at).toBe(NOW.toISOString())
  })
})

describe('/checks and /help', () => {
  const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })
  it('unlinked group → not linked reply', async () => {
    const { d } = fakeGroupDeps({ groups: [] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('checks'), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.notLinked])
  })
  it('linked, no checklists chosen → noChecks', async () => {
    const { d } = fakeGroupDeps()
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('checks', '', GROUP.chat_id), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.noChecks])
  })
  it('due checks → the live list is (re)posted', async () => {
    const { d, s } = fakeGroupDeps({ templates: [FRIDGE], mappings: [{ group_id: 'g1', template_id: 'tA' }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('checks', '', GROUP.chat_id), d, api)
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ chat_id: '-1001', parse_mode: 'HTML', text: '📋 <b>Wharf Side</b> — 0 of 1 done\n🟠 Fridge temps · due 11:00' })
    expect(s.lists).toHaveLength(1)
  })
  it('nothing open → "Nothing is due right now 👍" once', async () => {
    const { d } = fakeGroupDeps({ templates: [FRIDGE], mappings: [{ group_id: 'g1', template_id: 'tA' }],
      completions: [{ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: null }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('checks', '', GROUP.chat_id), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.nothingDue])
  })
  it('team not ready → unavailable', async () => {
    const { d } = fakeGroupDeps({ ready: { b: false }, templates: [FRIDGE], mappings: [{ group_id: 'g1', template_id: 'tA' }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('checks', '', GROUP.chat_id), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.unavailable])
  })
  it('/help → help text', async () => {
    const { d } = fakeGroupDeps()
    const { api, calls } = fakeTgApi()
    await handleGroupEvent(cmd('help', '', GROUP.chat_id), d, api)
    expect(texts(calls)).toEqual([GROUP_TEXT.help])
  })
})

describe('membership changes and duplicates', () => {
  it('bot removed from the group → lists deleted, group unlinked', async () => {
    const { d, s } = fakeGroupDeps({ lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '55', tokens: {}, rendered_hash: 'h' }] })
    const { api, calls } = fakeTgApi()
    await handleGroupEvent({ kind: 'bot_removed', chatId: '-1001', id: 'r1' }, d, api)
    expect(calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 55 } }])
    expect(s.lists).toEqual([])
    expect(s.groups[0].unlinked_at).toBe(NOW.toISOString())
  })
  it('group migrated to a supergroup keeps its link under the new chat id', async () => {
    const { d, s } = fakeGroupDeps()
    await handleGroupEvent({ kind: 'migrated', chatId: '-1001', newChatId: '-1009', id: 'm1' }, d, fakeTgApi().api)
    expect(s.groups[0].chat_id).toBe('-1009')
  })
  it('a duplicate delivery of the same update is ignored', async () => {
    const { d } = fakeGroupDeps()
    const { api, calls } = fakeTgApi()
    await handleGroupEvent({ kind: 'private', chatId: '42', id: 'dup' }, d, api)
    await handleGroupEvent({ kind: 'private', chatId: '42', id: 'dup' }, d, api)
    expect(calls).toHaveLength(1)
  })
})

describe('checkGroupPermissions', () => {
  it('warns at most once a day; unknown when Telegram does not answer', async () => {
    const { d, s } = fakeGroupDeps()
    const open = fakeTgApi((m) => (m === 'getChat' ? { result: { permissions: { can_invite_users: true } } } : undefined))
    expect(await checkGroupPermissions(d, open.api, GROUP, NOW)).toBe('warned')
    expect(await checkGroupPermissions(d, open.api, GROUP, NOW)).toBe('skipped')
    expect(texts(open.calls)).toEqual([GROUP_TEXT.permissionWarning])
    expect(s.notifications).toHaveLength(1)
    const down = fakeTgApi((m) => (m === 'getChat' ? { ok: false, status: 0, description: 'network' } : undefined))
    expect(await checkGroupPermissions(d, down.api, GROUP, NOW)).toBe('unknown')
  })
})
