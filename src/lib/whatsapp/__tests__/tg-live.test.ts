// src/lib/whatsapp/__tests__/tg-live.test.ts
import { describe, it, expect } from 'vitest'
import { repostList, repostGroup, refreshList, refreshGroupSite, unlinkGroup } from '../../../../supabase/functions/_shared/channels/tg-live'
import { miniAppLink } from '../../../../supabase/functions/_shared/channels/telegram'
import { fakeGroupDeps, fakeTgApi, NOW, GROUP, SITE, tpl } from './fakes/group-deps'

const link = (t: string) => miniAppLink(t)
const FRIDGE = tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00' })   // 10:00Z → 🟠 at 09:40Z
const CLEAN = tpl({ id: 'tB', name: 'Cleaning' })
const MAP = [{ group_id: 'g1', template_id: 'tA' }, { group_id: 'g1', template_id: 'tB' }]
const setup = (init = {}) => fakeGroupDeps({ templates: [FRIDGE, CLEAN], mappings: MAP, ...init })
const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }

describe('repostList', () => {
  it('sends the list (notifying), stores the row with fresh tokens', async () => {
    const { d, s } = setup()
    const { api, calls } = fakeTgApi()
    expect(await repostList(d, api, GROUP, SITE, NOW)).toBe('posted')
    expect(calls).toEqual([{ method: 'sendMessage', body: {
      chat_id: '-1001', ...HTML,
      text: '📋 <b>Wharf Side</b> — 0 of 2 done\n🟠 Fridge temps · due 11:00\n⚪ Cleaning',
      reply_markup: { inline_keyboard: [[{ text: '🟠 Fridge temps', url: link('tok1') }], [{ text: '⚪ Cleaning', url: link('tok2') }]] },
    } }])
    expect(s.lists).toEqual([{ id: 'l1', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '101', tokens: { tA: 'tok1', tB: 'tok2' }, rendered_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }])
    expect(s.tokens.map((t) => [t.token, t.kind, t.group_id, t.site_id, t.template_id, t.item_ids, t.expires_at, t.used_at])).toEqual([
      ['tok1', 'group_checklist', 'g1', 's1', 'tA', ['i1'], '2026-10-15T09:40:00.000Z', null],
      ['tok2', 'group_checklist', 'g1', 's1', 'tB', ['i1'], '2026-10-15T09:40:00.000Z', null],
    ])
  })
  it('a second repost sends a new message first, then deletes the previous one; tokens are fresh', async () => {
    const { d, s } = setup()
    const { api, calls } = fakeTgApi()
    await repostList(d, api, GROUP, SITE, NOW)
    await repostList(d, api, GROUP, SITE, NOW)
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'sendMessage', 'deleteMessage'])
    expect(calls[2].body).toEqual({ chat_id: '-1001', message_id: 101 })
    expect(s.lists).toHaveLength(1)
    expect(s.lists[0]).toMatchObject({ message_id: '102', tokens: { tA: 'tok3', tB: 'tok4' } })
  })
  it('a repost expires the previous list\'s unused tokens (old forms are rejected)', async () => {
    const { d, s } = setup()
    const { api } = fakeTgApi()
    await repostList(d, api, GROUP, SITE, NOW)
    await repostList(d, api, GROUP, SITE, NOW)
    expect(await d.takeGroupToken('tok1', NOW, 'Maria')).toBeNull()
    expect(await d.takeGroupToken('tok2', NOW, 'Maria')).toBeNull()
    expect(await d.takeGroupToken('tok3', NOW, 'Maria')).not.toBeNull()
    expect(s.tokens.find((t) => t.token === 'tok4')!.expires_at).toBe('2026-10-15T09:40:00.000Z')
  })
  it('app-only checklist (required photo): listed without a button, no token', async () => {
    const { d, s } = setup({ items: { tB: [{ id: 'ip', name: 'Label photo', item_type: 'photo', required: true, min_value: null, max_value: null, unit: null, sort_order: 0 }] } })
    const { api, calls } = fakeTgApi()
    await repostList(d, api, GROUP, SITE, NOW)
    expect(calls[0].body.text).toBe('📋 <b>Wharf Side</b> — 0 of 2 done\n🟠 Fridge temps · due 11:00\n⚪ Cleaning · app only')
    expect(calls[0].body.reply_markup.inline_keyboard).toEqual([[{ text: '🟠 Fridge temps', url: link('tok1') }]])
    expect(s.lists[0].tokens).toEqual({ tA: 'tok1' })
  })
  it('nothing open → nothing sent, an existing list is taken down', async () => {
    const done = [{ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T08:00:00Z', completed_by: 'p1' }, { template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T08:10:00Z', completed_by: 'p1' }]
    const { d, s } = setup({ completions: done, lists: [{ id: 'l9', group_id: 'g1', site_id: 's1', list_date: '2026-10-14', message_id: '55', tokens: {}, rendered_hash: 'x' }] })
    const { api, calls } = fakeTgApi()
    expect(await repostList(d, api, GROUP, SITE, NOW)).toBe('empty')
    expect(calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 55 } }])
    expect(s.lists).toEqual([])
  })
  it('bot kicked → group unlinked; other send errors → failed, row untouched', async () => {
    const a = setup()
    const kicked = fakeTgApi((m) => (m === 'sendMessage' ? { ok: false, status: 403, description: 'Forbidden: bot was kicked from the supergroup chat' } : undefined))
    expect(await repostList(a.d, kicked.api, GROUP, SITE, NOW)).toBe('unlinked')
    expect(a.s.groups[0].unlinked_at).not.toBeNull()
    const b = setup()
    const busy = fakeTgApi((m) => (m === 'sendMessage' ? { ok: false, status: 429, description: 'Too Many Requests' } : undefined))
    expect(await repostList(b.d, busy.api, GROUP, SITE, NOW)).toBe('failed')
    expect(b.s.lists).toEqual([])
  })
  it("a single 'chat not found' on send unlinks the group (tgOutcome maps it to kicked; the brief does not debounce)", async () => {
    const { d, s } = setup()
    const t = fakeTgApi((m) => (m === 'sendMessage' ? { ok: false, status: 400, description: 'Bad Request: chat not found' } : undefined))
    expect(await repostList(d, t.api, GROUP, SITE, NOW)).toBe('unlinked')
    expect(s.groups[0].unlinked_at).not.toBeNull()
  })
  it('repostGroup posts one list per site where a mapped checklist applies', async () => {
    const S2 = { id: 's2', name: 'Harbour', timezone: 'Europe/London' }
    const S3 = { id: 's3', name: 'Depot', timezone: 'Europe/London' }
    const { d, s } = setup({ sites: [SITE, S2, S3], templates: [FRIDGE, { ...CLEAN, site_id: 's2' }] })
    const { api } = fakeTgApi()
    expect(await repostGroup(d, api, GROUP, NOW)).toEqual(['posted', 'posted', 'posted'])
    expect(s.lists.map((l) => l.site_id)).toEqual(['s1', 's2', 's3'])
    const only = setup({ sites: [SITE, S2], templates: [{ ...FRIDGE, site_id: 's2' }, { ...CLEAN, site_id: 's2' }] })
    expect(await repostGroup(only.d, fakeTgApi().api, GROUP, NOW)).toEqual(['posted'])
  })
})

