// src/lib/whatsapp/__tests__/bot.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { handleInbound, TEXT, textsFor, type BotDeps, type FormToken } from '../../../../supabase/functions/_shared/channels/bot'
import type { Template, TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'
import { itemsHash } from '../../../../supabase/functions/_shared/channels/whatsapp-flows'
import { whatsappUI, telegramUI } from '../../../../supabase/functions/_shared/channels/ui'
import { parseUpdate } from '../../../../supabase/functions/_shared/channels/telegram'
import { alertManagers, type AlertRecipient } from '../../../../supabase/functions/_shared/channels/alerts'

const T: Template = { id: 't1', business_id: 'b', site_id: null, name: 'Fridge temps', frequency: 'daily', deadline_time: '11:00',
  multi_per_day: false, min_per_day: null, assigned_roles: [], assigned_role_ids: ['r'], active: true }
const ITEMS: TemplateItem[] = [
  { id: 'i1', name: 'Walk-in fridge', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C', sort_order: 0 },
  { id: 'i2', name: 'Freezer', item_type: 'temperature', required: true, min_value: -30, max_value: -18, unit: '°C', sort_order: 1 },
]

type Recipients = () => Promise<(Omit<AlertRecipient, 'channel'> & { channel?: AlertRecipient['channel'] })[]>
function fake(overAll: Partial<BotDeps> & { managerRecipients?: Recipients } = {}) {
  const { managerRecipients = async () => [{ external_id: '447700900999', last_inbound_at: null }], ...over } = overAll
  const sent: any[] = []; const tokens = new Map<string, FormToken>(); const state: any = { completions: [], responses: [], notifs: [], corrective: [], revoked: [], logs: [], linkFails: [] }
  let n = 0
  const d: BotDeps = {
    channel: 'whatsapp',
    ui: whatsappUI(),
    now: () => new Date('2026-10-14T09:40:00Z'),
    send: async (m) => { sent.push(m); return { id: 'w' + sent.length, ok: true, status: 200 } },
    newToken: () => 'tok' + ++n,
    findIdentity: async (x) => (x === '447700900123' ? { id: 'id1', business_id: 'b', profile_id: 'p1', external_id: x } : null),
    touchIdentity: async () => {},
    revokeIdentity: async (id) => { state.revoked.push(id) },
    consumeLinkCode: async (code) => code === '482913' ? { ok: true, identity: { id: 'id1', business_id: 'b', profile_id: 'p1', external_id: '447700900123' }, siteName: 'Wharf Side', name: 'Anna' } : { ok: false },
    ready: async () => true,
    person: async () => ({ profile_id: 'p1', business_id: 'b', full_name: 'Anna', role: 'kitchen_staff', role_id: 'r' }),
    sitesFor: async () => [{ id: 's1', name: 'Wharf Side', timezone: 'Europe/London' }],
    templates: async () => [T],
    items: async () => ITEMS,
    completionsSince: async () => state.completions,
    flowFor: async () => ({ flow_id: 'F1', item_ids: ['i1', 'i2'], items_hash: await itemsHash(T.name, ITEMS) }),
    correctiveFlowId: () => 'FC',
    saveToken: async (t) => { tokens.set(t.token, t) },
    takeToken: async (tok, _now, profileId) => { const t = tokens.get(tok); if (!t || t.used_at || t.profile_id !== profileId) return null; t.used_at = 'x'; return t },
    setCorrective: async (rid, notes) => { state.corrective.push({ rid, notes }); return { templateName: 'Fridge temps', itemName: 'Walk-in fridge', value: '9', unit: '°C', siteName: 'Wharf Side', byName: 'Anna', businessId: 'b' } },
    // Cross-channel alert path with fake AlertDeps; recipients default to WhatsApp; every channel sends via d.send (unwrapped).
    alertManagers: (b, a) => alertManagers({
      managerRecipients: async () => (await managerRecipients()).map((r) => ({ channel: 'whatsapp' as const, ...r })),
      ready: async () => true,
      log: async (e) => { state.logs.push(e) },
    }, { whatsapp: (m) => d.send(m), telegram: (m) => d.send(m) }, b, a, d.now()),
    log: async (e) => {
      if (e.direction === 'in' && e.wa_message_id && state.logs.some((l: any) => l.direction === 'in' && l.wa_message_id === e.wa_message_id)) return false
      state.logs.push(e); return true
    },
    insertCompletion: async (row) => { state.completions.push({ ...row }); return { id: 'c1' } },
    insertResponses: async (rows) => { state.responses.push(...rows); return rows.map((r, i) => ({ id: 'resp' + i, item_id: r.item_id })) },
    managerIds: async () => ['m1'],
    insertNotifications: async (rows) => { state.notifs.push(...rows) },
    linkFailures: async (x, since) => state.linkFails.filter((f: any) => f.x === x && f.at >= since).length,
    recordLinkFailure: async (x, at) => { state.linkFails.push({ x, at }) },
    pendingCorrective: async () => [],
    ...over,
  }
  return { d, sent, tokens, state }
}
const from = '447700900123'
const textOf = (m: any) => m?.text?.body ?? m?.interactive?.body?.text

describe('bot', () => {
  it('links with a valid code and refuses an expired one', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from: '447000000001', text: 'link 482913', id: 'x' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.linked('Anna', 'Wharf Side'))
    await handleInbound({ kind: 'text', from: '447000000001', text: 'LINK 000000', id: 'y' }, f.d)
    expect(textOf(f.sent[1])).toBe(TEXT.linkExpired)
  })
  it('unknown number and unavailable business', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from: '440000', text: 'hi', id: 'x' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.unknown)
    const g = fake({ ready: async () => false })
    await handleInbound({ kind: 'text', from, text: 'checks', id: 'x' }, g.d)
    expect(textOf(g.sent[0])).toBe(TEXT.unavailable)
  })
  it('STOP revokes', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from, text: ' Stop ', id: 'x' }, f.d)
    expect(f.state.revoked).toEqual(['id1'])
    expect(textOf(f.sent[0])).toBe(TEXT.stopped)
  })
  it('CHECKS lists due checklists with fill buttons', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from, text: 'checks', id: 'x' }, f.d)
    expect(f.sent[0].interactive.action.buttons[0].reply.id).toBe('fill:t1:s1')
  })
  it('fill button sends the form with a checklist token', async () => {
    const f = fake()
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    expect(f.sent[0].interactive.action.parameters).toMatchObject({ flow_id: 'F1', flow_token: 'tok1' })
    expect(f.tokens.get('tok1')).toMatchObject({ kind: 'checklist', template_id: 't1', site_id: 's1', item_ids: ['i1', 'i2'] })
  })
  it('two out-of-range items → two corrective forms, completion recorded with source whatsapp', async () => {
    const f = fake()
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: { f0: '9', f1: '-5' }, id: 'y' }, f.d)
    expect(f.state.completions[0]).toMatchObject({ template_id: 't1', site_id: 's1', completed_by: 'p1', source: 'whatsapp' })
    expect(f.state.responses.map((r: any) => r.corrective_status)).toEqual(['needed', 'needed'])
    expect(f.state.notifs).toHaveLength(2)
    const corr = f.sent.filter((m) => m.interactive?.action?.parameters?.flow_id === 'FC')
    expect(corr).toHaveLength(2)
    expect(corr[0].interactive.action.parameters.flow_action_payload.data).toEqual({ item_name: 'Walk-in fridge', value_text: '9 °C (limit 0–5 °C)' })
    const corrTokens = corr.map((m) => f.tokens.get(m.interactive.action.parameters.flow_token)!)
    expect(corrTokens.map((x) => [x.kind, x.response_id])).toEqual([['corrective', 'resp0'], ['corrective', 'resp1']])
    expect(f.state.responses.map((r: any) => r.item_id)).toEqual(['i1', 'i2'])
  })
  it('a used or unknown token is refused', async () => {
    const f = fake()
    await handleInbound({ kind: 'flow', from, token: 'nope', response: {}, id: 'y' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.formExpired)
  })
  it('missing required answers → message and a fresh form', async () => {
    const f = fake()
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: { f0: '3' }, id: 'y' }, f.d)
    expect(f.state.completions).toHaveLength(0)
    expect(textOf(f.sent[1])).toBe(TEXT.missing(['Freezer']))
    expect(f.sent[2].interactive.action.parameters.flow_token).toBe('tok2')
  })
  it('corrective reply closes the response and alerts managers', async () => {
    const f = fake()
    await f.d.saveToken({ token: 'ct', kind: 'corrective', business_id: 'b', profile_id: 'p1', site_id: 's1', template_id: 't1', item_ids: null, response_id: 'resp0', expires_at: '2099-01-01', used_at: null })
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved', details: 'to fridge 2' }, id: 'z' }, f.d)
    expect(f.state.corrective).toEqual([{ rid: 'resp0', notes: 'Moved food to another fridge: to fridge 2' }])
    expect(f.sent[0].template.name).toBe('manager_alert')
    expect(textOf(f.sent[1])).toBe(TEXT.correctiveThanks)
  })
  it('a token of another person is ignored', async () => {
    const f = fake()
    await f.d.saveToken({ token: 'ot', kind: 'checklist', business_id: 'b', profile_id: 'someone-else', site_id: 's1', template_id: 't1', item_ids: ['i1'], response_id: null, expires_at: '2099-01-01', used_at: null })
    await handleInbound({ kind: 'flow', from, token: 'ot', response: { f0: '3' }, id: 'z' }, f.d)
    expect(f.state.completions).toHaveLength(0)
  })
  it('a foreign submit does not burn the owner token', async () => {
    const f = fake()
    await f.d.saveToken({ token: 'ot', kind: 'checklist', business_id: 'b', profile_id: 'someone-else', site_id: 's1', template_id: 't1', item_ids: ['i1'], response_id: null, expires_at: '2099-01-01', used_at: null })
    await handleInbound({ kind: 'flow', from, token: 'ot', response: { f0: '3' }, id: 'z' }, f.d)
    expect(f.tokens.get('ot')!.used_at).toBeNull()
    expect(await f.d.takeToken('ot', f.d.now(), 'someone-else')).toMatchObject({ token: 'ot' })
  })
  it('an already-linked number can re-link with a new code', async () => {
    const seen: string[] = []
    const f = fake()
    const real = f.d.consumeLinkCode
    f.d.consumeLinkCode = async (code, ext, now) => { seen.push(ext); return real(code, ext, now) }
    await handleInbound({ kind: 'text', from, text: 'link 482913', id: 'x' }, f.d)
    expect(seen).toEqual([from])
    expect(textOf(f.sent[0])).toBe(TEXT.linked('Anna', 'Wharf Side'))
  })
  it('STOP then LINK reconnects', async () => {
    let linked = true
    const f = fake({
      findIdentity: async (x) => (linked && x === from ? { id: 'id1', business_id: 'b', profile_id: 'p1', external_id: x } : null),
      revokeIdentity: async () => { linked = false },
    })
    await handleInbound({ kind: 'text', from, text: 'stop', id: 'x' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.stopped)
    await handleInbound({ kind: 'text', from, text: 'checks', id: 'x1' }, f.d)
    expect(textOf(f.sent[1])).toBe(TEXT.unknown)
    await handleInbound({ kind: 'text', from, text: 'LINK 482913', id: 'x2' }, f.d)
    expect(textOf(f.sent[2])).toBe(TEXT.linked('Anna', 'Wharf Side'))
  })
  it('submit is refused if the template was deactivated after the form was sent', async () => {
    let active = true
    const f = fake({ templates: async () => [{ ...T, active }] })
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    active = false
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: { f0: '3', f1: '-20' }, id: 'y' }, f.d)
    expect(f.state.completions).toHaveLength(0)
    expect(textOf(f.sent[1])).toBe(TEXT.formExpired)
  })
  it('submit is refused if the person was unassigned from the template', async () => {
    let roles = ['r']
    const f = fake({ templates: async () => [{ ...T, assigned_role_ids: roles }] })
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    roles = ['other']
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: { f0: '3', f1: '-20' }, id: 'y' }, f.d)
    expect(f.state.completions).toHaveLength(0)
    expect(textOf(f.sent[1])).toBe(TEXT.formExpired)
  })
  it('submit is refused if the person lost access to the site', async () => {
    let sites = [{ id: 's1', name: 'Wharf Side', timezone: 'Europe/London' }]
    const f = fake({ sitesFor: async () => sites })
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    sites = [{ id: 's2', name: 'Other', timezone: 'Europe/London' }]
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: { f0: '3', f1: '-20' }, id: 'y' }, f.d)
    expect(f.state.completions).toHaveLength(0)
    expect(textOf(f.sent[1])).toBe(TEXT.formExpired)
  })
  it('manager alert time uses the site timezone', async () => {
    const f = fake({ sitesFor: async () => [{ id: 's1', name: 'Wharf Side', timezone: 'America/New_York' }] })
    await f.d.saveToken({ token: 'ct', kind: 'corrective', business_id: 'b', profile_id: 'p1', site_id: 's1', template_id: 't1', item_ids: null, response_id: 'resp0', expires_at: '2099-01-01', used_at: null })
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved' }, id: 'z' }, f.d)
    // 09:40Z = 05:40 in New York (EDT)
    expect(f.sent[0].template.components[0].parameters[3].text).toBe('05:40')
  })
  it('a failed LINK code records a failure', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from: '447000000001', text: 'link 000000', id: 'y' }, f.d)
    expect(f.state.linkFails).toHaveLength(1)
    expect(f.state.linkFails[0].x).toBe('447000000001')
  })
  it('5 failed LINK attempts in an hour → 6th attempt with a valid code is refused', async () => {
    let consumed = 0
    const f = fake()
    const real = f.d.consumeLinkCode
    f.d.consumeLinkCode = async (...a) => { consumed++; return real(...a) }
    for (let i = 0; i < 5; i++) await handleInbound({ kind: 'text', from: '447000000001', text: 'link 00000' + i, id: 'y' + i }, f.d)
    expect(consumed).toBe(5)
    await handleInbound({ kind: 'text', from: '447000000001', text: 'link 482913', id: 'z' }, f.d)
    expect(consumed).toBe(5)
    expect(textOf(f.sent[5])).toBe(TEXT.linkExpired)
  })
  it('old LINK failures (over an hour ago) do not count', async () => {
    const f = fake()
    for (let i = 0; i < 5; i++) f.state.linkFails.push({ x: '447000000001', at: new Date('2026-10-14T08:00:00Z') })
    await handleInbound({ kind: 'text', from: '447000000001', text: 'link 482913', id: 'z' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.linked('Anna', 'Wharf Side'))
  })
  it('the link-failure counter is not consulted for non-LINK messages', async () => {
    let asked = 0
    const f = fake({ linkFailures: async () => { asked++; return 99 } })
    await handleInbound({ kind: 'text', from, text: 'checks', id: 'x' }, f.d)
    await handleInbound({ kind: 'text', from, text: 'help', id: 'x2' }, f.d)
    await handleInbound({ kind: 'button', from, payload: 'checks', id: 'x3' }, f.d)
    expect(asked).toBe(0)
    expect(textOf(f.sent[1])).toBe(TEXT.help)
  })
  it('CHECKS re-sends a corrective Flow for each pending out-of-range answer before the due list', async () => {
    const f = fake({ pendingCorrective: async () => [
      { response_id: 'r9', item: ITEMS[0], value: '9', site_id: 's1', template_id: 't1' },
    ] })
    await handleInbound({ kind: 'text', from, text: 'checks', id: 'x' }, f.d)
    expect(f.sent[0].interactive.action.parameters).toMatchObject({ flow_id: 'FC', flow_token: 'tok1' })
    expect(f.sent[0].interactive.action.parameters.flow_action_payload.data).toEqual({ item_name: 'Walk-in fridge', value_text: '9 °C (limit 0–5 °C)' })
    expect(f.tokens.get('tok1')).toMatchObject({ kind: 'corrective', response_id: 'r9', site_id: 's1', template_id: 't1', profile_id: 'p1' })
    expect(f.sent[1].interactive.action.buttons[0].reply.id).toBe('fill:t1:s1')
  })
  it('pending corrective Flows are capped at 3 and skip sites the person no longer has', async () => {
    const mk = (i: number, site = 's1') => ({ response_id: 'r' + i, item: ITEMS[0], value: '9', site_id: site, template_id: 't1' })
    const f = fake({ pendingCorrective: async () => [mk(0, 'gone'), mk(1), mk(2), mk(3), mk(4)] })
    await handleInbound({ kind: 'text', from, text: 'checks', id: 'x' }, f.d)
    const corr = f.sent.filter((m) => m.interactive?.action?.parameters?.flow_id === 'FC')
    expect(corr.map((m) => f.tokens.get(m.interactive.action.parameters.flow_token)!.response_id)).toEqual(['r1', 'r2', 'r3'])
  })
  it('manager alerts are billable only outside the manager 24h window', async () => {
    const f = fake({ managerRecipients: async () => [
      { external_id: '447700900901', last_inbound_at: '2026-10-14T01:00:00Z' },   // 8h40m ago → free
      { external_id: '447700900902', last_inbound_at: '2026-10-13T09:00:00Z' },   // >24h ago → billable
      { external_id: '447700900903', last_inbound_at: null },                     // never wrote → billable
    ] })
    await f.d.saveToken({ token: 'ct', kind: 'corrective', business_id: 'b', profile_id: 'p1', site_id: 's1', template_id: 't1', item_ids: null, response_id: 'resp0', expires_at: '2099-01-01', used_at: null })
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved' }, id: 'z' }, f.d)
    const alerts = f.state.logs.filter((l: any) => l.kind === 'alert')
    expect(alerts.map((l: any) => l.billable)).toEqual([false, true, true])
    expect(f.sent.slice(0, 3).map((m: any) => m.to)).toEqual(['447700900901', '447700900902', '447700900903'])
  })
  it('item ids churned by an editor save (same form shape) → form goes out with the CURRENT ids', async () => {
    const NEW = ITEMS.map((i, k) => ({ ...i, id: 'n' + (k + 1), sort_order: 10 + k }))
    const f = fake({ items: async () => NEW })
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    expect(f.sent[0].interactive.action.parameters).toMatchObject({ flow_id: 'F1', flow_token: 'tok1' })
    expect(f.tokens.get('tok1')!.item_ids).toEqual(['n1', 'n2'])
  })
  it('form shape changed since the flow was published → app-only reply, no stale form', async () => {
    const f = fake({ items: async () => [...ITEMS, { id: 'i3', name: 'Door shut', item_type: 'yes_no', required: true, min_value: null, max_value: null, unit: null, sort_order: 2 }] })
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.appOnly('Fridge temps'))
    expect(f.tokens.size).toBe(0)
  })
  it('submit after the items were re-created → nothing recorded, "checklist changed" and a fresh form', async () => {
    let items = ITEMS
    const f = fake({ items: async () => items })
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    items = ITEMS.map((i, k) => ({ ...i, id: 'n' + (k + 1) }))
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: { f0: '3', f1: '-20' }, id: 'y' }, f.d)
    expect(f.state.completions).toHaveLength(0)
    expect(f.state.responses).toHaveLength(0)
    expect(textOf(f.sent[1])).toBe(TEXT.checklistChanged)
    expect(f.sent[2].interactive.action.parameters.flow_token).toBe('tok2')
    expect(f.tokens.get('tok2')!.item_ids).toEqual(['n1', 'n2'])
  })
  it('submit with no usable answers while the token has required items → nothing recorded, "missing" and a fresh form', async () => {
    const f = fake()
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: {}, id: 'y' }, f.d)
    expect(f.state.completions).toHaveLength(0)
    expect(textOf(f.sent[1])).toBe(TEXT.missing(['Walk-in fridge', 'Freezer']))
    expect(f.sent[2].interactive.action.parameters.flow_token).toBe('tok2')
  })
  it('all-optional ticks submitted blank → completion recorded, no re-send', async () => {
    const OPT: TemplateItem[] = [
      { id: 'o1', name: 'Bins emptied', item_type: 'tick', required: false, min_value: null, max_value: null, unit: null, sort_order: 0 },
      { id: 'o2', name: 'Floor mopped', item_type: 'tick', required: false, min_value: null, max_value: null, unit: null, sort_order: 1 },
    ]
    const f = fake({ items: async () => OPT, flowFor: async () => ({ flow_id: 'F1', item_ids: ['o1', 'o2'], items_hash: await itemsHash(T.name, OPT) }) })
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: {}, id: 'y' }, f.d)
    expect(f.state.completions).toHaveLength(1)
    expect(f.state.responses).toHaveLength(0)
    expect(f.sent).toHaveLength(1)
  })
  it('STOP and HELP work even when the business is not ready', async () => {
    const f = fake({ ready: async () => false })
    await handleInbound({ kind: 'text', from, text: 'help', id: 'x' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.help)
    await handleInbound({ kind: 'text', from, text: 'STOP', id: 'x2' }, f.d)
    expect(f.state.revoked).toEqual(['id1'])
    expect(textOf(f.sent[1])).toBe(TEXT.stopped)
  })
  it('the same inbound message delivered twice is handled once', async () => {
    const f = fake()
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'wamid.DUP' }, f.d)
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'wamid.DUP' }, f.d)
    expect(f.sent).toHaveLength(1)
    expect(f.tokens.size).toBe(1)
    expect(f.state.logs.filter((l: any) => l.direction === 'in')).toHaveLength(1)
  })
  it('a duplicate flow submission records the completion once', async () => {
    const f = fake()
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: { f0: '3', f1: '-20' }, id: 'wamid.F' }, f.d)
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: { f0: '3', f1: '-20' }, id: 'wamid.F' }, f.d)
    expect(f.state.completions).toHaveLength(1)
    expect(f.sent).toHaveLength(1)   // no "form expired" reply to the duplicate
  })
  it('no corrective Flow configured → completion still recorded, corrective forms skipped', async () => {
    const f = fake({ correctiveFlowId: () => '' })
    await handleInbound({ kind: 'button', from, payload: 'fill:t1:s1', id: 'x' }, f.d)
    await handleInbound({ kind: 'flow', from, token: 'tok1', response: { f0: '9', f1: '-5' }, id: 'y' }, f.d)
    expect(f.state.completions).toHaveLength(1)
    expect(f.state.notifs).toHaveLength(2)
    expect(f.sent.filter((m) => m.interactive?.type === 'flow' && m.interactive.action.parameters.flow_id !== 'F1')).toHaveLength(0)
  })
  it('corrective alert reaches a Telegram manager as text and a WhatsApp manager as the template', async () => {
    const f = fake({ managerRecipients: async () => [
      { channel: 'telegram', external_id: '555', last_inbound_at: null },
      { channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null },
    ] })
    await f.d.saveToken({ token: 'ct', kind: 'corrective', business_id: 'b', profile_id: 'p1', site_id: 's1', template_id: 't1', item_ids: null, response_id: 'resp0', expires_at: '2099-01-01', used_at: null })
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved' }, id: 'z' }, f.d)
    expect(f.sent[0]).toEqual({ chat_id: '555', text: '⚠ Wharf Side · Walk-in fridge 9 °C at 10:40 (Anna). Action: Moved food to another fridge. — via Blueroll' })
    expect(f.sent[1]).toMatchObject({ to: '447700900999', template: { name: 'manager_alert' } })
    expect(textOf(f.sent[2])).toBe(TEXT.correctiveThanks)
    expect(f.state.logs.filter((l: any) => l.kind === 'alert').map((l: any) => [l.channel, l.billable])).toEqual([['telegram', false], ['whatsapp', true]])
  })
  it('manager alert value carries the unit', async () => {
    const f = fake()
    await f.d.saveToken({ token: 'ct', kind: 'corrective', business_id: 'b', profile_id: 'p1', site_id: 's1', template_id: 't1', item_ids: null, response_id: 'resp0', expires_at: '2099-01-01', used_at: null })
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved' }, id: 'z' }, f.d)
    expect(f.sent[0].template.components[0].parameters[2].text).toBe('9 °C')
  })
  it('CHECKS loads completions only from the earliest period start it needs', async () => {
    const seen: Date[] = []
    const f = fake({ completionsSince: async (_b, since) => { seen.push(since); return [] } })
    await handleInbound({ kind: 'text', from, text: 'checks', id: 'x' }, f.d)
    expect(seen.map((x) => x.toISOString())).toEqual(['2026-10-13T23:00:00.000Z'])
  })
})

