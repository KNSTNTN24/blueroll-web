// src/lib/whatsapp/__tests__/team-bot.test.ts
import { describe, it, expect, vi } from 'vitest'
import { handleInbound, TEXT } from '../../../../supabase/functions/_shared/channels/bot'
import { TEAM_TEXT } from '../../../../supabase/functions/_shared/channels/team-text'
import type { TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'
import { fakeTeamBot, textOf } from './fakes/team-bot-deps'
import { itemsHash } from '../../../../supabase/functions/_shared/channels/whatsapp-flows'
import { member, tpl, ANNA, BEN, TEMP_ITEM, NOW } from './fakes/team-deps'

const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })
const CLEAN = tpl({ id: 'tB', name: 'Cleaning' })
const FREEZER: TemplateItem = { id: 'i2', name: 'Freezer', item_type: 'temperature', required: true, min_value: -30, max_value: -18, unit: '°C', sort_order: 1 }
const MAP = [{ group_id: 'g1', template_id: 'tA' }, { group_id: 'g1', template_id: 'tB' }]
const benLinked = { id: 'idb', business_id: 'b', profile_id: BEN.profile_id, phone: BEN.phone, last_inbound_at: null, revoked: false, consent_source: 'team_invite' }
// Fresh copies: tests push into the fake's arrays.
const kitchen = (o: Parameters<typeof fakeTeamBot>[0] = {}) => fakeTeamBot({ templates: [FRIDGE, CLEAN], mappings: MAP.map((m) => ({ ...m })), ...o })
const say = (from: string, text: string, id = `t${Math.random()}`) => ({ kind: 'text' as const, from, text, id })
const tap = (from: string, payload: string, id = `b${Math.random()}`) => ({ kind: 'button' as const, from, payload, id })
const submit = (from: string, token: string, response: Record<string, unknown>, id = `f${Math.random()}`) => ({ kind: 'flow' as const, from, token, response, id })