describe('refreshList', () => {
  const posted = async (init = {}) => {
    const f = setup(init)
    const t = fakeTgApi()
    await repostList(f.d, t.api, GROUP, SITE, NOW)
    t.calls.length = 0
    return { ...f, ...t }
  }
  it('nothing changed → no API call', async () => {
    const f = await posted()
    expect(await refreshList(f.d, f.api, GROUP, f.s.lists[0], SITE, NOW)).toBe('unchanged')
    expect(f.calls).toEqual([])
  })
  it('a completion from the app → silent edit with a ✅ line; unused tokens are kept', async () => {
    const f = await posted({ names: { p9: 'Maria' } })
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:30:00Z', completed_by: 'p9' })
    expect(await refreshList(f.d, f.api, GROUP, f.s.lists[0], SITE, NOW)).toBe('edited')
    expect(f.calls).toEqual([{ method: 'editMessageText', body: {
      chat_id: '-1001', message_id: 101, ...HTML,
      text: '📋 <b>Wharf Side</b> — 1 of 2 done\n⚪ Cleaning\n✅ Fridge temps · 10:30 Maria',
      reply_markup: { inline_keyboard: [[{ text: '⚪ Cleaning', url: link('tok2') }]] },
    } }])
    expect(f.s.lists[0].tokens).toEqual({ tB: 'tok2' })
  })
  it('everything done → message deleted and row removed', async () => {
    const f = await posted()
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:30:00Z', completed_by: null }, { template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T09:31:00Z', completed_by: null })
    expect(await refreshList(f.d, f.api, GROUP, f.s.lists[0], SITE, NOW)).toBe('deleted')
    expect(f.calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 101 } }])
    expect(f.s.lists).toEqual([])
  })
  it('a list from a previous local day is deleted without minting tokens', async () => {
    const f = await posted()
    const before = f.s.tokens.length
    expect(await refreshList(f.d, f.api, GROUP, { ...f.s.lists[0], list_date: '2026-10-13' }, SITE, NOW)).toBe('deleted')
    expect(f.calls.map((c) => c.method)).toEqual(['deleteMessage'])
    expect(f.s.tokens).toHaveLength(before)
  })
  it('site gone (removed / no mapped checklist there any more) → deleted', async () => {
    const f = await posted()
    expect(await refreshList(f.d, f.api, GROUP, f.s.lists[0], null, NOW)).toBe('deleted')
    expect(f.s.lists).toEqual([])
  })
  it('a used token is replaced (multi-per-day checklist still open after the first submit)', async () => {
    const f = await posted({ templates: [tpl({ id: 'tA', name: 'Fridge temps', deadline_time: '11:00', multi_per_day: true, min_per_day: 3 }), CLEAN] })
    f.s.tokens[0].used_at = '2026-10-14T09:35:00.000Z'
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:35:00Z', completed_by: 'p1' })
    expect(await refreshList(f.d, f.api, GROUP, f.s.lists[0], SITE, NOW)).toBe('edited')
    expect(f.calls[0].body.reply_markup.inline_keyboard[0][0].url).toBe(link('tok3'))
    expect(f.s.lists[0].tokens).toEqual({ tA: 'tok3', tB: 'tok2' })
  })
  it('Telegram errors: not found → row dropped; not modified → success; kicked → unlinked; other → kept for retry', async () => {
    const run = async (r: object) => {
      const f = await posted()
      f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:30:00Z', completed_by: null })
      const t = fakeTgApi((m) => (m === 'editMessageText' ? r : undefined))
      const out = await refreshList(f.d, t.api, GROUP, f.s.lists[0], SITE, NOW)
      return { out, f }
    }
    const gone = await run({ ok: false, status: 400, description: 'Bad Request: message to edit not found' })
    expect(gone.out).toBe('deleted'); expect(gone.f.s.lists).toEqual([])
    const same = await run({ ok: false, status: 400, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' })
    expect(same.out).toBe('edited'); expect(same.f.s.lists[0].tokens).toEqual({ tB: 'tok2' })
    const kicked = await run({ ok: false, status: 403, description: 'Forbidden: bot was kicked from the supergroup chat' })
    expect(kicked.out).toBe('unlinked'); expect(kicked.f.s.groups[0].unlinked_at).not.toBeNull(); expect(kicked.f.s.lists).toEqual([])
    const busy = await run({ ok: false, status: 429, description: 'Too Many Requests: retry after 5' })
    expect(busy.out).toBe('failed'); expect(busy.f.s.lists[0].tokens).toEqual({ tA: 'tok1', tB: 'tok2' })
  })
})

