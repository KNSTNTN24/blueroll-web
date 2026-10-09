// src/lib/whatsapp/__tests__/bot.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { handleInbound, TEXT, type BotDeps, type FormToken } from '../../../../supabase/functions/_shared/channels/bot'
import type { Template, TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'

const T: Template = { id: 't1', business_id: 'b', site_id: null, name: 'Fridge temps', frequency: 'daily', deadline_time: '11:00',
  multi_per_day: false, min_per_day: null, assigned_roles: [], assigned_role_ids: ['r'], active: true }
const ITEMS: TemplateItem[] = [
  { id: 'i1', name: 'Walk-in fridge', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C', sort_order: 0 },
  { id: 'i2', name: 'Freezer', item_type: 'temperature', required: true, min_value: -30, max_value: -18, unit: '°C', sort_order: 1 },
]

function fake(over: Partial<BotDeps> = {}) {
  const sent: any[] = []; const tokens = new Map<string, FormToken>(); const state: any = { completions: [], responses: [], notifs: [], corrective: [], revoked: [], logs: [], linkFails: [] }
  let n = 0
  const d: BotDeps = {
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
    flowFor: async () => ({ flow_id: 'F1', item_ids: ['i1', 'i2'] }),
    correctiveFlowId: () => 'FC',
    saveToken: async (t) => { tokens.set(t.token, t) },
    takeToken: async (tok) => { const t = tokens.get(tok); if (!t || t.used_at) return null; t.used_at = 'x'; return t },
    setCorrective: async (rid, notes) => { state.corrective.push({ rid, notes }); return { templateName: 'Fridge temps', itemName: 'Walk-in fridge', value: '9', siteName: 'Wharf Side', byName: 'Anna', businessId: 'b' } },
    managerExternalIds: async () => ['447700900999'],
    log: async (e) => { state.logs.push(e) },
    insertCompletion: async (row) => { state.completions.push({ ...row }); return { id: 'c1' } },
    insertResponses: async (rows) => { state.responses.push(...rows); return rows.map((r, i) => ({ id: 'resp' + i, item_id: r.item_id })) },
    managerIds: async () => ['m1'],
    insertNotifications: async (rows) => { state.notifs.push(...rows) },
    linkFailures: async (x, since) => state.linkFails.filter((f: any) => f.x === x && f.at >= since).length,
    recordLinkFailure: async (x, at) => { state.linkFails.push({ x, at }) },
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
})
