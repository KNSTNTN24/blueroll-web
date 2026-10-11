// src/lib/whatsapp/__tests__/form-api.test.ts
import { describe, it, expect } from 'vitest'
import { handleFormGet, handleFormPost, consentText, type FormApiDeps } from '../../../../supabase/functions/_shared/channels/form-api'
import { CORRECTIVE_ACTIONS } from '../../../../supabase/functions/_shared/channels/whatsapp-flows'
import type { GroupFormToken } from '../../../../supabase/functions/_shared/channels/groups-db'
import type { TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'
import { fakeGroupDeps, fakeTgApi, groupRow, GROUP, NOW, tpl } from './fakes/group-deps'

const T = tpl({ id: 't1', name: 'Fridge temps', deadline_time: '11:00' })
const T2 = tpl({ id: 't2', name: 'Cleaning' })
const ITEMS: TemplateItem[] = [
  { id: 'i1', name: 'Walk-in fridge', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C', sort_order: 0 },
  { id: 'i2', name: 'Door seals OK', item_type: 'yes_no', required: true, min_value: null, max_value: null, unit: null, sort_order: 1 },
  { id: 'i3', name: 'Notes', item_type: 'text', required: false, min_value: null, max_value: null, unit: null, sort_order: 2 },
  { id: 'i4', name: 'Photo', item_type: 'photo', required: false, min_value: null, max_value: null, unit: null, sort_order: 3 },
]
const tok = (o: Partial<GroupFormToken> = {}): GroupFormToken => ({
  token: 'tokA', kind: 'group_checklist', business_id: 'b', group_id: 'g1', site_id: 's1', template_id: 't1',
  item_ids: ['i1', 'i2', 'i3'], expires_at: '2026-10-15T09:00:00Z', used_at: null, used_by_name: null, ...o,
})
// Telegram users: 111 Anna Smith (member), 222 Ben (member), 333 Eve (left), 444 restricted non-member, 555 restricted member, 999 → API down
const USERS: Record<string, { userId: string; firstName: string; lastName: string }> = {
  anna: { userId: '111', firstName: 'Anna', lastName: 'Smith' }, ben: { userId: '222', firstName: 'Ben', lastName: '' },
  eve: { userId: '333', firstName: 'Eve', lastName: '' }, rex: { userId: '444', firstName: 'Rex', lastName: '' },
  ria: { userId: '555', firstName: 'Ria', lastName: '' }, dan: { userId: '999', firstName: 'Dan', lastName: '' },
}
const memberApi = (left: Set<string> = new Set(['333'])) => fakeTgApi((m, body) => {
  if (m !== 'getChatMember') return undefined
  const u = String(body.user_id)
  if (u === '999') return { ok: false, status: 0, description: 'network', result: null }
  if (u === '444') return { result: { status: 'restricted', is_member: false } }
  if (u === '555') return { result: { status: 'restricted', is_member: true } }
  return { result: { status: left.has(u) ? 'left' : 'member' } }
})

function setup(init: Parameters<typeof fakeGroupDeps>[0] = {}, api = memberApi()) {
  const f = fakeGroupDeps({
    templates: [T, T2], mappings: [{ group_id: 'g1', template_id: 't1' }, { group_id: 'g1', template_id: 't2' }],
    items: { t1: ITEMS }, tokens: [tok(), tok({ token: 'tokB', template_id: 't2', item_ids: ['i1'] })], ...init,
  })
  const waAlerts: any[] = []
  const d: FormApiDeps = {
    g: f.d, api: api.api,
    verifyInitData: async (s) => USERS[s] ?? null,
    alertManagers: async (b, a) => { waAlerts.push({ b, ...a }) },
  }
  return { d, s: f.s, calls: api.calls, waAlerts }
}
const ok = { t: 'tokA', answers: { i1: '3', i2: 'yes' }, corrective: {} }
const sends = (calls: { method: string; body: any }[]) => calls.filter((c) => c.method === 'sendMessage').map((c) => [c.body.chat_id, c.body.text])

describe('GET', () => {
  it('a group member gets the form; first time in this business → consent notice; GET never consumes', async () => {
    const { d, s, calls } = setup()
    const r = await handleFormGet(d, 'tokA', 'anna')
    expect(r).toEqual({ status: 200, body: {
      templateName: 'Fridge temps', siteName: 'Wharf Side',
      items: [
        { id: 'i1', name: 'Walk-in fridge', type: 'temperature', required: true, min: 0, max: 5, unit: '°C' },
        { id: 'i2', name: 'Door seals OK', type: 'yes_no', required: true, min: null, max: null, unit: null },
        { id: 'i3', name: 'Notes', type: 'text', required: false, min: null, max: null, unit: null },
      ],
      correctiveActions: CORRECTIVE_ACTIONS,
      consent: "Your name will be recorded with checks in Fern & Fig's food safety records.",
    } })
    expect(consentText('Fern & Fig')).toBe("Your name will be recorded with checks in Fern & Fig's food safety records.")
    expect(calls).toEqual([{ method: 'getChatMember', body: { chat_id: '-1001', user_id: 111 } }])
    expect(s.tokens[0].used_at).toBeNull()
  })
  it('known person in this business → no consent notice', async () => {
    const { d } = setup({ identities: [{ business_id: 'b', tg_user_id: '111', profile_id: 'p1' }], people: [{ profile_id: 'p1', business_id: 'b', full_name: 'Anna Smith', role: 'kitchen_staff', role_id: 'r' }] })
    expect(((await handleFormGet(d, 'tokA', 'anna')).body as any).consent).toBeNull()
  })
  it('invalid initData → 401', async () => expect(await handleFormGet(setup().d, 'tokA', 'forged')).toEqual({ status: 401, body: { error: 'unauthorized' } }))
  it('left / restricted non-member → 403 not_member; restricted member → 200; Telegram down → 503', async () => {
    const { d } = setup()
    expect(await handleFormGet(d, 'tokA', 'eve')).toEqual({ status: 403, body: { error: 'not_member' } })
    expect(await handleFormGet(d, 'tokA', 'rex')).toEqual({ status: 403, body: { error: 'not_member' } })
    expect((await handleFormGet(d, 'tokA', 'ria')).status).toBe(200)
    expect(await handleFormGet(d, 'tokA', 'dan')).toEqual({ status: 503, body: { error: 'retry_later' } })
  })
  it('unknown, expired or old personal token → 410 expired', async () => {
    const { d } = setup({ tokens: [tok({ expires_at: '2026-10-14T09:00:00Z' })] })
    expect(await handleFormGet(d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'expired' } })
    expect(await handleFormGet(d, 'nope', 'anna')).toEqual({ status: 410, body: { error: 'expired' } })
    expect(await handleFormGet(d, 'bad token!', 'anna')).toEqual({ status: 410, body: { error: 'expired' } })
    // A personal reminder token (kind 'checklist') is invisible to peekGroupToken → expired, never a 500 — GET and POST.
    const personal = setup({ tokens: [tok({ token: 'oldPersonalTok', kind: 'checklist' as any })] })
    expect(await handleFormGet(personal.d, 'oldPersonalTok', 'anna')).toEqual({ status: 410, body: { error: 'expired' } })
    expect(await handleFormPost(personal.d, { ...ok, t: 'oldPersonalTok' }, 'anna')).toEqual({ status: 410, body: { error: 'expired' } })
    expect(personal.s.tokens[0].used_at).toBeNull()
    expect(personal.calls).toEqual([])
  })
  it('group unlinked or checklist no longer mapped → 410 moved', async () => {
    const unlinked = setup({ groups: [groupRow(GROUP, { unlinked_at: '2026-10-14T09:00:00Z' })] })
    expect(await handleFormGet(unlinked.d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'moved' } })
    const unmapped = setup({ mappings: [{ group_id: 'g1', template_id: 't2' }] })
    expect(await handleFormGet(unmapped.d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'moved' } })
    const otherSite = setup({ templates: [{ ...T, site_id: 's2' }, T2] })
    expect(await handleFormGet(otherSite.d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'moved' } })
  })
  it('business mismatches → 410 moved: token of another business than its group; mapped template of another business', async () => {
    const tokOther = setup({ tokens: [tok({ business_id: 'b2' })] })
    expect(await handleFormGet(tokOther.d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'moved' } })
    expect(tokOther.calls).toEqual([])   // refused before the membership call
    const tplOther = setup({ templates: [{ ...T, business_id: 'b2' }, T2] })
    expect(await handleFormGet(tplOther.d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'moved' } })
    expect(await handleFormPost(tplOther.d, ok, 'anna')).toEqual({ status: 410, body: { error: 'moved' } })
    expect(tplOther.s.tokens[0].used_at).toBeNull()
    expect(tplOther.s.completionRows).toEqual([])
  })
  it('team not ready → 403 unavailable; items re-created → 410 changed', async () => {
    expect(await handleFormGet(setup({ ready: { b: false } }).d, 'tokA', 'anna')).toEqual({ status: 403, body: { error: 'unavailable' } })
    const changed = setup({ items: { t1: ITEMS.map((i) => ({ ...i, id: i.id + 'x' })) } })
    expect(await handleFormGet(changed.d, 'tokA', 'anna')).toEqual({ status: 410, body: { error: 'changed' } })
  })
})