describe('checks → one menu per team', () => {
  it('menu in the shipped format: team · site header, done lines with first names, tfill rows', async () => {
    const f = kitchen({ completions: [{ template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T07:47:00Z', completed_by: BEN.profile_id }] })
    await handleInbound(say(ANNA.phone, 'CHECKS'), f.d)
    const m = f.sent[0].interactive
    expect(m.type).toBe('list')
    expect(m.header.text).toBe('📋 Kitchen · Ashfield Row — 1 of 2 done')
    expect(m.body.text).toBe('🟠 Fridge temps — due 11:00\n✅ Cleaning — 08:47 Ben')
    expect(m.footer.text).toBe('Forms open on your phone')
    expect(m.action.button).toBe('Choose a check')
    expect(m.action.sections[0].rows).toEqual([{ id: 'tfill:g1:tA', title: 'Fridge temps', description: '🟠 Due 11:00 · due soon' }])
  })
  it('a linked person in no team → not in a team yet; nothing open → nothing due', async () => {
    const a = kitchen({ members: [] })
    await handleInbound(say(ANNA.phone, 'checks'), a.d)
    expect(textOf(a.sent[0])).toBe(TEAM_TEXT.notInTeam)
    const b = kitchen({ completions: ['tA', 'tB'].map((id) => ({ template_id: id, site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' })) })
    await handleInbound(say(ANNA.phone, 'checks'), b.d)
    expect(textOf(b.sent[0])).toBe(TEXT.nothingDue)
  })
  it('morning-list button checks:<team> → that team only; an old role-based fill: button → all teams', async () => {
    const f = kitchen()
    f.s.teams.push({ id: 'g2', business_id: 'b', title: 'Bar', site_id: 's1' })
    f.s.mappings.push({ group_id: 'g2', template_id: 'tB' })
    f.s.members.push(member({ id: 'gm7', group_id: 'g2', profile_id: ANNA.profile_id, phone: ANNA.phone }))
    await handleInbound(tap(ANNA.phone, 'checks:g2'), f.d)
    expect(f.sent.map((m) => m.interactive.header.text)).toEqual(['📋 Bar · Ashfield Row — 0 of 1 done'])
    await handleInbound(tap(ANNA.phone, 'fill:tA:s1'), f.d)
    expect(f.sent.slice(1).map((m) => m.interactive.header.text)).toEqual(['📋 Kitchen · Ashfield Row — 0 of 2 done', '📋 Bar · Ashfield Row — 0 of 1 done'])
  })
  it('pending out-of-range answers get their corrective form before the menus', async () => {
    const f = kitchen()
    f.pending.push({ response_id: 'r9', item: TEMP_ITEM, value: '9', site_id: 's1', template_id: 'tA' }, { response_id: 'r8', item: TEMP_ITEM, value: '9', site_id: 'elsewhere', template_id: 'tA' })
    await handleInbound(say(ANNA.phone, 'checks'), f.d)
    expect(f.sent[0].interactive.action.parameters.flow_id).toBe('FC')
    expect(f.tokens.get('tok1')).toMatchObject({ kind: 'corrective', response_id: 'r9' })
    expect(f.sent[1].interactive.type).toBe('list')
    expect(f.sent).toHaveLength(2)
  })
  it('a bare LINK code is no longer special', async () => {
    const f = kitchen()
    await handleInbound(say('447000000001', 'LINK 482913'), f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.unknown)
  })
})

describe('tfill → the checklist Flow', () => {
  it('sends the Flow with a token bound to the member and the team', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    expect(f.sent[0].interactive.action.parameters).toMatchObject({ flow_id: 'F1', flow_token: 'tok1' })
    expect(f.tokens.get('tok1')).toMatchObject({ kind: 'checklist', profile_id: 'p1', site_id: 's1', template_id: 'tA', group_id: 'g1', item_ids: ['i1'] })
  })
  it('removed from the team → "no longer in"; a template not mapped → form expired', async () => {
    const f = kitchen()
    f.s.members[0].status = 'removed'
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    expect(textOf(f.sent[0])).toBe(TEAM_TEXT.noLongerIn('Kitchen'))
    const g = kitchen({ mappings: [MAP[1]] })
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), g.d)
    expect(textOf(g.sent[0])).toBe(TEXT.formExpired)
  })
  it('an old button on a closed checklist → "Already done ✓ by Ben 10:30" and the fresh menu', async () => {
    const f = kitchen({ completions: [{ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:30:00Z', completed_by: BEN.profile_id }] })
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    expect(textOf(f.sent[0])).toBe('Already done ✓ by Ben 10:30')
    expect(f.sent[1].interactive.header.text).toBe('📋 Kitchen · Ashfield Row — 1 of 2 done')
    expect(f.tokens.size).toBe(0)
  })
  it('item ids churned by an editor save (same shape) → current ids; shape changed → app only', async () => {
    const f = kitchen()
    f.flows.tA = { flow_id: 'F1', item_ids: ['old'], items_hash: await itemsHash('Fridge temps', [TEMP_ITEM]) }
    f.items.tA = [{ ...TEMP_ITEM, id: 'n1' }]
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    expect(f.tokens.get('tok1')!.item_ids).toEqual(['n1'])
    f.items.tA = [{ ...TEMP_ITEM, id: 'n1' }, FREEZER]
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    expect(textOf(f.sent[1])).toBe(TEXT.appOnly('Fridge temps'))
  })
})

describe('submit — first submit wins', () => {
  it('records with source whatsapp; out-of-range → corrective form', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '9' }), f.d)
    expect(f.s.completionRows).toEqual([{ template_id: 'tA', business_id: 'b', site_id: 's1', completed_by: 'p1', completed_at: NOW.toISOString(), source: 'whatsapp' }])
    expect(f.s.responses.map((r: any) => r.corrective_status)).toEqual(['needed'])
    expect(f.sent[1].interactive.action.parameters.flow_id).toBe('FC')
    expect([...f.s.takes.keys()]).toEqual(['g1|tA|s1|2026-10-14'])
  })
  it('two people submit at once → one completion; the other gets "Already done ✓ by Anna 10:40" and the menu', async () => {
    const f = kitchen({ members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm2', profile_id: BEN.profile_id, phone: BEN.phone })] })
    f.s.identities.push({ ...benLinked })
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)   // tok1
    await handleInbound(tap(BEN.phone, 'tfill:g1:tA'), f.d)    // tok2
    await Promise.all([
      handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d),
      handleInbound(submit(BEN.phone, 'tok2', { f0: '4' }), f.d),
    ])
    expect(f.s.completionRows).toHaveLength(1)
    const loser = f.s.completionRows[0].completed_by === 'p1' ? BEN.phone : ANNA.phone
    const winner = loser === BEN.phone ? 'Anna' : 'Ben'
    const toLoser = f.sent.filter((m) => m.to === loser).slice(1)   // after their Flow
    expect(textOf(toLoser[0])).toBe(`Already done ✓ by ${winner} 10:40`)
    // Ruling F14: the loser's menu may be built before or after the winner's completion lands — only its presence is pinned.
    expect(toLoser[1].interactive.type).toBe('list')
    expect(f.s.takes.size).toBe(1)
  })
  it('a completion from the app counts as done: nothing recorded', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:35:00Z', completed_by: BEN.profile_id })
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(f.s.completionRows).toEqual([])
    expect(textOf(f.sent[1])).toBe('Already done ✓ by Ben 10:35')
  })
  it('removed between opening and submitting → "You\'re no longer in Kitchen.", nothing recorded', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    f.s.members[0].status = 'removed'
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(f.s.completionRows).toEqual([])
    expect(textOf(f.sent[1])).toBe("You're no longer in Kitchen.")
  })
  it('unmapped after the form was sent → form expired', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    f.s.mappings = [MAP[1]]
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(f.s.completionRows).toEqual([])
    expect(textOf(f.sent[1])).toBe(TEXT.formExpired)
  })
  it('a token from the retired role-based flow (no team) → form expired', async () => {
    const f = kitchen()
    await f.d.saveToken({ token: 'old', kind: 'checklist', business_id: 'b', profile_id: 'p1', site_id: 's1', template_id: 'tA', item_ids: ['i1'], response_id: null, expires_at: '2099-01-01', used_at: null })
    await handleInbound(submit(ANNA.phone, 'old', { f0: '3' }), f.d)
    expect(f.s.completionRows).toEqual([])
    expect(textOf(f.sent[0])).toBe(TEXT.formExpired)
  })
  it('missing required answers / items re-created → nothing recorded, message and a fresh form', async () => {
    const f = kitchen()
    f.items.tA = [TEMP_ITEM, FREEZER]
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(textOf(f.sent[1])).toBe(TEXT.missing(['Freezer']))
    expect(f.sent[2].interactive.action.parameters.flow_token).toBe('tok2')
    f.items.tA = [{ ...TEMP_ITEM, id: 'n1' }, { ...FREEZER, id: 'n2' }]
    await handleInbound(submit(ANNA.phone, 'tok2', { f0: '3', f1: '-20' }), f.d)
    expect(textOf(f.sent[3])).toBe(TEXT.checklistChanged)
    expect(f.tokens.get('tok3')!.item_ids).toEqual(['n1', 'n2'])
    expect(f.s.completionRows).toEqual([])
    expect(f.s.takes.size).toBe(0)
  })
  it('several a day: the first submit leaves it open and the next person gets the second slot', async () => {
    const PROBE = tpl({ id: 'tP', name: 'Probe', multi_per_day: true, min_per_day: 2 })
    const f = fakeTeamBot({ templates: [PROBE], mappings: [{ group_id: 'g1', template_id: 'tP' }],
      members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm2', profile_id: BEN.profile_id, phone: BEN.phone })] })
    f.s.identities.push({ ...benLinked })
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tP'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    await handleInbound(tap(BEN.phone, 'tfill:g1:tP'), f.d)
    await handleInbound(submit(BEN.phone, 'tok2', { f0: '4' }), f.d)
    expect(f.s.completionRows.map((r: any) => r.completed_by)).toEqual(['p1', 'p2'])
    expect([...f.s.takes.keys()]).toEqual(['g1|tP|s1|2026-10-14#1', 'g1|tP|s1|2026-10-14#2'])
  })
  it('a duplicate delivery of the same submit records once', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }, 'wamid.F'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }, 'wamid.F'), f.d)
    expect(f.s.completionRows).toHaveLength(1)
  })
})

