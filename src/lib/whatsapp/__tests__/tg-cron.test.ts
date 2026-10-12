import { describe, it, expect } from 'vitest'
import { runTelegramGroups } from '../../../../supabase/functions/_shared/channels/tg-cron'
import { fakeGroupDeps, fakeTgApi, groupRow, GROUP, NOW, tpl } from './fakes/group-deps'

const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })   // reminder window 09:30–10:00Z; NOW = 09:40Z
const CLEAN = tpl({ id: 'tB', name: 'Cleaning' })
const MAP = [{ group_id: 'g1', template_id: 'tA' }, { group_id: 'g1', template_id: 'tB' }]
const quiet = (m: string) => (m === 'getChat' ? { result: { permissions: { can_invite_users: false } } } : undefined)

describe('runTelegramGroups', () => {
  it('reminder: reposts the group list once per period, then only refreshes', async () => {
    const { d, s } = fakeGroupDeps({ templates: [FRIDGE, CLEAN], mappings: MAP })
    const { api, calls } = fakeTgApi(quiet)
    const r1 = await runTelegramGroups(d, api, NOW)
    expect(r1).toMatchObject({ reposted: 1, failed: 0 })
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1)
    expect(s.reminders).toEqual(new Set(['g1:tA:s1:2026-10-14']))
    calls.length = 0
    const r2 = await runTelegramGroups(d, api, NOW)
    expect(r2).toMatchObject({ reposted: 0, refreshed: 0 })
    expect(calls.map((c) => c.method)).toEqual([])   // permission already checked today, list unchanged
  })
  it('refresh: a completion turns into a ✅ line by edit; everything done → 🎉, removed 10 minutes later', async () => {
    const { d, s } = fakeGroupDeps({ templates: [FRIDGE, CLEAN], mappings: MAP })
    const { api, calls } = fakeTgApi(quiet)
    await runTelegramGroups(d, api, NOW)
    s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:41:00Z', completed_by: null })
    calls.length = 0
    expect(await runTelegramGroups(d, api, NOW)).toMatchObject({ refreshed: 1 })
    expect(calls.map((c) => c.method)).toEqual(['editMessageText'])
    expect(calls[0].body.text).toContain('✅ Fridge temps · 10:41')
    s.completions.push({ template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T09:42:00Z', completed_by: null })
    calls.length = 0
    expect(await runTelegramGroups(d, api, NOW)).toMatchObject({ refreshed: 1 })
    expect(calls.map((c) => [c.method, c.body.text])).toEqual([['sendMessage', '🎉'], ['deleteMessage', undefined]])
    calls.length = 0
    expect(await runTelegramGroups(d, api, new Date(NOW.getTime() + 10 * 60_000))).toMatchObject({ removed: 1 })
    expect(calls.map((c) => c.method)).toEqual(['deleteMessage'])
    expect(s.lists).toEqual([])
  })
  it('a failed reminder send gives the key back so the next run retries', async () => {
    const { d, s } = fakeGroupDeps({ templates: [FRIDGE], mappings: [MAP[0]] })
    const down = fakeTgApi((m) => (m === 'sendMessage' ? { ok: false, status: 429, description: 'Too Many Requests' } : quiet(m)))
    expect(await runTelegramGroups(d, down.api, NOW)).toMatchObject({ failed: 1 })
    expect(s.reminders.size).toBe(0)
    const up = fakeTgApi(quiet)
    expect(await runTelegramGroups(d, up.api, NOW)).toMatchObject({ reposted: 1 })
  })
  it('lists from a previous day are deleted', async () => {
    const { d, s } = fakeGroupDeps({ templates: [CLEAN], mappings: [MAP[1]],
      lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-13', message_id: '50', tokens: {}, rendered_hash: 'h' }] })
    const { api, calls } = fakeTgApi(quiet)
    expect(await runTelegramGroups(d, api, NOW)).toMatchObject({ removed: 1 })
    expect(calls.filter((c) => c.method === 'deleteMessage').map((c) => c.body)).toEqual([{ chat_id: '-1001', message_id: 50 }])
    expect(s.lists).toEqual([])
  })
  it('unlinked in Settings → its lists are taken down', async () => {
    const { d, s } = fakeGroupDeps({ groups: [groupRow(GROUP, { unlinked_at: '2026-10-14T09:00:00Z' })],
      lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '60', tokens: {}, rendered_hash: 'h' }] })
    const { api, calls } = fakeTgApi(quiet)
    expect(await runTelegramGroups(d, api, NOW)).toMatchObject({ removed: 1 })
    expect(calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 60 } }])
    expect(s.lists).toEqual([])
  })
  it('business not ready (Telegram off / subscription lapsed) → lists taken down, nothing sent', async () => {
    const { d, s } = fakeGroupDeps({ ready: { b: false }, templates: [FRIDGE], mappings: [MAP[0]],
      lists: [{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '61', tokens: {}, rendered_hash: 'h' }] })
    const { api, calls } = fakeTgApi(quiet)
    await runTelegramGroups(d, api, NOW)
    expect(calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 61 } }])
    expect(s.lists).toEqual([])
    expect(s.reminders.size).toBe(0)
  })
  it('permission check runs once a day per group and warns when members can invite', async () => {
    const { d, s } = fakeGroupDeps()
    const open = fakeTgApi((m) => (m === 'getChat' ? { result: { permissions: { can_invite_users: true } } } : undefined))
    expect(await runTelegramGroups(d, open.api, NOW)).toMatchObject({ warned: 1 })
    await runTelegramGroups(d, open.api, NOW)
    expect(open.calls.filter((c) => c.method === 'getChat')).toHaveLength(1)
    expect(s.notifications).toHaveLength(1)
  })
  it('orphan cleanup throwing does not stop the per-group work', async () => {
    const { d, s } = fakeGroupDeps({ templates: [FRIDGE], mappings: [MAP[0]] }, { orphanLiveLists: async () => { throw new Error('db down') } })
    const { api } = fakeTgApi(quiet)
    expect(await runTelegramGroups(d, api, NOW)).toMatchObject({ reposted: 1, failed: 1 })
    expect(s.reminders.size).toBe(1)
  })
  it('a group whose deps throw does not stop the next group; a throwing repost releases its keys', async () => {
    const G2 = { id: 'g2', business_id: 'b', channel: 'telegram' as const, chat_id: '-1002', title: 'Bar', alerts: false }
    const { d, s } = fakeGroupDeps({ groups: [groupRow(GROUP), groupRow(G2)], templates: [FRIDGE], mappings: [MAP[0], { group_id: 'g2', template_id: 'tA' }] })
    const real = d.liveLists
    d.liveLists = async (gid) => { if (gid === 'g1') throw new Error('boom'); return real(gid) }
    const { api } = fakeTgApi(quiet)
    expect(await runTelegramGroups(d, api, NOW)).toMatchObject({ reposted: 1, failed: 1 })
    expect(s.reminders).toEqual(new Set(['g2:tA:s1:2026-10-14']))
    // repost throws after the claim: keys are released
    const f2 = fakeGroupDeps({ templates: [FRIDGE], mappings: [MAP[0]] }, { saveLiveList: async () => { throw new Error('db') } })
    const r = await runTelegramGroups(f2.d, fakeTgApi(quiet).api, NOW)
    expect(r.failed).toBe(1)
    expect(f2.s.reminders.size).toBe(0)
  })
})