describe('bot on Telegram', () => {
  const tgFrom = '123456789'
  const tgUi = telegramUI('https://app.blueroll.app/tg/form')
  const X = textsFor(tgUi)
  const PHOTO_OPT: TemplateItem = { id: 'i3', name: 'Label photo', item_type: 'photo', required: false, min_value: null, max_value: null, unit: null, sort_order: 2 }
  const INITIALS: TemplateItem = { id: 'i4', name: 'Initials', item_type: 'initials', required: false, min_value: null, max_value: null, unit: null, sort_order: 3 }
  const tg = (over: Partial<BotDeps> = {}) => {
    let flowAsked = 0
    const f = fake({
      channel: 'telegram', ui: tgUi,
      findIdentity: async (x) => (x === tgFrom ? { id: 'tg1', business_id: 'b', profile_id: 'p1', external_id: x } : null),
      consumeLinkCode: async (code, ext) => code === '482913' ? { ok: true, identity: { id: 'tg1', business_id: 'b', profile_id: 'p1', external_id: ext }, siteName: 'Wharf Side', name: 'Anna' } : { ok: false },
      flowFor: async () => { flowAsked++; return null },
      ...over,
    })
    return { ...f, flowAsked: () => flowAsked }
  }

  it('Telegram copy uses slash commands; WhatsApp copy is unchanged', () => {
    expect(X.linked('Anna', 'Wharf Side')).toBe("Hi Anna 👋 You're connected to Wharf Side. I'll remind you before your checks are due. Send /stop anytime.")
    expect(X.help).toBe('Blueroll checks: tap Fill in on a reminder, or type /checks to see what is due. Type /stop to disconnect.')
    expect(X.fallback).toBe('I can help with your checks — tap Fill in or type /checks.')
    expect(X.formExpired).toBe('This form has expired — type /checks to get a new one.')
    expect(TEXT.linked('Anna', 'Wharf Side')).toBe("Hi Anna 👋 You're connected to Wharf Side. I'll remind you before your checks are due. Reply STOP anytime.")
    expect(TEXT.help).toBe('Blueroll checks: tap Fill in on a reminder, or type CHECKS to see what is due. Type STOP to disconnect.')
    expect(textsFor(whatsappUI())).toEqual(expect.objectContaining({ help: TEXT.help, fallback: TEXT.fallback, formExpired: TEXT.formExpired }))
  })
  it('LINK via /start deep link', async () => {
    const f = tg()
    const [ev] = parseUpdate({ update_id: 7, message: { message_id: 1, chat: { id: 555, type: 'private' }, from: { id: 555, is_bot: false }, text: '/start 482913' } })
    await handleInbound(ev, f.d)
    expect(f.sent[0]).toEqual({ chat_id: '555', text: X.linked('Anna', 'Wharf Side') })
  })
  it('/help and unknown text reply in Telegram copy', async () => {
    const f = tg()
    await handleInbound({ kind: 'text', from: tgFrom, text: 'help', id: '1' }, f.d)
    await handleInbound({ kind: 'text', from: tgFrom, text: 'hello', id: '2' }, f.d)
    expect(f.sent.map((m) => m.text)).toEqual([X.help, X.fallback])
  })
  it('/stop revokes with the Telegram reply', async () => {
    const f = tg()
    await handleInbound({ kind: 'text', from: tgFrom, text: 'stop', id: '1' }, f.d)
    expect(f.state.revoked).toEqual(['tg1'])
    expect(f.sent[0]).toEqual({ chat_id: tgFrom, text: X.stopped })
  })
  it('checks → inline choices with fill: ids', async () => {
    const f = tg()
    await handleInbound({ kind: 'text', from: tgFrom, text: 'checks', id: '1' }, f.d)
    expect(f.sent[0]).toEqual({ chat_id: tgFrom, text: X.dueList('Wharf Side'),
      reply_markup: { inline_keyboard: [[{ text: 'Fridge temps', callback_data: 'fill:t1:s1' }]] } })
  })
  it('fill: → web_app form with a checklist token of the supported items; answers the callback', async () => {
    const f = tg({ items: async () => [...ITEMS, PHOTO_OPT, INITIALS] })
    await handleInbound({ kind: 'button', from: tgFrom, payload: 'fill:t1:s1', id: '9', callbackId: 'cb1' }, f.d)
    expect(f.flowAsked()).toBe(0)
    expect(f.tokens.get('tok1')).toMatchObject({ kind: 'checklist', template_id: 't1', site_id: 's1', profile_id: 'p1', item_ids: ['i1', 'i2'] })
    expect(f.sent).toEqual([{ chat_id: tgFrom, text: 'Fridge temps', callback_query_id: 'cb1',
      reply_markup: { inline_keyboard: [[{ text: 'Fill in', web_app: { url: 'https://app.blueroll.app/tg/form?t=tok1' } }]] } }])
  })
  it('only the first reply to a callback carries callback_query_id', async () => {
    const f = tg({ pendingCorrective: async () => [] })
    await handleInbound({ kind: 'button', from: tgFrom, payload: 'checks', id: '9', callbackId: 'cb2' }, f.d)
    expect(f.sent[0].callback_query_id).toBe('cb2')
    const g = tg()
    await handleInbound({ kind: 'text', from: tgFrom, text: 'checks', id: '10' }, g.d)
    expect(g.sent[0].callback_query_id).toBeUndefined()
  })
  it('required photo → app-only text, no token', async () => {
    const f = tg({ items: async () => [...ITEMS, { ...PHOTO_OPT, required: true }] })
    await handleInbound({ kind: 'button', from: tgFrom, payload: 'fill:t1:s1', id: '9' }, f.d)
    expect(f.sent[0]).toEqual({ chat_id: tgFrom, text: X.appOnly('Fridge temps') })
    expect(f.tokens.size).toBe(0)
  })
  it('pending correctives are not re-sent as Flows on Telegram', async () => {
    const f = tg({ pendingCorrective: async () => [{ response_id: 'r9', item: ITEMS[0], value: '9', site_id: 's1', template_id: 't1' }] })
    await handleInbound({ kind: 'text', from: tgFrom, text: 'checks', id: '1' }, f.d)
    expect(f.tokens.size).toBe(0)
    expect(f.sent).toHaveLength(1)
    expect(f.sent[0].reply_markup.inline_keyboard[0][0].callback_data).toBe('fill:t1:s1')
  })
  it('unknown Telegram user → Telegram text', async () => {
    const f = tg()
    await handleInbound({ kind: 'text', from: '999', text: 'hi', id: '1' }, f.d)
    expect(f.sent[0]).toEqual({ chat_id: '999', text: X.unknown })
  })
})
