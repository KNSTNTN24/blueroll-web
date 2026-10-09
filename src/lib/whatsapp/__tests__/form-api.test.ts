// src/lib/whatsapp/__tests__/form-api.test.ts
import { describe, it, expect } from 'vitest'
import { handleFormGet, handleFormPost, type FormApiDeps } from '../../../../supabase/functions/_shared/channels/form-api'
import type { FormToken } from '../../../../supabase/functions/_shared/channels/bot'
import type { Template, TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'
import { CORRECTIVE_ACTIONS } from '../../../../supabase/functions/_shared/channels/whatsapp-flows'
import { recordCompletion } from '../../../../supabase/functions/_shared/checklists-core/record'

const NOW = new Date('2026-10-14T09:40:00Z')   // 10:40 Europe/London (BST)
const T: Template = { id: 't1', business_id: 'b', site_id: null, name: 'Fridge temps', frequency: 'daily', deadline_time: '11:00',
  multi_per_day: false, min_per_day: null, assigned_roles: [], assigned_role_ids: ['r'], active: true }
const ITEMS: TemplateItem[] = [
  { id: 'i1', name: 'Walk-in fridge', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C', sort_order: 0 },
  { id: 'i2', name: 'Door seals OK', item_type: 'yes_no', required: true, min_value: null, max_value: null, unit: null, sort_order: 1 },
  { id: 'i3', name: 'Notes', item_type: 'text', required: false, min_value: null, max_value: null, unit: null, sort_order: 2 },
  { id: 'i4', name: 'Photo', item_type: 'photo', required: false, min_value: null, max_value: null, unit: null, sort_order: 3 },
]
const INIT = 'good-init'

function token(over: Partial<FormToken> = {}): FormToken {
  return { token: 'tok1', kind: 'checklist', business_id: 'b', profile_id: 'p1', site_id: 's1', template_id: 't1',
    item_ids: ['i1', 'i2', 'i3'], response_id: null, expires_at: '2026-10-15T09:00:00Z', used_at: null, ...over }
}

function fake(over: Partial<FormApiDeps> = {}, tok: FormToken = token()) {
  const tokens = new Map<string, FormToken>([[tok.token, tok]])
  const state: { recorded: any[]; alerts: any[]; notes: any[] } = { recorded: [], alerts: [], notes: [] }
  const d: FormApiDeps = {
    now: () => NOW,
    // 'good-init' → user 111 (linked to p1); 'other-init' → user 222 (linked to p2); 'stranger-init' → 333 (not linked).
    verifyInitData: async (s) => ({ 'good-init': { userId: '111' }, 'other-init': { userId: '222' }, 'stranger-init': { userId: '333' } } as any)[s] ?? null,
    identityByExternal: async (_ch, x) => (x === '111' ? { profile_id: 'p1', business_id: 'b' } : x === '222' ? { profile_id: 'p2', business_id: 'b2' } : null),
    peekToken: async (t) => tokens.get(t) ?? null,
    takeToken: async (t, now, pid) => {
      const r = tokens.get(t)
      if (!r || r.used_at || r.profile_id !== pid || new Date(r.expires_at) <= now) return null
      r.used_at = now.toISOString(); return r
    },
    releaseToken: async (t, at) => { const r = tokens.get(t); if (r && r.used_at === at) r.used_at = null },
    ready: async () => true,
    person: async (pid) => ({ profile_id: pid, business_id: 'b', full_name: 'Anna Smith', role: 'kitchen_staff', role_id: 'r' }),
    sitesFor: async () => [{ id: 's1', name: 'Wharf Side', timezone: 'Europe/London' }],
    templates: async () => [T],
    items: async () => ITEMS,
    recordCompletionWithCorrective: async (a) => {
      state.recorded.push(a)
      const byId = new Map(a.items.map((i) => [i.id, i]))
      return { completionId: 'c1', flagged: a.answers.filter((x) => x.flagged).map((x) => ({ item: byId.get(x.item_id)!, value: x.value, notes: a.corrective[x.item_id] })) }
    },
    alert: async (b, a) => { state.alerts.push({ b, ...a }) },
    notifyUser: async (chatId, text) => { state.notes.push({ chatId, text }) },
    ...over,
  }
  return { d, tokens, state }
}

const ok = { t: 'tok1', answers: { i1: '3', i2: 'yes' }, corrective: {} }

describe('form api GET', () => {
  it('returns the form for the owner', async () => {
    const f = fake()
    const r = await handleFormGet(f.d, 'tok1', INIT)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({
      templateName: 'Fridge temps', siteName: 'Wharf Side',
      items: [
        { id: 'i1', name: 'Walk-in fridge', type: 'temperature', required: true, min: 0, max: 5, unit: '°C' },
        { id: 'i2', name: 'Door seals OK', type: 'yes_no', required: true, min: null, max: null, unit: null },
        { id: 'i3', name: 'Notes', type: 'text', required: false, min: null, max: null, unit: null },
      ],
      correctiveActions: CORRECTIVE_ACTIONS,
    })
    expect(f.tokens.get('tok1')!.used_at).toBeNull()   // GET never consumes
  })
  it('invalid initData → 401', async () => {
    expect((await handleFormGet(fake().d, 'tok1', 'forged')).status).toBe(401)
  })
  it('Telegram user with no linked identity → 403', async () => {
    const r = await handleFormGet(fake().d, 'tok1', 'stranger-init')
    expect(r.status).toBe(403)
    expect(JSON.stringify(r.body)).not.toContain('Fridge')
  })
  it('linked Telegram user who does not own the token → 403, nothing about the token revealed', async () => {
    const r = await handleFormGet(fake().d, 'tok1', 'other-init')
    expect(r.status).toBe(403)
    expect(JSON.stringify(r.body)).not.toMatch(/Fridge|Wharf|expired/)
  })
  it('expired, used, unknown or non-checklist token → 410', async () => {
    expect((await handleFormGet(fake({}, token({ expires_at: '2026-10-14T09:00:00Z' })).d, 'tok1', INIT))).toEqual({ status: 410, body: { error: 'expired' } })
    expect((await handleFormGet(fake({}, token({ used_at: '2026-10-14T09:00:00Z' })).d, 'tok1', INIT))).toEqual({ status: 410, body: { error: 'used' } })
    expect((await handleFormGet(fake().d, 'nope', INIT)).status).toBe(410)
    expect((await handleFormGet(fake({}, token({ kind: 'corrective' })).d, 'tok1', INIT)).status).toBe(410)
  })
  it('business not ready → 403', async () => {
    expect((await handleFormGet(fake({ ready: async () => false }).d, 'tok1', INIT)).status).toBe(403)
  })
  it('no longer assigned (role, template inactive, site removed) → 410', async () => {
    expect((await handleFormGet(fake({ templates: async () => [{ ...T, assigned_role_ids: ['other'] }] }).d, 'tok1', INIT)).status).toBe(410)
    expect((await handleFormGet(fake({ templates: async () => [] }).d, 'tok1', INIT)).status).toBe(410)
    expect((await handleFormGet(fake({ sitesFor: async () => [] }).d, 'tok1', INIT)).status).toBe(410)
  })
  it('items re-created since the form was sent → 410 changed', async () => {
    const f = fake({ items: async () => ITEMS.map((i) => ({ ...i, id: i.id + 'x' })) })
    expect(await handleFormGet(f.d, 'tok1', INIT)).toEqual({ status: 410, body: { error: 'changed' } })
  })
})

describe('form api POST', () => {
  it('records a clean submission once and consumes the token', async () => {
    const f = fake()
    expect(await handleFormPost(f.d, ok, INIT)).toEqual({ status: 200, body: { ok: true } })
    expect(f.state.recorded).toHaveLength(1)
    expect(f.state.recorded[0].answers).toEqual([
      { item_id: 'i1', value: '3', flagged: false }, { item_id: 'i2', value: 'yes', flagged: false },
    ])
    expect(f.state.recorded[0].siteId).toBe('s1')
    expect(f.state.alerts).toEqual([])
    expect(f.tokens.get('tok1')!.used_at).not.toBeNull()
  })
  it('replay → 410 and nothing recorded twice', async () => {
    const f = fake()
    await handleFormPost(f.d, ok, INIT)
    expect(await handleFormPost(f.d, ok, INIT)).toEqual({ status: 410, body: { error: 'used' } })
    expect(f.state.recorded).toHaveLength(1)
  })
  it('a used token of someone else is still 403 (ownership first, "used" not revealed)', async () => {
    const r = await handleFormGet(fake({}, token({ used_at: '2026-10-14T09:00:00Z' })).d, 'tok1', 'other-init')
    expect(r).toEqual({ status: 403, body: { error: 'forbidden' } })
  })
  it('lost the race to a concurrent submit (take fails after the peek) → 410 used', async () => {
    const f = fake({ takeToken: async () => null })
    expect(await handleFormPost(f.d, ok, INIT)).toEqual({ status: 410, body: { error: 'used' } })
    expect(f.state.recorded).toHaveLength(0)
  })
  it('after a successful submit the user gets a short Telegram confirmation', async () => {
    const f = fake()
    expect((await handleFormPost(f.d, ok, INIT)).status).toBe(200)
    expect(f.state.notes).toEqual([{ chatId: '111', text: 'Recorded ✓ Fridge temps at Wharf Side' }])
  })
  it('a failing confirmation never fails the submit', async () => {
    const f = fake({ notifyUser: async () => { throw new Error('telegram down') } })
    expect(await handleFormPost(f.d, ok, INIT)).toEqual({ status: 200, body: { ok: true } })
    expect(f.state.recorded).toHaveLength(1)
  })
  it('no confirmation when the submit is refused', async () => {
    const f = fake()
    await handleFormPost(f.d, { t: 'tok1', answers: { i1: '3' }, corrective: {} }, INIT)
    expect(f.state.notes).toEqual([])
  })
  it('missing required → 400 with names, token still usable', async () => {
    const f = fake()
    const r = await handleFormPost(f.d, { t: 'tok1', answers: { i1: '3' }, corrective: {} }, INIT)
    expect(r).toEqual({ status: 400, body: { error: 'missing', items: ['Door seals OK'] } })
    expect(f.tokens.get('tok1')!.used_at).toBeNull()
    expect((await handleFormPost(f.d, ok, INIT)).status).toBe(200)
  })
  it("temperature '5abc' is treated as missing", async () => {
    const f = fake()
    const r = await handleFormPost(f.d, { t: 'tok1', answers: { i1: '5abc', i2: 'yes' }, corrective: {} }, INIT)
    expect(r).toEqual({ status: 400, body: { error: 'missing', items: ['Walk-in fridge'] } })
    expect(f.state.recorded).toHaveLength(0)
  })
  it('flagged without a corrective action → 400, token still usable', async () => {
    const f = fake()
    const r = await handleFormPost(f.d, { t: 'tok1', answers: { i1: '9', i2: 'no' }, corrective: { i2: { action: 'bogus' } } }, INIT)
    expect(r).toEqual({ status: 400, body: { error: 'corrective_required', items: ['Walk-in fridge', 'Door seals OK'] } })
    expect(f.tokens.get('tok1')!.used_at).toBeNull()
    expect(f.state.recorded).toHaveLength(0)
  })
  it('flagged with a corrective action → 200, notes set, one alert in site time', async () => {
    const f = fake()
    const long = 'x'.repeat(400)
    const r = await handleFormPost(f.d, { t: 'tok1', answers: { i1: 9, i2: 'yes', i3: '  ok  ' },
      corrective: { i1: { action: 'moved', details: `  ${long}  ` }, i2: { action: 'discarded' } } }, INIT)
    expect(r).toEqual({ status: 200, body: { ok: true } })
    const rec = f.state.recorded[0]
    expect(rec.answers).toEqual([
      { item_id: 'i1', value: '9', flagged: true }, { item_id: 'i2', value: 'yes', flagged: false }, { item_id: 'i3', value: 'ok', flagged: false },
    ])
    expect(rec.corrective).toEqual({ i1: `Moved food to another fridge: ${'x'.repeat(300)}` })   // only flagged items
    expect(f.state.alerts).toEqual([{ b: 'b', siteName: 'Wharf Side', itemName: 'Walk-in fridge', value: '9 °C', time: '10:40',
      byName: 'Anna Smith', action: `Moved food to another fridge: ${'x'.repeat(300)}` }])
  })
  it('corrective without details uses the action title only', async () => {
    const f = fake()
    await handleFormPost(f.d, { t: 'tok1', answers: { i1: '3', i2: 'no' }, corrective: { i2: { action: 'other', details: '   ' } } }, INIT)
    expect(f.state.recorded[0].corrective).toEqual({ i2: 'Other' })
    expect(f.state.alerts[0]).toMatchObject({ itemName: 'Door seals OK', value: 'no', action: 'Other' })
  })
  it('foreign / unlinked Telegram user → 403, token untouched', async () => {
    const f = fake()
    expect((await handleFormPost(f.d, ok, 'other-init')).status).toBe(403)
    expect((await handleFormPost(f.d, ok, 'stranger-init')).status).toBe(403)
    expect(f.tokens.get('tok1')!.used_at).toBeNull()
    expect(f.state.recorded).toHaveLength(0)
  })
  it('invalid initData → 401', async () => {
    expect((await handleFormPost(fake().d, ok, '')).status).toBe(401)
  })
  it('changed items → 410 changed, nothing recorded, token not consumed', async () => {
    const f = fake({ items: async () => ITEMS.filter((i) => i.id !== 'i3') })
    expect(await handleFormPost(f.d, ok, INIT)).toEqual({ status: 410, body: { error: 'changed' } })
    expect(f.state.recorded).toHaveLength(0)
  })
  it('unassigned at submit → 410', async () => {
    const f = fake({ templates: async () => [{ ...T, active: false }] })
    expect((await handleFormPost(f.d, ok, INIT)).status).toBe(410)
    expect(f.state.recorded).toHaveLength(0)
  })
  it('malformed body → 400', async () => {
    const f = fake()
    expect((await handleFormPost(f.d, null, INIT)).status).toBe(400)
    expect((await handleFormPost(f.d, { t: 5 }, INIT)).status).toBe(400)
    expect((await handleFormPost(f.d, { t: 'tok1', answers: [] }, INIT)).status).toBe(400)
  })
  it('record failure releases the token → 500 retry, same token resubmits', async () => {
    let fail = true
    const f = fake()
    const real = f.d.recordCompletionWithCorrective
    f.d.recordCompletionWithCorrective = async (a) => { if (fail) throw new Error('db down'); return real(a) }
    expect(await handleFormPost(f.d, ok, INIT)).toEqual({ status: 500, body: { error: 'retry' } })
    expect(f.tokens.get('tok1')!.used_at).toBeNull()
    fail = false
    expect(await handleFormPost(f.d, ok, INIT)).toEqual({ status: 200, body: { ok: true } })
    expect(f.state.recorded).toHaveLength(1)
  })
  it('answers for ids not on the token and a __proto__ key are ignored', async () => {
    const f = fake()
    const answers = JSON.parse('{"i1":"3","i2":"yes","i4":"photo.jpg","zzz":"x","__proto__":{"i3":"polluted"}}')
    expect((await handleFormPost(f.d, { t: 'tok1', answers, corrective: JSON.parse('{"__proto__":{"action":"moved"}}') }, INIT)).status).toBe(200)
    expect(f.state.recorded[0].answers).toEqual([
      { item_id: 'i1', value: '3', flagged: false }, { item_id: 'i2', value: 'yes', flagged: false },
    ])
    expect(f.state.recorded[0].corrective).toEqual({})
  })
  it('a failing alert does not fail the submission', async () => {
    const f = fake({ alert: async () => { throw new Error('boom') } })
    const r = await handleFormPost(f.d, { t: 'tok1', answers: { i1: '9', i2: 'yes' }, corrective: { i1: { action: 'moved' } } }, INIT)
    expect(r.status).toBe(200)
  })
})

describe('recordCompletion corrective notes', () => {
  const person = { profile_id: 'p1', business_id: 'b', full_name: 'Anna', role: 'kitchen_staff', role_id: 'r' }
  const db = () => {
    const s: any = { responses: [], notifs: [] }
    return { s, db: {
      insertCompletion: async () => ({ id: 'c1' }),
      insertResponses: async (rows: any[]) => { s.responses.push(...rows); return rows.map((r, i) => ({ id: 'r' + i, item_id: r.item_id })) },
      managerIds: async () => ['m1'],
      insertNotifications: async (rows: any[]) => { s.notifs.push(...rows) },
    } }
  }
  const answers = [{ item_id: 'i1', value: '9', flagged: true }, { item_id: 'i2', value: 'yes', flagged: false }]
  it('default: flagged → needed, notes null (WhatsApp unchanged)', async () => {
    const { s, db: x } = db()
    const r = await recordCompletion(x, { person, siteId: 's1', template: T, items: ITEMS, answers, source: 'whatsapp', now: NOW })
    expect(s.responses.map((r: any) => [r.notes, r.corrective_status])).toEqual([[null, 'needed'], [null, null]])
    expect(r.flagged[0].notes).toBeNull()
  })
  it('with notes: flagged → done + notes; unflagged untouched; managers still notified in-app', async () => {
    const { s, db: x } = db()
    const r = await recordCompletion(x, { person, siteId: 's1', template: T, items: ITEMS, answers, source: 'telegram', now: NOW,
      correctiveNotes: { i1: 'Discarded food', i2: 'ignored' } })
    expect(s.responses.map((r: any) => [r.notes, r.corrective_status])).toEqual([['Discarded food', 'done'], [null, null]])
    expect(r.flagged[0].notes).toBe('Discarded food')
    expect(s.notifs).toHaveLength(1)
  })
  it('an empty or blank note does not mark the corrective done', async () => {
    const { s, db: x } = db()
    await recordCompletion(x, { person, siteId: 's1', template: T, items: ITEMS, answers, source: 'telegram', now: NOW, correctiveNotes: { i1: '  ' } })
    expect(s.responses[0]).toMatchObject({ notes: null, corrective_status: 'needed' })
  })
})