describe('corrective forms (shared behaviour, ported from the role-based suite)', () => {
  const fc = (f: ReturnType<typeof kitchen>) => f.sent.filter((m) => m.interactive?.action?.parameters?.flow_id === 'FC')
  it('two out-of-range items → two corrective forms with their own tokens and response ids', async () => {
    const f = kitchen()
    f.items.tA = [TEMP_ITEM, FREEZER]
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '9', f1: '-5' }), f.d)
    expect(f.s.completionRows).toHaveLength(1)
    expect(f.s.responses.map((r: any) => [r.item_id, r.corrective_status])).toEqual([['i1', 'needed'], ['i2', 'needed']])
    const corr = fc(f)
    expect(corr).toHaveLength(2)
    expect(corr[0].interactive.action.parameters.flow_action_payload.data).toEqual({ item_name: 'Walk-in fridge', value_text: '9 °C (limit 0–5 °C)' })
    expect(corr.map((m) => { const t = f.tokens.get(m.interactive.action.parameters.flow_token)!; return [t.kind, t.response_id] }))
      .toEqual([['corrective', 'resp0'], ['corrective', 'resp1']])
  })
  it('no corrective Flow configured → completion still recorded (needed), no corrective form sent', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const f = fakeTeamBot({ templates: [FRIDGE, CLEAN], mappings: MAP.map((m) => ({ ...m })) }, { correctiveFlowId: () => '' })
      await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
      await handleInbound(submit(ANNA.phone, 'tok1', { f0: '9' }), f.d)
      expect(f.s.completionRows).toHaveLength(1)
      expect(f.s.responses.map((r: any) => r.corrective_status)).toEqual(['needed'])
      expect(f.sent.filter((m) => m.interactive?.type === 'flow' && m.interactive.action.parameters.flow_id !== 'F1')).toHaveLength(0)
      expect(err).toHaveBeenCalled()
    } finally { err.mockRestore() }
  })
  it('pending corrective forms re-offered on checks are capped at 3 (sites outside the person\'s teams skipped)', async () => {
    const f = kitchen()
    const mk = (i: number, site = 's1') => ({ response_id: `r${i}`, item: TEMP_ITEM, value: '9', site_id: site, template_id: 'tA' })
    f.pending.push(mk(0, 'gone'), mk(1), mk(2), mk(3), mk(4))
    await handleInbound(say(ANNA.phone, 'checks'), f.d)
    expect(fc(f).map((m) => f.tokens.get(m.interactive.action.parameters.flow_token)!.response_id)).toEqual(['r1', 'r2', 'r3'])
    expect(f.sent.at(-1).interactive.type).toBe('list')
  })
})