describe('POST', () => {
  it('new person: profile + identity created, completion recorded as telegram, managers told, no "Recorded" chat message', async () => {
    const { d, s, calls } = setup()
    expect(await handleFormPost(d, ok, 'anna')).toEqual({ status: 200, body: { ok: true } })
    expect(s.created).toEqual([{ businessId: 'b', siteId: 's1', tgUserId: '111', displayName: 'Anna S.' }])
    expect(s.completionRows).toEqual([expect.objectContaining({ template_id: 't1', site_id: 's1', completed_by: 'new1', source: 'telegram' })])
    expect(s.responses.map((r) => [r.item_id, r.value, r.flagged])).toEqual([['i1', '3', false], ['i2', 'yes', false]])
    expect(s.notifications).toEqual([expect.objectContaining({ user_id: 'm1', type: 'team', title: 'New person in Telegram checks', link: '/team' })])
    expect(s.tokens[0]).toMatchObject({ used_by_name: 'Anna' })
    expect(sends(calls)).toEqual([])
  })
  it('first submit wins: the second person gets "used" with the winner\'s first name (GET and POST)', async () => {
    const { d, s } = setup()
    await handleFormPost(d, ok, 'anna')
    expect(await handleFormPost(d, ok, 'ben')).toEqual({ status: 410, body: { error: 'used', by: 'Anna' } })
    expect(await handleFormGet(d, 'tokA', 'ben')).toEqual({ status: 410, body: { error: 'used', by: 'Anna' } })
    expect(s.completionRows).toHaveLength(1)
  })
  it('lost the race after the peek → used with the winner\'s name', async () => {
    const { d, s } = setup()
    const take = d.g.takeGroupToken
    d.g.takeGroupToken = async (t, now) => { await take(t, now, 'Ben'); return null }
    expect(await handleFormPost(d, ok, 'anna')).toEqual({ status: 410, body: { error: 'used', by: 'Ben' } })
    expect(s.completionRows).toEqual([])
  })
  it('existing identity is reused: no new profile, no new-person notification', async () => {
    const { d, s } = setup({ identities: [{ business_id: 'b', tg_user_id: '111', profile_id: 'p1' }], people: [{ profile_id: 'p1', business_id: 'b', full_name: 'Anna Smith', role: 'kitchen_staff', role_id: 'r' }] })
    expect((await handleFormPost(d, ok, 'anna')).status).toBe(200)
    expect(s.created).toEqual([])
    expect(s.completionRows[0].completed_by).toBe('p1')
    expect(s.notifications).toEqual([])
  })
  it('a person known in another business gets a new profile in this one', async () => {
    const { d, s } = setup({ identities: [{ business_id: 'b2', tg_user_id: '111', profile_id: 'px' }], people: [{ profile_id: 'px', business_id: 'b2', full_name: 'Anna Smith', role: 'kitchen_staff', role_id: 'r' }] })
    expect((await handleFormPost(d, ok, 'anna')).status).toBe(200)
    expect(s.created).toEqual([{ businessId: 'b', siteId: 's1', tgUserId: '111', displayName: 'Anna S.' }])
  })
  it('the same new person submitting two checks gets one profile; consent notice only the first time', async () => {
    const { d, s } = setup()
    await handleFormPost(d, ok, 'anna')
    expect(((await handleFormGet(d, 'tokB', 'anna')).body as any).consent).toBeNull()
    expect((await handleFormPost(d, { t: 'tokB', answers: { i1: '4' }, corrective: {} }, 'anna')).status).toBe(200)
    expect(s.created).toHaveLength(1)
    expect(s.completionRows.map((c) => c.completed_by)).toEqual(['new1', 'new1'])
  })
  it('removed from the group between opening and submitting → 403, nothing recorded', async () => {
    const left = new Set<string>()
    const api = memberApi(left)
    const { d, s } = setup({}, api)
    expect((await handleFormGet(d, 'tokA', 'anna')).status).toBe(200)
    left.add('111')
    expect(await handleFormPost(d, ok, 'anna')).toEqual({ status: 403, body: { error: 'not_member' } })
    expect(s.completionRows).toEqual([])
    expect(s.tokens[0].used_at).toBeNull()
  })
  it('missing required → 400 and the token stays usable', async () => {
    const { d, s } = setup()
    expect(await handleFormPost(d, { t: 'tokA', answers: { i1: '3' }, corrective: {} }, 'anna')).toEqual({ status: 400, body: { error: 'missing', items: ['Door seals OK'] } })
    expect(s.tokens[0].used_at).toBeNull()
  })
  it('out of range without an action → 400; with an action → recorded, alerts to the source group and every alerts group once, WhatsApp managers told', async () => {
    const alertsGroup = groupRow({ id: 'g2', business_id: 'b', channel: 'telegram', chat_id: '-1002', title: 'Managers', alerts: true })
    const { d, s, calls, waAlerts } = setup({ groups: [groupRow(GROUP), alertsGroup] })
    const bad = { t: 'tokA', answers: { i1: '9', i2: 'yes' }, corrective: {} }
    expect(await handleFormPost(d, bad, 'anna')).toEqual({ status: 400, body: { error: 'corrective_required', items: ['Walk-in fridge'] } })
    const fixed = { ...bad, corrective: { i1: { action: 'moved', details: 'to fridge 2' } } }
    expect(await handleFormPost(d, fixed, 'anna')).toEqual({ status: 200, body: { ok: true } })
    expect(s.responses[0]).toMatchObject({ item_id: 'i1', value: '9', flagged: true, corrective_status: 'done', notes: 'Moved food to another fridge: to fridge 2' })
    const text = '⚠ Wharf Side · Walk-in fridge 9 °C at 10:40 (Anna S.). Action: Moved food to another fridge: to fridge 2. — via Blueroll'
    expect(sends(calls)).toEqual([['-1001', text], ['-1002', text]])
    expect(waAlerts).toEqual([{ b: 'b', siteName: 'Wharf Side', itemName: 'Walk-in fridge', value: '9 °C', time: '10:40', byName: 'Anna S.', action: 'Moved food to another fridge: to fridge 2' }])
  })
  it('the source group is also the alerts group → one alert there', async () => {
    const { d, calls } = setup({ groups: [groupRow({ ...GROUP, alerts: true })] })
    await handleFormPost(d, { t: 'tokA', answers: { i1: '9', i2: 'yes' }, corrective: { i1: { action: 'moved' } } }, 'anna')
    expect(sends(calls).map((x) => x[0])).toEqual(['-1001'])
  })
  it('after a submit the group list for that site is refreshed', async () => {
    const { d, calls } = setup({ lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '55', tokens: { t1: 'tokA', t2: 'tokB' }, rendered_hash: 'old' }] })
    await handleFormPost(d, ok, 'anna')
    const edit = calls.find((c) => c.method === 'editMessageText')!
    expect(edit.body).toMatchObject({ chat_id: '-1001', message_id: 55 })
    expect(edit.body.text).toContain('✅ Fridge temps · 10:40 Anna')
  })
  it('recording fails → token released, 500 retry', async () => {
    const { d, s } = setup()
    d.g.insertCompletion = async () => { throw new Error('db down') }
    expect(await handleFormPost(d, ok, 'anna')).toEqual({ status: 500, body: { error: 'retry' } })
    expect(s.tokens[0]).toMatchObject({ used_at: null, used_by_name: null })
  })
  it('bad bodies: 401 without valid initData, else 400', async () => {
    const { d } = setup()
    expect(await handleFormPost(d, null, 'forged')).toEqual({ status: 401, body: { error: 'unauthorized' } })
    expect(await handleFormPost(d, null, 'anna')).toEqual({ status: 400, body: { error: 'bad_request' } })
    expect(await handleFormPost(d, { t: 'tokA', answers: [] }, 'anna')).toEqual({ status: 400, body: { error: 'bad_request' } })
    expect(await handleFormPost(d, { t: 5 }, 'anna')).toEqual({ status: 400, body: { error: 'bad_request' } })
  })
  it("temperature '5abc' is treated as missing", async () => {
    const { d, s } = setup()
    expect(await handleFormPost(d, { t: 'tokA', answers: { i1: '5abc', i2: 'yes' }, corrective: {} }, 'anna'))
      .toEqual({ status: 400, body: { error: 'missing', items: ['Walk-in fridge'] } })
    expect(s.completionRows).toEqual([])
  })
  it('flagged with an unknown corrective action → 400 naming every flagged item, token still usable', async () => {
    const { d, s } = setup()
    const r = await handleFormPost(d, { t: 'tokA', answers: { i1: '9', i2: 'no' }, corrective: { i2: { action: 'bogus' } } }, 'anna')
    expect(r).toEqual({ status: 400, body: { error: 'corrective_required', items: ['Walk-in fridge', 'Door seals OK'] } })
    expect(s.tokens[0].used_at).toBeNull()
    expect(s.completionRows).toEqual([])
  })
  it('corrective details trimmed and clipped to 300; notes only for flagged items; answers normalised', async () => {
    const { d, s, waAlerts } = setup()
    const long = 'x'.repeat(400)
    const r = await handleFormPost(d, { t: 'tokA', answers: { i1: 9, i2: 'yes', i3: '  ok  ' },
      corrective: { i1: { action: 'moved', details: `  ${long}  ` }, i2: { action: 'discarded' } } }, 'anna')
    expect(r).toEqual({ status: 200, body: { ok: true } })
    const note = `Moved food to another fridge: ${'x'.repeat(300)}`
    expect(s.responses.map((x) => [x.item_id, x.value, x.flagged, x.notes, x.corrective_status])).toEqual([
      ['i1', '9', true, note, 'done'], ['i2', 'yes', false, null, null], ['i3', 'ok', false, null, null],
    ])
    expect(waAlerts).toEqual([expect.objectContaining({ itemName: 'Walk-in fridge', value: '9 °C', time: '10:40', action: note })])
  })
  it('corrective without details uses the action title only', async () => {
    const { d, s, waAlerts } = setup()
    expect((await handleFormPost(d, { t: 'tokA', answers: { i1: '3', i2: 'no' }, corrective: { i2: { action: 'other', details: '   ' } } }, 'anna')).status).toBe(200)
    expect(s.responses.find((x) => x.item_id === 'i2')).toMatchObject({ flagged: true, notes: 'Other', corrective_status: 'done' })
    expect(waAlerts[0]).toMatchObject({ itemName: 'Door seals OK', value: 'no', action: 'Other' })
  })
  it('answers for ids not on the token and a __proto__ key are ignored', async () => {
    const { d, s } = setup()
    const answers = JSON.parse('{"i1":"3","i2":"yes","i4":"photo.jpg","zzz":"x","__proto__":{"i3":"polluted"}}')
    expect((await handleFormPost(d, { t: 'tokA', answers, corrective: JSON.parse('{"__proto__":{"action":"moved"}}') }, 'anna')).status).toBe(200)
    expect(s.responses.map((x) => [x.item_id, x.value, x.flagged, x.notes])).toEqual([['i1', '3', false, null], ['i2', 'yes', false, null]])
  })
  it('failing alerts and a failing list refresh never fail the submission', async () => {
    const api = fakeTgApi((m, body) => {
      if (m === 'getChatMember') return { result: { status: 'member' } }
      throw new Error(`telegram down: ${m} ${body.chat_id}`)
    })
    const { d, s } = setup({ lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '55', tokens: { t1: 'tokA' }, rendered_hash: 'old' }] }, api)
    d.alertManagers = async () => { throw new Error('boom') }
    const r = await handleFormPost(d, { t: 'tokA', answers: { i1: '9', i2: 'yes' }, corrective: { i1: { action: 'moved' } } }, 'anna')
    expect(r).toEqual({ status: 200, body: { ok: true } })
    expect(s.completionRows).toHaveLength(1)
  })
  it('after a 500 the same token resubmits successfully, recorded once', async () => {
    const { d, s } = setup()
    const real = d.g.insertCompletion
    let fail = true
    d.g.insertCompletion = async (row) => { if (fail) throw new Error('db down'); return real(row) }
    expect(await handleFormPost(d, ok, 'anna')).toEqual({ status: 500, body: { error: 'retry' } })
    expect(s.tokens[0].used_at).toBeNull()
    fail = false
    expect(await handleFormPost(d, ok, 'anna')).toEqual({ status: 200, body: { ok: true } })
    expect(s.completionRows).toHaveLength(1)
    expect(s.tokens[0]).toMatchObject({ used_by_name: 'Anna' })
  })
})
