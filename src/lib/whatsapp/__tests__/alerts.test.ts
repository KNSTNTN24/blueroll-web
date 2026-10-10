// src/lib/whatsapp/__tests__/alerts.test.ts
import { describe, it, expect } from 'vitest'
import { alertManagers, type AlertDeps, type AlertRecipient } from '../../../../supabase/functions/_shared/channels/alerts'
import type { SendFn } from '../../../../supabase/functions/_shared/channels/types'

const NOW = new Date('2026-10-14T09:40:00Z')
const A = { siteName: 'Wharf Side', itemName: 'Walk-in fridge', value: '9 °C', time: '10:40', byName: 'Anna', action: 'Moved food to another fridge' }

function fakeAlerts(recipients: AlertRecipient[], ready: Partial<Record<string, boolean>> = { whatsapp: true, telegram: true }) {
  const logs: any[] = []; const readyAsked: string[] = []
  const deps: AlertDeps = {
    managerRecipients: async () => recipients,
    ready: async (_b, ch) => { readyAsked.push(ch); return !!ready[ch] },
    log: async (e) => { logs.push(e) },
  }
  const sent: Record<string, any[]> = { whatsapp: [], telegram: [] }
  const sender = (ch: string): SendFn => async (m) => { sent[ch].push(m); return { id: ch + sent[ch].length, ok: true, status: 200 } }
  return { deps, logs, sent, readyAsked, senders: { whatsapp: sender('whatsapp'), telegram: sender('telegram') } }
}

describe('alertManagers (cross-channel)', () => {
  it('Telegram manager gets a text alert, WhatsApp manager gets the template', async () => {
    const f = fakeAlerts([
      { channel: 'telegram', external_id: '555', last_inbound_at: null },
      { channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null },
    ])
    await alertManagers(f.deps, f.senders, 'b', A, NOW)
    expect(f.sent.telegram).toEqual([{ chat_id: '555', text: '⚠ Wharf Side · Walk-in fridge 9 °C at 10:40 (Anna). Action: Moved food to another fridge. — via Blueroll' }])
    expect(f.sent.whatsapp).toHaveLength(1)
    expect(f.sent.whatsapp[0].to).toBe('447700900999')
    expect(f.sent.whatsapp[0].template.name).toBe('manager_alert')
    expect(f.sent.whatsapp[0].template.components[0].parameters.map((p: any) => p.text)).toEqual(['Wharf Side', 'Walk-in fridge', '9 °C', '10:40', 'Anna', 'Moved food to another fridge'])
    expect(f.logs).toEqual([
      { business_id: 'b', site_id: null, profile_id: null, channel: 'telegram', direction: 'out', kind: 'alert', template_name: undefined, billable: false, wa_message_id: 'telegram1' },
      { business_id: 'b', site_id: null, profile_id: null, channel: 'whatsapp', direction: 'out', kind: 'alert', template_name: 'manager_alert', billable: true, wa_message_id: 'whatsapp1' },
    ])
  })
  it('WhatsApp billable only outside the 24h window; Telegram never billable', async () => {
    const f = fakeAlerts([
      { channel: 'whatsapp', external_id: '1', last_inbound_at: '2026-10-14T01:00:00Z' },
      { channel: 'whatsapp', external_id: '2', last_inbound_at: '2026-10-13T09:00:00Z' },
      { channel: 'telegram', external_id: '3', last_inbound_at: '2026-10-01T00:00:00Z' },
    ])
    await alertManagers(f.deps, f.senders, 'b', A, NOW)
    expect(f.logs.map((l) => [l.channel, l.billable])).toEqual([['whatsapp', false], ['whatsapp', true], ['telegram', false]])
  })
  it('a channel that is not ready for the business is skipped (ready asked once per channel)', async () => {
    const f = fakeAlerts([
      { channel: 'telegram', external_id: '555', last_inbound_at: null },
      { channel: 'telegram', external_id: '556', last_inbound_at: null },
      { channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null },
    ], { whatsapp: true, telegram: false })
    await alertManagers(f.deps, f.senders, 'b', A, NOW)
    expect(f.sent.telegram).toHaveLength(0)
    expect(f.sent.whatsapp).toHaveLength(1)
    expect(f.logs.map((l) => l.channel)).toEqual(['whatsapp'])
    expect(f.readyAsked.sort()).toEqual(['telegram', 'whatsapp'])
  })
  it('a channel without a sender is skipped', async () => {
    const f = fakeAlerts([
      { channel: 'telegram', external_id: '555', last_inbound_at: null },
      { channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null },
    ])
    await alertManagers(f.deps, { whatsapp: f.senders.whatsapp }, 'b', A, NOW)
    expect(f.sent.telegram).toHaveLength(0)
    expect(f.sent.whatsapp).toHaveLength(1)
    expect(f.readyAsked).toEqual(['whatsapp'])
  })
  it('a failed WhatsApp send is not billable', async () => {
    const f = fakeAlerts([{ channel: 'whatsapp', external_id: '1', last_inbound_at: null }])
    await alertManagers(f.deps, { whatsapp: async () => ({ id: null, ok: false, status: 500 }) }, 'b', A, NOW)
    expect(f.logs[0]).toMatchObject({ billable: false, wa_message_id: null })
  })
  it('a throwing ready() for one channel does not stop the other channel', async () => {
    const f = fakeAlerts([
      { channel: 'telegram', external_id: '555', last_inbound_at: null },
      { channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null },
    ])
    f.deps.ready = async (_b, ch) => { if (ch === 'telegram') throw new Error('rpc down'); return true }
    await alertManagers(f.deps, f.senders, 'b', A, NOW)
    expect(f.sent.telegram).toHaveLength(0)
    expect(f.sent.whatsapp).toHaveLength(1)
  })
  it('a throwing send for one recipient does not stop the next', async () => {
    const f = fakeAlerts([
      { channel: 'telegram', external_id: '555', last_inbound_at: null },
      { channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null },
    ])
    f.senders.telegram = async () => { throw new Error('boom') }
    await alertManagers(f.deps, f.senders, 'b', A, NOW)
    expect(f.sent.whatsapp).toHaveLength(1)
  })
})
