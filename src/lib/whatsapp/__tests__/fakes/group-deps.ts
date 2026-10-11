// src/lib/whatsapp/__tests__/fakes/group-deps.ts
// In-memory GroupDeps + Bot API fake for the Telegram group tests (live list, group bot, cron, form API).
import type { GroupDeps, GroupFormToken, LiveListRow, ChannelGroup, CompletionWho } from '../../../../../supabase/functions/_shared/channels/groups-db'
import type { TgApi, TgApiResult } from '../../../../../supabase/functions/_shared/channels/telegram'
import type { Person, Template, TemplateItem } from '../../../../../supabase/functions/_shared/checklists-core/types'
import type { SiteInfo } from '../../../../../supabase/functions/_shared/channels/bot'

export const NOW = new Date('2026-10-14T09:40:00Z')   // 10:40 Europe/London (BST)
export const GROUP: ChannelGroup = { id: 'g1', business_id: 'b', channel: 'telegram', chat_id: '-1001', title: 'Kitchen', alerts: false }
export const SITE: SiteInfo = { id: 's1', name: 'Wharf Side', timezone: 'Europe/London' }
export const TEMP_ITEM: TemplateItem = { id: 'i1', name: 'Walk-in fridge', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C', sort_order: 0 }
export const tpl = (o: Partial<Template> & { id: string; name: string }): Template => ({
  business_id: 'b', site_id: null, frequency: 'daily', deadline_time: null, multi_per_day: false, min_per_day: null,
  assigned_roles: [], assigned_role_ids: [], active: true, ...o,
})

type GroupRow = ChannelGroup & { unlinked_at: string | null; linked_by: string | null; perm_check: string | null; perm_warn: string | null }
export interface FakeState {
  groups: GroupRow[]
  mappings: { group_id: string; template_id: string }[]
  templates: Template[]
  items: Record<string, TemplateItem[]>
  sites: SiteInfo[]
  completions: CompletionWho[]
  names: Record<string, string>
  lists: LiveListRow[]
  tokens: GroupFormToken[]
  codes: { code: string; business_id: string; issued_by: string; expires_at: string; used_at: string | null }[]
  linkFails: { chatId: string; at: Date }[]
  reminders: Set<string>
  inbound: Set<string>
  ready: Record<string, boolean>
  businessNames: Record<string, string>
  identities: { business_id: string; tg_user_id: string; profile_id: string }[]
  people: Person[]
  created: { businessId: string; siteId: string; tgUserId: string; displayName: string }[]
  completionRows: any[]
  responses: any[]
  notifications: any[]
}

export const groupRow = (g: ChannelGroup, o: Partial<GroupRow> = {}): GroupRow => ({ ...g, unlinked_at: null, linked_by: 'm1', perm_check: null, perm_warn: null, ...o })

export function fakeGroupDeps(init: Partial<FakeState> = {}, over: Partial<GroupDeps> = {}) {
  const s: FakeState = {
    groups: [groupRow(GROUP)], mappings: [], templates: [], items: {}, sites: [SITE], completions: [], names: {}, lists: [],
    tokens: [], codes: [], linkFails: [], reminders: new Set(), inbound: new Set(), ready: { b: true }, businessNames: { b: 'Fern & Fig' },
    identities: [], people: [], created: [], completionRows: [], responses: [], notifications: [], ...init,
  }
  let tokN = 0; let listN = 0; let personN = 0
  const DAY = 86400_000
  const pub = (g: GroupRow): ChannelGroup => ({ id: g.id, business_id: g.business_id, channel: g.channel, chat_id: g.chat_id, title: g.title, alerts: g.alerts })
  const daily = (g: GroupRow, k: 'perm_check' | 'perm_warn', now: Date) => {
    if (g[k] && now.getTime() - new Date(g[k]!).getTime() < DAY) return false
    g[k] = now.toISOString(); return true
  }
  const d: GroupDeps = {
    now: () => NOW,
    newToken: () => `tok${++tokN}`,
    claimInbound: async (id) => { if (s.inbound.has(id)) return false; s.inbound.add(id); return true },
    ready: async (b) => !!s.ready[b],
    businessName: async (b) => s.businessNames[b] ?? 'your team',
    groupByChat: async (c) => { const g = s.groups.find((x) => x.chat_id === c && !x.unlinked_at); return g ? pub(g) : null },
    groupById: async (id) => { const g = s.groups.find((x) => x.id === id && !x.unlinked_at); return g ? pub(g) : null },
    linkedGroups: async () => s.groups.filter((g) => !g.unlinked_at).map(pub),
    alertGroups: async (b) => s.groups.filter((g) => g.business_id === b && g.alerts && !g.unlinked_at).map(pub),
    claimGroupLinkCode: async (code, now) => {
      const c = s.codes.find((x) => x.code === code && !x.used_at && new Date(x.expires_at) > now)
      if (!c) return null
      c.used_at = now.toISOString()
      return { business_id: c.business_id, issued_by: c.issued_by }
    },
    releaseGroupLinkCode: async (code, at) => { const c = s.codes.find((x) => x.code === code && x.used_at === at); if (c) c.used_at = null },
    linkFailures: async (chatId, since) => s.linkFails.filter((f) => f.chatId === chatId && f.at >= since).length,
    recordLinkFailure: async (chatId, at) => { s.linkFails.push({ chatId, at }) },
    linkGroup: async (a) => {
      let g = s.groups.find((x) => x.chat_id === a.chat_id)
      if (g) {
        const id = g.id; s.mappings = s.mappings.filter((m) => m.group_id !== id); g.alerts = false   // any relink starts clean
        Object.assign(g, { business_id: a.business_id, title: a.title, linked_by: a.linked_by, unlinked_at: null })
      } else {
        g = groupRow({ id: `g${s.groups.length + 1}`, business_id: a.business_id, channel: 'telegram', chat_id: a.chat_id, title: a.title, alerts: false }, { linked_by: a.linked_by })
        s.groups.push(g)
      }
      return pub(g)
    },
    markGroupUnlinked: async (id, now) => { const g = s.groups.find((x) => x.id === id && !x.unlinked_at); if (g) g.unlinked_at = now.toISOString() },
    migrateGroupChat: async (o, n) => { for (const g of s.groups) if (g.chat_id === o) g.chat_id = n },
    claimPermissionCheck: async (id, now) => daily(s.groups.find((x) => x.id === id)!, 'perm_check', now),
    claimPermissionWarning: async (id, now) => daily(s.groups.find((x) => x.id === id)!, 'perm_warn', now),
    mappedTemplates: async (gid) => s.templates.filter((t) => t.active && s.mappings.some((m) => m.group_id === gid && m.template_id === t.id)),
    sites: async () => s.sites,
    completionsSince: async (_b, since) => s.completions.filter((c) => new Date(c.completed_at) >= since),
    // s.names first, else the first word of a fake person's full name (as the real query does).
    firstNames: async (ids) => new Map(ids.flatMap((i) => {
      const n = s.names[i] ?? s.people.find((p) => p.profile_id === i)?.full_name.split(' ')[0]
      return n ? [[i, n] as [string, string]] : []
    })),
    items: async (tid) => s.items[tid] ?? [TEMP_ITEM],
    liveLists: async (gid) => s.lists.filter((l) => l.group_id === gid).map((l) => ({ ...l })),
    orphanLiveLists: async () => s.lists.flatMap((l) => {
      const g = s.groups.find((x) => x.id === l.group_id)
      return g?.unlinked_at ? [{ row: { ...l }, chat_id: g.chat_id }] : []
    }),
    saveLiveList: async (r) => {
      const i = s.lists.findIndex((l) => l.group_id === r.group_id && l.site_id === r.site_id)
      const row = { id: i >= 0 ? s.lists[i].id : `l${++listN}`, ...r }
      if (i >= 0) s.lists[i] = row; else s.lists.push(row)
    },
    updateLiveList: async (r, p) => {
      const l = s.lists.find((x) => x.id === r.id && x.message_id === r.message_id && x.rendered_hash === r.rendered_hash)
      if (!l) return false
      Object.assign(l, p); return true
    },
    deleteLiveList: async (id, mid) => {
      const n = s.lists.length
      s.lists = s.lists.filter((l) => !(l.id === id && l.message_id === mid))
      return s.lists.length < n
    },
    saveGroupToken: async (t) => { s.tokens.push({ ...t }) },
    // Like the real query: only group tokens are visible (an old personal 'checklist' token reads as unknown).
    peekGroupToken: async (tok) => { const t = s.tokens.find((x) => x.token === tok && x.kind === 'group_checklist'); return t ? { ...t } : null },
    takeGroupToken: async (tok, now, by) => {
      const t = s.tokens.find((x) => x.token === tok && x.kind === 'group_checklist')
      if (!t || t.used_at || new Date(t.expires_at) <= now) return null
      t.used_at = now.toISOString(); t.used_by_name = by
      return { ...t }
    },
    expireTokens: async (toks) => { for (const t of s.tokens) if (toks.includes(t.token) && !t.used_at) t.expires_at = NOW.toISOString() },
    releaseGroupToken: async (tok, at) => { const t = s.tokens.find((x) => x.token === tok && x.used_at === at); if (t) { t.used_at = null; t.used_by_name = null } },
    claimGroupReminders: async (gid, sid, keys) => {
      const out = new Set<string>()
      for (const k of keys) {
        const key = `${gid}:${k.template_id}:${sid}:${k.period_key}`
        if (!s.reminders.has(key)) { s.reminders.add(key); out.add(`${k.template_id}:${k.period_key}`) }
      }
      return out
    },
    releaseGroupReminders: async (gid, sid, keys) => { for (const k of keys) s.reminders.delete(`${gid}:${k.template_id}:${sid}:${k.period_key}`) },
    person: async (pid) => s.people.find((p) => p.profile_id === pid) ?? null,
    telegramIdentity: async (b, uid) => {
      const i = s.identities.find((x) => x.business_id === b && x.tg_user_id === uid)
      return i && s.people.some((p) => p.profile_id === i.profile_id) ? { profile_id: i.profile_id } : null
    },
    createTelegramPerson: async (a) => {
      const existing = s.identities.find((x) => x.business_id === a.businessId && x.tg_user_id === a.tgUserId)
      if (existing) return { profile_id: existing.profile_id, created: false }
      const pid = `new${++personN}`
      s.created.push({ ...a })
      s.people.push({ profile_id: pid, business_id: a.businessId, full_name: a.displayName, role: 'kitchen_staff', role_id: 'r-staff' })
      s.identities.push({ business_id: a.businessId, tg_user_id: a.tgUserId, profile_id: pid })
      return { profile_id: pid, created: true }
    },
    insertCompletion: async (row) => {
      s.completionRows.push({ ...row })
      s.completions.push({ template_id: row.template_id, site_id: row.site_id, completed_at: row.completed_at, completed_by: row.completed_by })
      return { id: `c${s.completionRows.length}` }
    },
    insertResponses: async (rows) => {
      const start = s.responses.length
      s.responses.push(...rows)
      return rows.map((r, i) => ({ id: `resp${start + i}`, item_id: r.item_id }))
    },
    managerIds: async () => ['m1'],
    insertNotifications: async (rows) => { s.notifications.push(...rows) },
    ...over,
  }
  return { d, s }
}

/** Bot API fake: every call succeeds unless `respond` returns an override; sendMessage → message_id 101, 102, … */
export function fakeTgApi(respond: (method: string, body: any) => Partial<TgApiResult> | undefined = () => undefined) {
  const calls: { method: string; body: any }[] = []
  let mid = 100
  const api: TgApi = async (method, body) => {
    calls.push({ method, body })
    const r = respond(method, body)
    const base: TgApiResult = { ok: true, status: 200, description: '', result: method === 'sendMessage' ? { message_id: ++mid } : true, migrateTo: null }
    return { ...base, ...r }
  }
  return { api, calls }
}