describe('already closed is answered before the answers are checked', () => {
  it('closed from the app → a blank submit gets "Already done", not "missing answers"', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:35:00Z', completed_by: BEN.profile_id })
    await handleInbound(submit(ANNA.phone, 'tok1', {}), f.d)
    expect(textOf(f.sent[1])).toBe('Already done ✓ by Ben 10:35')
    expect(f.sent.map(textOf)).not.toContain(TEXT.missing(['Walk-in fridge']))
    expect(f.tokens.size).toBe(1)   // no fresh form
  })
  it('someone else holds the take → "Already done ✓ by" them, no fresh form, nothing recorded', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    f.s.takes.set('g1|tA|s1|2026-10-14', { profile_id: BEN.profile_id, taken_at: '2026-10-14T09:38:00Z' })
    await handleInbound(submit(ANNA.phone, 'tok1', {}), f.d)
    expect(textOf(f.sent[1])).toBe('Already done ✓ by Ben 10:38')
    expect(f.s.completionRows).toEqual([])
    expect(f.tokens.size).toBe(1)
  })
})

describe('🎉 when a submit closes the day', () => {
  it('only members with an open window; the day_end event is claimed once', async () => {
    const f = kitchen({ members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm2', profile_id: BEN.profile_id, phone: BEN.phone })],
      completions: [{ template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p2' }] })
    f.s.identities.push({ ...benLinked, last_inbound_at: '2026-10-12T08:00:00Z' })   // window closed
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(f.sent.slice(1).map((m) => [m.to, textOf(m)])).toEqual([[ANNA.phone, '🎉 All Kitchen checks done today']])
    expect(f.s.events.has('g1|day_end|2026-10-14')).toBe(true)
  })
  it('a weekly checklist still open does not block it', async () => {
    const f = fakeTeamBot({ templates: [FRIDGE, tpl({ id: 'tW', name: 'Deep clean', frequency: 'weekly' })], mappings: [MAP[0], { group_id: 'g1', template_id: 'tW' }] })
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d)
    expect(textOf(f.sent[1])).toBe('🎉 All Kitchen checks done today')
  })
})

// Review Focus 2: one person in two teams at the same site, same checklist mapped to both.
describe('two teams at the same site', () => {
  it('two menus; once either team records it, the other team answers "Already done" and records nothing', async () => {
    const f = kitchen({ members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm2', group_id: 'g2', profile_id: BEN.profile_id, phone: BEN.phone }), member({ id: 'gm3', group_id: 'g2', profile_id: ANNA.profile_id, phone: ANNA.phone })] })
    f.s.teams.push({ id: 'g2', business_id: 'b', title: 'Bar', site_id: 's1' })
    f.s.mappings.push({ group_id: 'g2', template_id: 'tA' })
    f.s.identities.push({ ...benLinked })
    await handleInbound(say(ANNA.phone, 'checks'), f.d)
    expect(f.sent.map((m) => m.interactive.header.text)).toEqual(['📋 Kitchen · Ashfield Row — 0 of 2 done', '📋 Bar · Ashfield Row — 0 of 1 done'])
    await handleInbound(tap(BEN.phone, 'tfill:g2:tA'), f.d)
    const benToken = [...f.tokens.values()].find((t) => t.profile_id === 'p2')!.token
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)
    await handleInbound(submit(ANNA.phone, [...f.tokens.values()].find((t) => t.profile_id === 'p1')!.token, { f0: '3' }), f.d)
    await handleInbound(submit(BEN.phone, benToken, { f0: '3' }), f.d)
    expect(f.s.completionRows).toHaveLength(1)
    expect(textOf(f.sent.filter((m) => m.to === BEN.phone)[1])).toBe('Already done ✓ by Anna 10:40')
  })
})

describe('two teams at the same site — concurrent', () => {
  it('both teams submit at once → one completion, one claim covering both teams; the other gets "Already done ✓ by"', async () => {
    const f = kitchen({ members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone }), member({ id: 'gm2', group_id: 'g2', profile_id: BEN.profile_id, phone: BEN.phone })] })
    f.s.teams.push({ id: 'g2', business_id: 'b', title: 'Bar', site_id: 's1' })
    f.s.mappings.push({ group_id: 'g2', template_id: 'tA' })
    f.s.identities.push({ ...benLinked })
    await handleInbound(tap(ANNA.phone, 'tfill:g1:tA'), f.d)   // tok1
    await handleInbound(tap(BEN.phone, 'tfill:g2:tA'), f.d)    // tok2
    await Promise.all([
      handleInbound(submit(ANNA.phone, 'tok1', { f0: '3' }), f.d),
      handleInbound(submit(BEN.phone, 'tok2', { f0: '4' }), f.d),
    ])
    expect(f.s.completionRows).toHaveLength(1)
    expect([...f.s.takes.keys()].sort()).toEqual(['g1|tA|s1|2026-10-14', 'g2|tA|s1|2026-10-14'])
    const loser = f.s.completionRows[0].completed_by === 'p1' ? BEN.phone : ANNA.phone
    const toLoser = f.sent.filter((m) => m.to === loser).slice(1)
    expect(textOf(toLoser[0])).toMatch(/^Already done ✓ by (Anna|Ben) 10:40$/)
  })
})

describe('entry points and removed sites', () => {
  it('the bare "checks" quick reply (corrective nudge) shows every team menu', async () => {
    const f = kitchen()
    await handleInbound(tap(ANNA.phone, 'checks'), f.d)
    expect(f.sent.map((m) => m.interactive.header.text)).toEqual(['📋 Kitchen · Ashfield Row — 0 of 2 done'])
  })
  it('a team at a soft-removed site is skipped in the menus and its form buttons expire', async () => {
    const f = kitchen()
    f.s.teams.push({ id: 'g3', business_id: 'b', title: 'Old bar', site_id: 's-gone' })   // s-gone not in sites = removed
    f.s.mappings.push({ group_id: 'g3', template_id: 'tA' })
    f.s.members.push(member({ id: 'gm8', group_id: 'g3', profile_id: ANNA.profile_id, phone: ANNA.phone }))
    await handleInbound(say(ANNA.phone, 'checks'), f.d)
    expect(f.sent.map((m) => m.interactive.header.text)).toEqual(['📋 Kitchen · Ashfield Row — 0 of 2 done'])
    await handleInbound(tap(ANNA.phone, 'tfill:g3:tA'), f.d)
    expect(textOf(f.sent[1])).toBe(TEXT.formExpired)
    expect(f.tokens.size).toBe(0)
  })
})

describe('join route', () => {
  it('an unlinked number taps Join on its invite → linked and answered', async () => {
    const MARIA = '447700900777'
    const f = kitchen({ members: [member({ id: 'gm9', profile_id: 'p9', phone: MARIA, status: 'invited', full_name: 'Maria Lopez', last_invite_sent_at: '2026-10-14T09:00:00Z' })] })
    await handleInbound(tap(MARIA, 'join:gm9'), f.d)
    expect(textOf(f.sent[0])).toBe("You're in Kitchen at Ashfield Row ✓")
    expect(f.s.members[0].status).toBe('active')
    await handleInbound(tap('447700900555', 'join:gm9'), f.d)    // someone else's phone: ignored
    expect(f.sent).toHaveLength(1)
  })
})
