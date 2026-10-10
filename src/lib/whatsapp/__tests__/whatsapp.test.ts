import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import text from './fixtures/text.json'
import button from './fixtures/button.json'
import flow from './fixtures/flow.json'
import status from './fixtures/status.json'
import { verifySignature, parseInbound, textMessage, buttonsMessage, templateMessage, flowMessage, makeSender } from '../../../../supabase/functions/_shared/channels/whatsapp'
import { maskPhone, maskId } from '../../../../supabase/functions/_shared/channels/mask'

describe('verifySignature', () => {
  const body = '{"a":1}'
  const good = 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex')
  it('accepts a valid signature, rejects wrong/missing', async () => {
    expect(await verifySignature(body, good, 'secret')).toBe(true)
    expect(await verifySignature(body, good, 'other')).toBe(false)
    expect(await verifySignature(body + ' ', good, 'secret')).toBe(false)
    expect(await verifySignature(body, null, 'secret')).toBe(false)
    expect(await verifySignature(body, 'sha256=zz', 'secret')).toBe(false)
  })
})

describe('parseInbound', () => {
  it('text', () => expect(parseInbound(text)).toEqual([{ kind: 'text', from: '447700900123', text: 'LINK 482913', id: 'wamid.T1' }]))
  it('template quick reply and interactive button', () => expect(parseInbound(button)).toEqual([
    { kind: 'button', from: '447700900123', payload: 'fill:t1:s1', id: 'wamid.B1' },
    { kind: 'button', from: '447700900123', payload: 'checks', id: 'wamid.B2' },
  ]))
  it('flow reply', () => expect(parseInbound(flow)).toEqual([
    { kind: 'flow', from: '447700900123', token: 'tok123', response: { f0: '4.5', f1: 'yes' }, id: 'wamid.F1' },
  ]))
  it('statuses and junk → nothing', () => {
    expect(parseInbound(status)).toEqual([])
    expect(parseInbound(null)).toEqual([])
    expect(parseInbound({ entry: [{ changes: [{ value: { messages: [{ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { response_json: 'not json' } } }] } }] }] })).toEqual([])
    expect(parseInbound({ entry: [{ changes: {} }] })).toEqual([])
    expect(parseInbound({ entry: [{ changes: [{ value: { messages: {} } }] }] })).toEqual([])
    expect(parseInbound({ entry: [{ changes: [{ value: { messages: 5 } }] }] })).toEqual([])
  })
  it('skips buttons with empty/non-string ids and non-digit senders', () => {
    const wrap = (m: unknown) => ({ entry: [{ changes: [{ value: { messages: [m] } }] }] })
    expect(parseInbound(wrap({ from: '447700900123', id: 'w', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: '' } } }))).toEqual([])
    expect(parseInbound(wrap({ from: '447700900123', id: 'w', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 7 } } }))).toEqual([])
    expect(parseInbound(wrap({ from: '447700900123', id: 'w', type: 'interactive', interactive: { type: 'button_reply', button_reply: {} } }))).toEqual([])
    expect(parseInbound(wrap({ from: '447700900123', id: 'w', type: 'button', button: { payload: '' } }))).toEqual([])
    expect(parseInbound(wrap({ from: '+44 7700', id: 'w', type: 'text', text: { body: 'hi' } }))).toEqual([])
    expect(parseInbound(wrap({ from: 447700900123, id: 'w', type: 'text', text: { body: 'hi' } }))).toEqual([])
    expect(parseInbound(wrap({ from: '', id: 'w', type: 'text', text: { body: 'hi' } }))).toEqual([])
  })
})

