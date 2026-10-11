import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import group from './fixtures/tg-group.json'
import { verifyWebhookSecret, tgText, tgButtons, tgWebAppButton, verifyInitData, makeTelegramSender, setupBot, BOT_USERNAME,
  parseGroupUpdate, makeTelegramApi, tgHtml, tgEditHtml, escapeHtml, tgOutcome, memberStatus, membersCanInvite, miniAppLink, TG_MINI_APP_SHORT_NAME, type TgApiResult } from '../../../../supabase/functions/_shared/channels/telegram'

describe('verifyWebhookSecret', () => {
  it('true/false/null', () => {
    expect(verifyWebhookSecret('abc', 'abc')).toBe(true)
    expect(verifyWebhookSecret('abd', 'abc')).toBe(false)
    expect(verifyWebhookSecret('ab', 'abc')).toBe(false)
    expect(verifyWebhookSecret(null, 'abc')).toBe(false)
  })
})

describe('builders', () => {
  it('tgText', () => expect(tgText('1', 'hi')).toEqual({ chat_id: '1', text: 'hi' }))
  it('tgButtons one per row, callback_data kept verbatim up to 64 bytes', () => {
    const m = tgButtons('1', 'pick', [{ id: 'a', title: 'A' }, { id: 'x'.repeat(64), title: 'B' }, { id: 'é'.repeat(32), title: 'C' }]) as any
    const kb = m.reply_markup.inline_keyboard
    expect(kb).toHaveLength(3)
    expect(kb[0]).toEqual([{ text: 'A', callback_data: 'a' }])
    expect(kb[1][0].callback_data).toBe('x'.repeat(64))
    expect(kb[2][0].callback_data).toBe('é'.repeat(32))
  })
  it('tgButtons throws on callback_data over 64 bytes (no silent truncation)', () => {
    const fill = 'fill:3f2b8c1e-9d4a-4b6e-8f1a-2c3d4e5f6a7b:7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d'   // 78 bytes
    expect(() => tgButtons('1', 'pick', [{ id: fill, title: 'Fridge temps' }])).toThrow(/64/)
    expect(() => tgButtons('1', 'pick', [{ id: 'x'.repeat(65), title: 'B' }])).toThrow()
    expect(() => tgButtons('1', 'pick', [{ id: 'é'.repeat(33), title: 'C' }])).toThrow()
  })
  it('tgWebAppButton', () => expect(tgWebAppButton('1', 't', [{ title: 'Open', url: 'https://x.y/z' }])).toEqual({
    chat_id: '1', text: 't', reply_markup: { inline_keyboard: [[{ text: 'Open', web_app: { url: 'https://x.y/z' } }]] },
  }))
})

describe('verifyInitData', () => {
  const token = '123:ABC'
  const now = new Date('2026-10-10T12:00:00Z')
  const build = (authDate: number, user = '{"id":777,"first_name":"Ann"}') => {
    const p = new URLSearchParams({ auth_date: String(authDate), query_id: 'Q1', user })
    const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n')
    const key = createHmac('sha256', 'WebAppData').update(token).digest()
    p.set('hash', createHmac('sha256', key).update(dcs).digest('hex'))
    return p
  }
  const nowSec = Math.floor(now.getTime() / 1000)
  it('valid → user id and names', async () => expect(await verifyInitData(build(nowSec - 60).toString(), token, now)).toEqual({ userId: '777', firstName: 'Ann', lastName: '' }))
  it('last name is returned when present', async () => {
    expect(await verifyInitData(build(nowSec - 60, '{"id":778,"first_name":"Ben","last_name":"Smith"}').toString(), token, now))
      .toEqual({ userId: '778', firstName: 'Ben', lastName: 'Smith' })
  })
  it('tampered user → null', async () => {
    const p = build(nowSec - 60); p.set('user', '{"id":888}')
    expect(await verifyInitData(p.toString(), token, now)).toBeNull()
  })
  it('wrong token → null', async () => expect(await verifyInitData(build(nowSec - 60).toString(), 'other', now)).toBeNull())
  it('25h old → null', async () => expect(await verifyInitData(build(nowSec - 25 * 3600).toString(), token, now)).toBeNull())
  it('missing hash / garbage → null', async () => {
    const p = build(nowSec); p.delete('hash')
    expect(await verifyInitData(p.toString(), token, now)).toBeNull()
    expect(await verifyInitData('', token, now)).toBeNull()
  })
})