describe('refreshList races (compare-and-set)', () => {
  const posted = async () => {
    const f = setup(); const t = fakeTgApi()
    await repostList(f.d, t.api, GROUP, SITE, NOW)
    return f
  }
  it('(a) a refresh that read the row before a repost does not delete the new row or message', async () => {
    const f = await posted()
    const stale = { ...f.s.lists[0] }
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:30:00Z', completed_by: null })
    // the repost lands while the stale refresh is editing the (now deleted) old message
    let once = true
    const t = fakeTgApi((m) => {
      if (m !== 'editMessageText' || !once) return undefined
      once = false
      f.s.lists[0] = { ...f.s.lists[0], message_id: '777', tokens: { tB: 'tokX' }, rendered_hash: 'new' }
      return { ok: false, status: 400, description: 'Bad Request: message to edit not found' }
    })
    await refreshList(f.d, t.api, GROUP, stale, SITE, NOW)
    expect(f.s.lists).toHaveLength(1)
    expect(f.s.lists[0].message_id).not.toBe('101')
    expect(t.calls.filter((c) => c.method === 'deleteMessage' && c.body.message_id === 777)).toEqual([])
  })
  it('(a2) stale all-done refresh does not delete a reposted message', async () => {
    const f = await posted()
    const stale = { ...f.s.lists[0] }
    f.s.lists[0] = { ...stale, message_id: '777' }
    const t = fakeTgApi()
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:30:00Z', completed_by: null }, { template_id: 'tB', site_id: 's1', completed_at: '2026-10-14T09:31:00Z', completed_by: null })
    await refreshList(f.d, t.api, GROUP, stale, SITE, NOW)
    expect(t.calls.filter((c) => c.method === 'deleteMessage' && c.body.message_id === 101)).toEqual([])
  })
  it('(b) a lost update is retried: the stored row ends up matching the last edit', async () => {
    const f = await posted()
    const stale = { ...f.s.lists[0] }
    f.s.completions.push({ template_id: 'tA', site_id: 's1', completed_at: '2026-10-14T09:30:00Z', completed_by: null })
    let n = 0
    const t = fakeTgApi((m) => {
      if (m === 'editMessageText' && ++n === 1) f.s.lists[0] = { ...f.s.lists[0], rendered_hash: 'other-writer', tokens: { tA: 'tokY', tB: 'tok2' } }
      return undefined
    })
    expect(await refreshList(f.d, t.api, GROUP, stale, SITE, NOW)).toBe('edited')
    expect(t.calls.filter((c) => c.method === 'editMessageText')).toHaveLength(2)
    const last = t.calls.filter((c) => c.method === 'editMessageText')[1].body
    expect(last.reply_markup.inline_keyboard[0][0].url).toBe(link(f.s.lists[0].tokens.tB))
    expect(f.s.lists[0].rendered_hash).not.toBe('other-writer')
  })
})

describe('refreshGroupSite / unlinkGroup', () => {
  it('refreshGroupSite: null when the group has no list at that site', async () => {
    const { d } = setup()
    expect(await refreshGroupSite(d, fakeTgApi().api, 'g1', 's1', NOW)).toBeNull()
  })
  it('unlinkGroup deletes the list messages, the rows, and marks the group unlinked', async () => {
    const { d, s } = setup()
    const { api, calls } = fakeTgApi()
    await repostList(d, api, GROUP, SITE, NOW)
    calls.length = 0
    await unlinkGroup(d, api, GROUP, NOW)
    expect(calls).toEqual([{ method: 'deleteMessage', body: { chat_id: '-1001', message_id: 101 } }])
    expect(s.lists).toEqual([])
    expect(s.groups[0].unlinked_at).toBe(NOW.toISOString())
  })
})
