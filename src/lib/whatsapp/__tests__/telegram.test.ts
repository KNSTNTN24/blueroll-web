import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import start from './fixtures/tg-start.json'
import command from './fixtures/tg-command.json'
import callback from './fixtures/tg-callback.json'
import group from './fixtures/tg-group.json'
import { verifyWebhookSecret, parseUpdate, tgText, tgButtons, tgWebAppButton, verifyInitData, makeTelegramSender, answerCallback, setupBot, BOT_USERNAME } from '../../../../supabase/functions/_shared/channels/telegram'

const priv = (text: unknown, extra: Record<string, unknown> = {}) => ({ update_id: 9, message: { from: { id: 42, is_bot: false }, chat: { id: 42, type: 'private' }, text, ...extra } })

describe('verifyWebhookSecret', () => {
  it('true/false/null', () => {
    expect(verifyWebhookSecret('abc', 'abc')).toBe(true)
    expect(verifyWebhookSecret('abd', 'abc')).toBe(false)
    expect(verifyWebhookSecret('ab', 'abc')).toBe(false)
    expect(verifyWebhookSecret(null, 'abc')).toBe(false)
  })
})

describe('parseUpdate', () => {
  it('/start code → LINK', () => expect(parseUpdate(start)).toEqual([{ kind: 'text', from: '123456789', text: 'LINK 482913', id: '1001' }]))
  it('/start alone and /help → help', () => {
    expect(parseUpdate(priv('/start'))[0]).toMatchObject({ text: 'help' })
    expect(parseUpdate(priv('/help'))[0]).toMatchObject({ text: 'help' })
    expect(parseUpdate(priv('/start abc'))[0]).toMatchObject({ text: 'help' })
  })
  it('/checks@Bot → checks; /stop; other text as is', () => {
    expect(parseUpdate(command)).toEqual([{ kind: 'text', from: '123456789', text: 'checks', id: '1002' }])
    expect(parseUpdate(priv('/stop'))[0]).toMatchObject({ text: 'stop' })
    expect(parseUpdate(priv('hello there'))[0]).toMatchObject({ text: 'hello there' })
    expect(parseUpdate(priv('/checks@OtherBot'))).toEqual([])
    expect(BOT_USERNAME).toBe('BluerollChecksBot')
  })
  it('callback → button', () => expect(parseUpdate(callback)).toEqual([{ kind: 'button', from: '123456789', payload: 'fill:t1:s1', id: '1003', callbackId: 'cb-77' }]))
  it('ignored shapes → []', () => {
    expect(parseUpdate(group)).toEqual([])
    expect(parseUpdate({ update_id: 1, channel_post: { chat: { id: 1, type: 'channel' }, text: 'x' } })).toEqual([])
    expect(parseUpdate({ update_id: 1, edited_message: priv('x').message })).toEqual([])
    expect(parseUpdate({ update_id: 1, message: { ...priv('x').message, from: { id: 42, is_bot: true } } })).toEqual([])
    expect(parseUpdate(priv(undefined, { sticker: { file_id: 'f' } }))).toEqual([])
    expect(parseUpdate({ update_id: 1, callback_query: { id: 'c', from: { id: 1 }, message: { chat: { id: -5, type: 'group' } }, data: 'x' } })).toEqual([])
  })
  it('malformed never throws', () => {
    for (const v of [null, undefined, 5, 'x', [], {}, { message: 5 }, { message: { chat: null } }, { callback_query: 'x' }, { callback_query: { from: null } }]) expect(parseUpdate(v)).toEqual([])
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
  it('valid → userId', async () => expect(await verifyInitData(build(nowSec - 60).toString(), token, now)).toEqual({ userId: '777' }))
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

describe('answerCallback', () => {
  it('posts answerCallbackQuery and never throws', async () => {
    const calls: { url: string; body: any }[] = []
    const f = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}') }) as unknown as typeof fetch
    await answerCallback('T', 'cb1', f)
    expect(calls).toEqual([{ url: 'https://api.telegram.org/botT/answerCallbackQuery', body: { callback_query_id: 'cb1' } }])
    const boom = (async () => { throw new Error('net') }) as unknown as typeof fetch
    await expect(answerCallback('T', 'cb1', boom)).resolves.toBeUndefined()
  })
})

describe('setupBot', () => {
  it('sets webhook + commands', async () => {
    const calls: { m: string; b: any }[] = []
    const f = (async (url: string, init: any) => { calls.push({ m: url.split('/').pop()!, b: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true })) }) as unknown as typeof fetch
    const r = await setupBot({ token: 'T', webhookUrl: 'https://h/x', secret: 'S', fetchFn: f })
    expect(r).toEqual({ ok: true, errors: [] })
    expect(calls[0]).toEqual({ m: 'setWebhook', b: { url: 'https://h/x', secret_token: 'S', allowed_updates: ['message', 'callback_query'] } })
    expect(calls[1].m).toBe('setMyCommands')
  })
  it('collects errors without leaking token', async () => {
    const f = (async () => new Response(JSON.stringify({ ok: false, description: 'bad TOKEN123' }), { status: 401 })) as unknown as typeof fetch
    const r = await setupBot({ token: 'TOKEN123', webhookUrl: 'u', secret: 's', fetchFn: f })
    expect(r.ok).toBe(false); expect(r.errors).toHaveLength(2)
    expect(JSON.stringify(r.errors)).not.toContain('TOKEN123')
  })
})