describe('makeTelegramSender', () => {
  it('posts sendMessage and returns message_id', async () => {
    const calls: { url: string; body: any }[] = []
    const f = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true, result: { message_id: 55 } }), { status: 200 }) }) as unknown as typeof fetch
    const r = await makeTelegramSender({ token: 'T0K', fetchFn: f })({ chat_id: '1', text: 'hi' })
    expect(r).toEqual({ id: '55', ok: true, status: 200 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.telegram.org/botT0K/sendMessage')
    expect(calls[0].body).toEqual({ chat_id: '1', text: 'hi' })
  })
  it('answers callback query when callback_query_id present', async () => {
    const urls: string[] = []; const bodies: any[] = []
    const f = (async (url: string, init: any) => { urls.push(url); bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })) }) as unknown as typeof fetch
    await makeTelegramSender({ token: 'T', fetchFn: f })({ chat_id: '1', text: 'x', callback_query_id: 'cb' })
    expect(urls.map((u) => u.split('/').pop())).toEqual(['answerCallbackQuery', 'sendMessage'])
    expect(bodies[0]).toEqual({ callback_query_id: 'cb' })
    expect(bodies[1]).toEqual({ chat_id: '1', text: 'x' })
  })
  it('never throws', async () => {
    const boom = (async () => { throw new Error('net') }) as unknown as typeof fetch
    expect(await makeTelegramSender({ token: 'T', fetchFn: boom })({ chat_id: '1', text: 'x' })).toEqual({ id: null, ok: false, status: 0 })
    const bad = (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch
    expect(await makeTelegramSender({ token: 'T', fetchFn: bad })({ chat_id: '1', text: 'x' })).toEqual({ id: null, ok: false, status: 403 })
  })
})

describe('setupBot', () => {
  it('sets the webhook (messages + my_chat_member) and private + group commands', async () => {
    const calls: { m: string; b: any }[] = []
    const f = (async (url: string, init: any) => { calls.push({ m: url.split('/').pop()!, b: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true })) }) as unknown as typeof fetch
    const r = await setupBot({ token: 'T', webhookUrl: 'https://h/x', secret: 'S', fetchFn: f })
    expect(r).toEqual({ ok: true, errors: [] })
    expect(calls[0]).toEqual({ m: 'setWebhook', b: { url: 'https://h/x', secret_token: 'S', allowed_updates: ['message', 'my_chat_member'] } })
    expect(calls[1]).toEqual({ m: 'setMyCommands', b: { commands: [{ command: 'help', description: 'How Blueroll checks work' }] } })
    expect(calls[2]).toEqual({ m: 'setMyCommands', b: { scope: { type: 'all_group_chats' }, commands: [
      { command: 'checks', description: "Show today's checks" },
      { command: 'link', description: 'Link this group to Blueroll' },
      { command: 'help', description: 'How Blueroll checks work' },
    ] } })
  })
  it('collects errors without leaking token', async () => {
    const f = (async () => new Response(JSON.stringify({ ok: false, description: 'bad TOKEN123' }), { status: 401 })) as unknown as typeof fetch
    const r = await setupBot({ token: 'TOKEN123', webhookUrl: 'u', secret: 's', fetchFn: f })
    expect(r.ok).toBe(false); expect(r.errors).toHaveLength(3)
    expect(JSON.stringify(r.errors)).not.toContain('TOKEN123')
  })
})

const grp = (text: unknown, extra: Record<string, unknown> = {}) => ({
  update_id: 5, message: { message_id: 1, from: { id: 42, is_bot: false, first_name: 'Ann' }, chat: { id: -100123, type: 'supergroup', title: 'Kitchen' }, text, ...extra },
})

