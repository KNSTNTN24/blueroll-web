import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import text from './fixtures/text.json'
import button from './fixtures/button.json'
import flow from './fixtures/flow.json'
import status from './fixtures/status.json'
import { verifySignature, parseInbound, textMessage, buttonsMessage, listMessage, templateMessage, flowMessage, makeSender, normalisePhone, parseStatuses } from '../../../../supabase/functions/_shared/channels/whatsapp'
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
  it('list reply (menu row) → button event with the row id', () => {
    const wrap = (m: unknown) => ({ entry: [{ changes: [{ value: { messages: [m] } }] }] })
    expect(parseInbound(wrap({ from: '447700900123', id: 'w', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'fill:t1:s1', title: 'Fridge' } } })))
      .toEqual([{ kind: 'button', from: '447700900123', payload: 'fill:t1:s1', id: 'w' }])
    expect(parseInbound(wrap({ from: '447700900123', id: 'w', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: '' } } }))).toEqual([])
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
  it('list message', () => {
    const m = listMessage('44', { header: 'H', body: 'B', footer: 'F', button: 'Choose a check', rows: [{ id: 'fill:a:s', title: 'A', description: 'Due 10:00' }] }) as any
    expect(m.interactive).toEqual({ type: 'list', header: { type: 'text', text: 'H' }, body: { text: 'B' }, footer: { text: 'F' },
      action: { button: 'Choose a check', sections: [{ title: 'Open checks', rows: [{ id: 'fill:a:s', title: 'A', description: 'Due 10:00' }] }] } })
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
  it('aborts a hanging Meta call after the timeout: a transient failure (status 0, no error code)', async () => {
    const send = makeSender({ token: 'T', phoneNumberId: 'PN', timeoutMs: 20, fetchFn: ((_url: string, init: any) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(init.signal.reason))
    })) as any })
    expect(await send(textMessage('44', 'x'))).toEqual({ id: null, ok: false, status: 0 })
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

describe('normalisePhone', () => {
  it.each([
    ['+44 7700 900123', '447700900123'],
    ['447700900123', '447700900123'],
    ['0044 7700 900123', '447700900123'],
    ['07700 900123', '447700900123'],
    ['+44 (0)7700 900123', '447700900123'],
    ['+1 (415) 555-0100', '14155550100'],
  ])('%s → %s', (raw, want) => expect(normalisePhone(raw)).toBe(want))
  it.each(['', '12345', 'abc', '+44 7700 900123 ext 4', '+4477009001234567'])('rejects %j', (raw) => expect(normalisePhone(raw)).toBeNull())
})

describe('parseInbound — shared contact', () => {
  const wrap = (m: unknown) => ({ entry: [{ changes: [{ value: { messages: [m] } }] }] })
  it('first contact with a number; wa_id preferred; name from formatted_name', () => {
    expect(parseInbound(wrap({ from: '447700900001', id: 'wamid.C1', type: 'contacts', contacts: [
      { name: { formatted_name: 'No Phone' }, phones: [] },
      { name: { formatted_name: 'Maria  Lopez', first_name: 'Maria' }, phones: [{ phone: '+44 7700 900777', wa_id: '447700900777', type: 'CELL' }] },
      { name: { formatted_name: 'Second' }, phones: [{ wa_id: '447700900888' }] },
    ] }))).toEqual([{ kind: 'contact', from: '447700900001', name: 'Maria Lopez', phone: '447700900777', id: 'wamid.C1' }])
  })
  it('falls back to the phone field and first/last name; no usable number → nothing', () => {
    expect(parseInbound(wrap({ from: '447700900001', id: 'wamid.C2', type: 'contacts', contacts: [
      { name: { first_name: 'Ben', last_name: 'Jones' }, phones: [{ phone: '07700 900456' }] },
    ] }))).toEqual([{ kind: 'contact', from: '447700900001', name: 'Ben Jones', phone: '447700900456', id: 'wamid.C2' }])
    expect(parseInbound(wrap({ from: '447700900001', id: 'wamid.C3', type: 'contacts', contacts: [{ name: { formatted_name: 'X' }, phones: [{ phone: 'n/a' }] }] }))).toEqual([])
  })
})

describe('parseStatuses', () => {
  it('reads delivery statuses with the first error code; junk is skipped', () => {
    const body = { entry: [{ changes: [{ value: { statuses: [
      { id: 'wamid.A', status: 'delivered', recipient_id: '447700900123' },
      { id: 'wamid.B', status: 'failed', recipient_id: '447700900456', errors: [{ code: 131026, title: 'Message undeliverable' }] },
      { id: 'wamid.D', status: 'failed', recipient_id: '447700900789', errors: [{ code: 131049, title: 'Ecosystem engagement', error_data: { details: 'Marketing limit' } }] },
      { id: 'wamid.C', status: 'failed', recipient_id: 'not-a-number' },
    ] } }] }] }
    expect(parseStatuses(body)).toEqual([
      { id: 'wamid.A', recipient: '447700900123', status: 'delivered', errorCode: null, errorTitle: null },
      { id: 'wamid.B', recipient: '447700900456', status: 'failed', errorCode: 131026, errorTitle: 'Message undeliverable' },
      { id: 'wamid.D', recipient: '447700900789', status: 'failed', errorCode: 131049, errorTitle: 'Ecosystem engagement: Marketing limit' },
    ])
    expect(parseStatuses(status)).toEqual([{ id: 'wamid.X', recipient: '447700900123', status: 'delivered', errorCode: null, errorTitle: null }])
    expect(parseStatuses(null)).toEqual([])
    expect(parseStatuses({ entry: [{ changes: [{ value: { statuses: 5 } }] }] })).toEqual([])
  })
})

describe('makeSender — Meta error code', () => {
  it('returns error.code on failure (and no errorCode when Meta gives none)', async () => {
    const send = makeSender({ token: 'T', phoneNumberId: 'PN', fetchFn: (async () =>
      new Response(JSON.stringify({ error: { code: 132001, message: 'Template name does not exist in the translation' } }), { status: 404 })) as any })
    expect(await send(textMessage('44', 'x'))).toEqual({ id: null, ok: false, status: 404, errorCode: 132001 })
  })
})

describe('listMessage section', () => {
  it('defaults to "Open checks" and accepts another section title', () => {
    const base = { header: 'H', body: 'B', footer: 'F', button: 'Go', rows: [{ id: 'r', title: 'T', description: 'D' }] }
    expect((listMessage('44', base) as any).interactive.action.sections[0].title).toBe('Open checks')
    expect((listMessage('44', { ...base, section: 'Teams' }) as any).interactive.action.sections[0].title).toBe('Teams')
  })
})
