// src/lib/whatsapp/__tests__/alerts.test.ts
import { describe, it, expect } from 'vitest'
import { alertManagers, makeAlertDeps, alertGroups, alertTelegramAlertsGroups, groupAlertText, type AlertDeps, type AlertRecipient } from '../../../../supabase/functions/_shared/channels/alerts'
import { makeDeps } from '../../../../supabase/functions/_shared/channels/db'
import { whatsappUI } from '../../../../supabase/functions/_shared/channels/ui'
import { fakeGroupDeps, fakeTgApi, groupRow, GROUP } from './fakes/group-deps'
import { fakeTeamDeps } from './fakes/team-deps'
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

describe('makeAlertDeps.managerRecipients', () => {
  it('reads WhatsApp identities only (group members\' Telegram identities never get personal alerts)', async () => {
    const calls: string[] = []
    const table = (t: string, rows: any[]) => {
      const q: any = {}
      for (const m of ['select', 'eq', 'in', 'is']) q[m] = (...args: any[]) => { calls.push(`${t}.${m}${JSON.stringify(args)}`); return q }
      q.then = (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej)
      return q
    }
    const admin = { from: (t: string) => table(t, t === 'profiles' ? [{ id: 'm1' }] : [{ channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null }]) }
    expect(await makeAlertDeps(admin).managerRecipients('b')).toEqual([{ channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null }])
    expect(calls).toContain('channel_identities.eq["channel","whatsapp"]')
    expect(calls.some((c) => c.includes('telegram'))).toBe(false)
  })
})

describe('alertGroups', () => {
  it('source group + every alerts group, once each; a kicked bot unlinks that group', async () => {
    const g2 = groupRow({ id: 'g2', business_id: 'b', channel: 'telegram', chat_id: '-1002', title: 'Managers', alerts: true })
    const g3 = groupRow({ id: 'g3', business_id: 'b', channel: 'telegram', chat_id: '-1003', title: 'Owners', alerts: true })
    const { d, s } = fakeGroupDeps({ groups: [groupRow(GROUP), g2, g3] })
    const { api, calls } = fakeTgApi((_m, body) => (body.chat_id === '-1003' ? { ok: false, status: 403, description: 'Forbidden: bot was kicked from the group chat' } : undefined))
    await alertGroups(d, api, 'b', 'g1', A)
    expect(calls.map((c) => c.body)).toEqual([
      { chat_id: '-1001', text: groupAlertText(A) }, { chat_id: '-1002', text: groupAlertText(A) }, { chat_id: '-1003', text: groupAlertText(A) },
    ])
    expect(groupAlertText(A)).toBe('⚠ Wharf Side · Walk-in fridge 9 °C at 10:40 (Anna). Action: Moved food to another fridge. — via Blueroll')
    expect(s.groups.find((g) => g.id === 'g3')!.unlinked_at).not.toBeNull()
  })
  it('a source group of another business is ignored', async () => {
    const { d } = fakeGroupDeps({ groups: [groupRow({ ...GROUP, business_id: 'other' })] })
    const { api, calls } = fakeTgApi()
    await alertGroups(d, api, 'b', 'g1', A)
    expect(calls).toEqual([])
  })
})

describe('WhatsApp-origin alerts → Telegram "Alerts" groups (spec §2)', () => {
  const kitchen = groupRow(GROUP)   // not an alerts group: no source group on the WhatsApp path
  const managers = groupRow({ id: 'g2', business_id: 'b', channel: 'telegram', chat_id: '-1002', title: 'Managers', alerts: true })
  const otherBiz = groupRow({ id: 'g9', business_id: 'other', channel: 'telegram', chat_id: '-1009', title: 'Other', alerts: true })

  it('every Alerts group of the business, plain group text; not the other groups or businesses', async () => {
    const { d } = fakeGroupDeps({ groups: [kitchen, managers, otherBiz] })
    const { api, calls } = fakeTgApi()
    await alertTelegramAlertsGroups({ g: d, api }, 'b', A)
    expect(calls).toEqual([{ method: 'sendMessage', body: { chat_id: '-1002', text: groupAlertText(A) } }])
  })
  it('business cannot use Telegram → nothing sent; a failing lookup never throws', async () => {
    const off = fakeGroupDeps({ groups: [managers], ready: { b: false } })
    const t1 = fakeTgApi()
    await alertTelegramAlertsGroups({ g: off.d, api: t1.api }, 'b', A)
    expect(t1.calls).toEqual([])
    const broken = fakeGroupDeps({ groups: [managers] }, { alertGroups: async () => { throw new Error('db down') } })
    const t2 = fakeTgApi()
    await expect(alertTelegramAlertsGroups({ g: broken.d, api: t2.api }, 'b', A)).resolves.toBeUndefined()
    expect(t2.calls).toEqual([])
  })

  // makeDeps (WhatsApp bot) wiring: WhatsApp managers personally + Telegram Alerts groups; groups still told when the
  // manager lookup fails, and that failure still surfaces as before.
  const fakeAdmin = (failIdentities = false) => {
    const table = (t: string) => {
      const q: any = {}
      for (const m of ['select', 'eq', 'in', 'is', 'insert']) q[m] = () => q
      q.then = (res: any, rej: any) => Promise.resolve(
        t === 'channel_identities' && failIdentities ? { data: null, error: { message: 'boom' } }
          : { data: t === 'profiles' ? [{ id: 'm1' }] : t === 'channel_identities' ? [{ channel: 'whatsapp', external_id: '447700900999', last_inbound_at: null }] : null, error: null },
      ).then(res, rej)
      return q
    }
    return { from: table, rpc: () => Promise.resolve({ data: true, error: null }) }
  }
  it('makeDeps.alertManagers: WhatsApp manager gets the template and the Telegram Alerts group gets the text', async () => {
    const wa: any[] = []
    const send = async (m: any) => { wa.push(m); return { id: 'w1', ok: true, status: 200 } }
    const { d: g } = fakeGroupDeps({ groups: [kitchen, managers] })
    const { api, calls } = fakeTgApi()
    const deps = makeDeps(fakeAdmin(), { channel: 'whatsapp', ui: whatsappUI(), send, telegramAlertGroups: { g, api }, teams: fakeTeamDeps().d })
    await deps.alertManagers('b', A)
    expect(wa.map((m) => [m.to, m.template?.name])).toEqual([['447700900999', 'manager_alert']])
    expect(calls).toEqual([{ method: 'sendMessage', body: { chat_id: '-1002', text: groupAlertText(A) } }])
  })
  it('makeDeps.alertManagers: groups are told even when the manager lookup fails (the failure still surfaces)', async () => {
    const send = async () => ({ id: 'w1', ok: true, status: 200 })
    const { d: g } = fakeGroupDeps({ groups: [managers] })
    const t = fakeTgApi()
    const deps = makeDeps(fakeAdmin(true), { channel: 'whatsapp', ui: whatsappUI(), send, telegramAlertGroups: { g, api: t.api }, teams: fakeTeamDeps().d })
    await expect(deps.alertManagers('b', A)).rejects.toMatchObject({ message: 'boom' })
    expect(t.calls.map((c) => c.body.chat_id)).toEqual(['-1002'])
  })
})