describe('parseGroupUpdate', () => {
  it('/link <code> in a group → link command with the chat title', () => {
    expect(parseGroupUpdate(grp('/link 482913'))).toEqual([{ kind: 'command', chatId: '-100123', chatTitle: 'Kitchen', userId: '42', command: 'link', arg: '482913', id: '5' }])
  })
  it('/checks (fixture, no title) and /checks@BluerollChecksBot → checks; other bot → nothing', () => {
    expect(parseGroupUpdate(group)).toEqual([{ kind: 'command', chatId: '-100123', chatTitle: '', userId: '123456789', command: 'checks', arg: '', id: '1004' }])
    expect(parseGroupUpdate(grp('/checks@BluerollChecksBot'))[0]).toMatchObject({ command: 'checks' })
    expect(parseGroupUpdate(grp('/checks@OtherBot'))).toEqual([])
  })
  it('/help and /start → help', () => {
    expect(parseGroupUpdate(grp('/help'))[0]).toMatchObject({ command: 'help' })
    expect(parseGroupUpdate(grp('/start'))[0]).toMatchObject({ command: 'help' })
  })
  it('chatter, unknown commands, stickers and bot senders are ignored', () => {
    expect(parseGroupUpdate(grp('hello all'))).toEqual([])
    expect(parseGroupUpdate(grp('/stop'))).toEqual([])
    expect(parseGroupUpdate(grp('/constructor'))).toEqual([])
    expect(parseGroupUpdate(grp(undefined, { sticker: { file_id: 'f' } }))).toEqual([])
    expect(parseGroupUpdate(grp('/checks', { from: { id: 7, is_bot: true } }))).toEqual([])
  })
  it('an anonymous group admin (GroupAnonymousBot, sender_chat = the group) can still /link', () => {
    const u = grp('/link 111111', { from: { id: 1087968824, is_bot: true, first_name: 'Group' }, sender_chat: { id: -100123, type: 'supergroup' } })
    expect(parseGroupUpdate(u)).toEqual([{ kind: 'command', chatId: '-100123', chatTitle: 'Kitchen', userId: '', command: 'link', arg: '111111', id: '5' }])
  })
  it('any private message (incl. an old /start <code> and stickers) → private', () => {
    expect(parseGroupUpdate({ update_id: 6, message: { from: { id: 42, is_bot: false }, chat: { id: 42, type: 'private' }, text: '/start 482913' } }))
      .toEqual([{ kind: 'private', chatId: '42', id: '6' }])
    expect(parseGroupUpdate({ update_id: 7, message: { from: { id: 42, is_bot: false }, chat: { id: 42, type: 'private' }, sticker: {} } }))
      .toEqual([{ kind: 'private', chatId: '42', id: '7' }])
  })
  it('my_chat_member left/kicked in a group → bot_removed; added or private → nothing', () => {
    const mcm = (status: string, type = 'supergroup') => ({ update_id: 8, my_chat_member: { chat: { id: -100123, type }, from: { id: 42 }, new_chat_member: { status, user: { id: 1 } } } })
    expect(parseGroupUpdate(mcm('left'))).toEqual([{ kind: 'bot_removed', chatId: '-100123', id: '8' }])
    expect(parseGroupUpdate(mcm('kicked'))).toEqual([{ kind: 'bot_removed', chatId: '-100123', id: '8' }])
    expect(parseGroupUpdate(mcm('member'))).toEqual([])
    expect(parseGroupUpdate(mcm('kicked', 'private'))).toEqual([])
  })
  it('group → supergroup migration', () => {
    const u = { update_id: 9, message: { from: { id: 42, is_bot: false }, chat: { id: -5, type: 'group' }, migrate_to_chat_id: -1009 } }
    expect(parseGroupUpdate(u)).toEqual([{ kind: 'migrated', chatId: '-5', newChatId: '-1009', id: '9' }])
  })
  it('channel posts, edits and malformed input never produce events or throw', () => {
    expect(parseGroupUpdate({ update_id: 1, channel_post: { chat: { id: -1, type: 'channel' }, text: '/checks' } })).toEqual([])
    expect(parseGroupUpdate({ update_id: 1, edited_message: grp('/checks').message })).toEqual([])
    for (const v of [null, undefined, 5, 'x', [], {}, { message: 5 }, { message: { chat: null } }, { my_chat_member: 'x' }]) expect(parseGroupUpdate(v)).toEqual([])
  })
})

describe('Mini App direct link', () => {
  it('uses the BotFather short name', () => {
    expect(TG_MINI_APP_SHORT_NAME).toBe('form')
    expect(miniAppLink('abc_DEF-1')).toBe(`https://t.me/${BOT_USERNAME}/${TG_MINI_APP_SHORT_NAME}?startapp=abc_DEF-1`)
  })
})

describe('HTML builders', () => {
  it('escapeHtml escapes &, < and >', () => expect(escapeHtml('Fish & Chips <Bar>')).toBe('Fish &amp; Chips &lt;Bar&gt;'))
  it('tgHtml: HTML parse mode, no link previews, URL buttons', () => {
    expect(tgHtml('-1', '<b>x</b>', [[{ text: 'A', url: 'https://t.me/a' }]])).toEqual({
      chat_id: '-1', text: '<b>x</b>', parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: 'A', url: 'https://t.me/a' }]] },
    })
    expect(tgHtml('-1', 'x')).toEqual({ chat_id: '-1', text: 'x', parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
  })
  it('tgEditHtml always sends reply_markup (an empty keyboard clears old buttons)', () => {
    expect(tgEditHtml('-1', '55', 'x', [])).toEqual({
      chat_id: '-1', message_id: 55, text: 'x', parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [] },
    })
  })
})

