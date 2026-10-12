// src/lib/whatsapp/__tests__/bot.test.ts
// Channel-level bot behaviour that doesn't depend on teams: identity, STOP/HELP, tokens, corrective replies, alerts.
import { describe, it, expect } from 'vitest'
import { handleInbound, TEXT } from '../../../../supabase/functions/_shared/channels/bot'
import { alertManagers, type AlertRecipient } from '../../../../supabase/functions/_shared/channels/alerts'
import { fakeTeamBot, textOf } from './fakes/team-bot-deps'
import { ANNA } from './fakes/team-deps'

type Recipients = () => Promise<(Omit<AlertRecipient, 'channel'> & { channel?: AlertRecipient['channel'] })[]>
function fake(recipients: Recipients = async () => [{ external_id: '447700900999', last_inbound_at: null }], init: Parameters<typeof fakeTeamBot>[0] = {}) {
  const logs: any[] = []
  const f = fakeTeamBot(init)
  // Cross-channel alert path with fake AlertDeps; every channel sends via d.send.
  f.d.alertManagers = (b, a) => alertManagers({
    managerRecipients: async () => (await recipients()).map((r) => ({ channel: 'whatsapp' as const, ...r })),
    ready: async () => true,
    log: async (e) => { logs.push(e) },
  }, { whatsapp: (m) => f.d.send(m), telegram: (m) => f.d.send(m) }, b, a, f.d.now())
  return { ...f, logs }
}
const from = ANNA.phone
const corrective = (f: ReturnType<typeof fake>) => f.d.saveToken({ token: 'ct', kind: 'corrective', business_id: 'b', profile_id: 'p1', site_id: 's1', template_id: 't1', item_ids: null, response_id: 'resp0', expires_at: '2099-01-01', used_at: null })

describe('bot', () => {
  it('unknown number and unavailable business', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from: '440000', text: 'hi', id: 'x' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.unknown)
    expect(TEXT.unknown).toBe('Ask your manager to add you to a Blueroll team.')
    const g = fake(undefined, { ready: { b: false } })
    await handleInbound({ kind: 'text', from, text: 'checks', id: 'x' }, g.d)
    expect(textOf(g.sent[0])).toBe(TEXT.unavailable)
  })
  it('STOP revokes; STOP and HELP work even when the business is not ready', async () => {
    const f = fake(undefined, { ready: { b: false } })
    await handleInbound({ kind: 'text', from, text: 'help', id: 'x' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.help)
    await handleInbound({ kind: 'text', from, text: ' Stop ', id: 'x2' }, f.d)
    expect(f.s.identities[0].revoked).toBe(true)
    expect(textOf(f.sent[1])).toBe(TEXT.stopped)
    expect(TEXT.stopped).toBe("You're disconnected from Blueroll. You won't get any more messages. Ask your manager to add you again to reconnect.")
  })
  it('a used or unknown token is refused', async () => {
    const f = fake()
    await handleInbound({ kind: 'flow', from, token: 'nope', response: {}, id: 'y' }, f.d)
    expect(textOf(f.sent[0])).toBe(TEXT.formExpired)
  })
  it('a token of another person is ignored and not burnt', async () => {
    const f = fake()
    await f.d.saveToken({ token: 'ot', kind: 'checklist', business_id: 'b', profile_id: 'someone-else', site_id: 's1', template_id: 't1', item_ids: ['i1'], response_id: null, expires_at: '2099-01-01', used_at: null, group_id: 'g1' })
    await handleInbound({ kind: 'flow', from, token: 'ot', response: { f0: '3' }, id: 'z' }, f.d)
    expect(f.s.completionRows).toHaveLength(0)
    expect(f.tokens.get('ot')!.used_at).toBeNull()
  })
  it('corrective reply closes the response and alerts managers', async () => {
    const f = fake()
    await corrective(f)
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved', details: 'to fridge 2' }, id: 'z' }, f.d)
    expect(f.corrective).toEqual([{ rid: 'resp0', notes: 'Moved food to another fridge: to fridge 2' }])
    expect(f.sent[0].template.name).toBe('manager_alert')
    expect(f.sent[0].template.components[0].parameters[2].text).toBe('9 °C')
    expect(f.sent[0].template.components[0].parameters[3].text).toBe('10:40')
    expect(textOf(f.sent[1])).toBe(TEXT.correctiveThanks)
  })
  it('manager alerts are billable only outside the manager 24h window', async () => {
    const f = fake(async () => [
      { external_id: '447700900901', last_inbound_at: '2026-10-14T01:00:00Z' },
      { external_id: '447700900902', last_inbound_at: '2026-10-13T09:00:00Z' },
      { external_id: '447700900903', last_inbound_at: null },
    ])
    await corrective(f)
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved' }, id: 'z' }, f.d)
    expect(f.logs.filter((l) => l.kind === 'alert').map((l) => l.billable)).toEqual([false, true, true])
  })
  it('corrective alert reaches a Telegram manager as text and a WhatsApp manager as the template', async () => {
    const f = fake(async () => [
      { channel: 'telegram', external_id: '555', last_inbound_at: null },
      { channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null },
    ])
    await corrective(f)
    await handleInbound({ kind: 'flow', from, token: 'ct', response: { action: 'moved' }, id: 'z' }, f.d)
    expect(f.sent[0]).toEqual({ chat_id: '555', text: '⚠ Ashfield Row · Walk-in fridge 9 °C at 10:40 (Anna Smith). Action: Moved food to another fridge. — via Blueroll' })
    expect(f.sent[1]).toMatchObject({ to: '447700900999', template: { name: 'manager_alert' } })
    expect(textOf(f.sent[2])).toBe(TEXT.correctiveThanks)
    expect(f.logs.filter((l) => l.kind === 'alert').map((l) => [l.channel, l.billable])).toEqual([['telegram', false], ['whatsapp', true]])
  })
  it('the same inbound message delivered twice is handled once', async () => {
    const f = fake()
    await handleInbound({ kind: 'text', from, text: 'help', id: 'wamid.DUP' }, f.d)
    await handleInbound({ kind: 'text', from, text: 'help', id: 'wamid.DUP' }, f.d)
    expect(f.sent).toHaveLength(1)
  })
})