describe('builders', () => {
  it('text and buttons', () => {
    expect(textMessage('44', 'hi')).toEqual({ messaging_product: 'whatsapp', to: '44', type: 'text', text: { body: 'hi', preview_url: false } })
    const b = buttonsMessage('44', 'Pick', [{ id: 'fill:a:s', title: 'A very long checklist name here' }]) as any
    expect(b.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20)
  })
  it('template with quick replies', () => {
    const t = templateMessage('44', 'checklist_reminder', ['Fridge temps', '11:00', 'Wharf Side'], ['fill:t1:s1']) as any
    expect(t.template.name).toBe('checklist_reminder')
    expect(t.template.language).toEqual({ code: 'en_GB' })
    expect(t.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Fridge temps' }, { type: 'text', text: '11:00' }, { type: 'text', text: 'Wharf Side' }] },
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'fill:t1:s1' }] },
    ])
  })
  it('template params and button titles are sanitised for Meta', () => {
    const long = 'x'.repeat(250)
    const t = templateMessage('44', 'manager_alert', ['Walk-in\nfridge\t  door', '   ', long, ''], []) as any
    const texts = t.template.components[0].parameters.map((p: any) => p.text)
    expect(texts[0]).toBe('Walk-in fridge door')
    expect(texts[1]).toBe('—')
    expect(texts[2].length).toBe(200)
    expect(texts[3]).toBe('—')
    const b = buttonsMessage('44', 'Pick', [{ id: 'a', title: 'Fridge\n\ntemps' }, { id: 'b', title: '  ' }]) as any
    expect(b.interactive.action.buttons.map((x: any) => x.reply.title)).toEqual(['Fridge temps', '—'])
  })
  it('flow message', () => {
    const f = flowMessage('44', { flowId: 'F', token: 'tok', cta: 'Fill in', body: 'Fridge temps', screen: 'CHECKLIST' }) as any
    expect(f.interactive.type).toBe('flow')
    expect(f.interactive.action.parameters).toMatchObject({ flow_message_version: '3', flow_id: 'F', flow_token: 'tok', flow_cta: 'Fill in', flow_action: 'navigate', flow_action_payload: { screen: 'CHECKLIST' } })
    expect(f.interactive.action.parameters.mode).toBeUndefined()
  })
  it('flow message in draft mode (WA_FLOWS_DRAFT=1) sends mode: draft', () => {
    const g = globalThis as any
    const prev = g.Deno
    g.Deno = { env: { get: (k: string) => (k === 'WA_FLOWS_DRAFT' ? '1' : undefined) } }
    try {
      const f = flowMessage('44', { flowId: 'F', token: 'tok', cta: 'Fill in', body: 'x', screen: 'CHECKLIST' }) as any
      expect(f.interactive.action.parameters.mode).toBe('draft')
    } finally {
      g.Deno = prev
    }
  })
})

describe('makeSender', () => {
  it('posts to the phone number endpoint with bearer token and returns the message id', async () => {
    const calls: any[] = []
    const send = makeSender({ token: 'T', phoneNumberId: 'PN', fetchFn: (async (url: string, init: any) => {
      calls.push({ url, init }); return new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT' }] }), { status: 200 })
    }) as any })
    expect(await send(textMessage('44', 'x'))).toEqual({ id: 'wamid.OUT', ok: true, status: 200 })
    expect(calls[0].url).toMatch(/\/PN\/messages$/)
    expect(calls[0].init.headers.Authorization).toBe('Bearer T')
  })
  it('reports failures without throwing', async () => {
    const send = makeSender({ token: 'T', phoneNumberId: 'PN', fetchFn: (async () => new Response('{}', { status: 400 })) as any })
    expect(await send(textMessage('44', 'x'))).toEqual({ id: null, ok: false, status: 400 })
  })
})

describe('maskPhone', () => {
  it('keeps country code and last two digits', () => expect(maskPhone('447700900123')).toBe('+44 7••• ••23'))
})

describe('maskId', () => {
  it('Telegram ids are not shown as phone numbers', () => {
    expect(maskId('telegram', '123456789')).toBe('tg:••789')
    expect(maskId('telegram', '12')).toBe('tg:••')
  })
  it('WhatsApp ids use maskPhone', () => expect(maskId('whatsapp', '447700900123')).toBe(maskPhone('447700900123')))
})