describe('makeTelegramApi', () => {
  it('posts the method and returns the result', async () => {
    const calls: { url: string; body: any }[] = []
    const f = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } })) }) as unknown as typeof fetch
    const r = await makeTelegramApi({ token: 'T0K', fetchFn: f })('sendMessage', { chat_id: '-1', text: 'x' })
    expect(r).toEqual({ ok: true, status: 200, description: '', result: { message_id: 9 }, migrateTo: null })
    expect(calls).toEqual([{ url: 'https://api.telegram.org/botT0K/sendMessage', body: { chat_id: '-1', text: 'x' } }])
  })
  it('errors: description without the token, migrate_to_chat_id surfaced, never throws', async () => {
    const f = (async () => new Response(JSON.stringify({ ok: false, description: 'Bad Request: group chat was upgraded T0K', parameters: { migrate_to_chat_id: -1009 } }), { status: 400 })) as unknown as typeof fetch
    const r = await makeTelegramApi({ token: 'T0K', fetchFn: f })('sendMessage', {})
    expect(r).toEqual({ ok: false, status: 400, description: 'Bad Request: group chat was upgraded ***', result: null, migrateTo: '-1009' })
    const boom = (async () => { throw new Error('net') }) as unknown as typeof fetch
    expect(await makeTelegramApi({ token: 'T', fetchFn: boom })('getChat', {})).toEqual({ ok: false, status: 0, description: 'network', result: null, migrateTo: null })
  })
})

const R = (o: Partial<TgApiResult>): TgApiResult => ({ ok: false, status: 400, description: '', result: null, migrateTo: null, ...o })

describe('tgOutcome', () => {
  it.each([
    [R({ ok: true, status: 200 }), 'ok'],
    [R({ description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' }), 'not_modified'],
    [R({ description: 'Bad Request: message to edit not found' }), 'gone'],
    [R({ description: 'Bad Request: message to delete not found' }), 'gone'],
    [R({ description: "Bad Request: message can't be deleted for everyone" }), 'gone'],
    [R({ description: "Bad Request: message can't be edited" }), 'gone'],
    [R({ status: 403, description: 'Forbidden: bot was kicked from the supergroup chat' }), 'kicked'],
    [R({ status: 403, description: 'Forbidden: bot is not a member of the group chat' }), 'kicked'],
    [R({ description: 'Bad Request: chat not found' }), 'kicked'],
    [R({ description: 'Bad Request: group chat was upgraded to a supergroup chat', migrateTo: '-1009' }), 'migrated'],
    [R({ status: 429, description: 'Too Many Requests: retry after 5' }), 'retry'],
    [R({ status: 0, description: 'network' }), 'retry'],
  ])('%#', (r, want) => expect(tgOutcome(r)).toBe(want))
})

describe('memberStatus / membersCanInvite', () => {
  it('member statuses', () => {
    for (const s of ['creator', 'administrator', 'member']) expect(memberStatus(R({ ok: true, status: 200, result: { status: s } }))).toBe('member')
    expect(memberStatus(R({ ok: true, status: 200, result: { status: 'restricted', is_member: true } }))).toBe('member')
    expect(memberStatus(R({ ok: true, status: 200, result: { status: 'restricted', is_member: false } }))).toBe('not_member')
    expect(memberStatus(R({ ok: true, status: 200, result: { status: 'left' } }))).toBe('not_member')
    expect(memberStatus(R({ ok: true, status: 200, result: { status: 'kicked' } }))).toBe('not_member')
    expect(memberStatus(R({ description: 'Bad Request: user not found' }))).toBe('not_member')
    expect(memberStatus(R({ description: 'Bad Request: PARTICIPANT_ID_INVALID' }))).toBe('not_member')
    expect(memberStatus(R({ status: 0, description: 'network' }))).toBe('unknown')
    expect(memberStatus(R({ status: 429 }))).toBe('unknown')
  })
  it('can members invite?', () => {
    expect(membersCanInvite(R({ ok: true, status: 200, result: { permissions: { can_invite_users: true } } }))).toBe(true)
    expect(membersCanInvite(R({ ok: true, status: 200, result: { permissions: { can_invite_users: false } } }))).toBe(false)
    expect(membersCanInvite(R({ ok: true, status: 200, result: {} }))).toBe(false)
    expect(membersCanInvite(R({ status: 0 }))).toBeNull()
  })
})
