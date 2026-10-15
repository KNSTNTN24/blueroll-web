// supabase/functions/_shared/channels/groups-db.ts
// Chat groups (channel-neutral tables, spec §9; only Telegram is implemented): the data contract (GroupDeps) for the
// group bot, live lists, cron and form API, plus its Supabase-backed implementation bound to one channel. `admin` = service-role supabase-js client (typed loosely to keep this import-free).
// Never log Telegram user ids; group chat ids are fine.
import type { CompletionLite, Person, Template, TemplateItem } from '../checklists-core/types.ts'
import type { CoreDb } from '../checklists-core/record.ts'
import type { SiteInfo } from './bot.ts'
import { hashExternalId, makeCoreDb, pageAll } from './db.ts'
import { createChannelOnlyMember, defaultStaffRole, rollbackMember } from './members.ts'
import { firstName } from './team-text.ts'

// deno-lint-ignore no-explicit-any
type Any = any

// Channel-neutral model (spec 2026-10-11 §9). 'telegram_reviews' = @BluerollReviewsBot groups (spec 2026-10-15).
export type GroupChannel = 'telegram' | 'whatsapp' | 'telegram_reviews'
export interface ChannelGroup { id: string; business_id: string; channel: GroupChannel; chat_id: string; title: string; alerts: boolean }
export interface LiveListRow {
  id: string; group_id: string; site_id: string; list_date: string; message_id: string
  tokens: Record<string, string>; rendered_hash: string | null
}
export interface GroupFormToken {
  token: string; kind: 'group_checklist'; business_id: string; group_id: string; site_id: string; template_id: string
  item_ids: string[]; expires_at: string; used_at: string | null; used_by_name: string | null
}
export interface CompletionWho extends CompletionLite { completed_by: string | null }
export type ReminderKey = { template_id: string; period_key: string }

export interface GroupDeps extends CoreDb {
  now(): Date
  newToken(): string
  claimInbound(updateId: string): Promise<boolean>
  ready(businessId: string): Promise<boolean>
  businessName(businessId: string): Promise<string>
  groupByChat(chatId: string): Promise<ChannelGroup | null>
  groupById(groupId: string): Promise<ChannelGroup | null>
  linkedGroups(): Promise<ChannelGroup[]>
  alertGroups(businessId: string): Promise<ChannelGroup[]>
  claimGroupLinkCode(code: string, now: Date): Promise<{ business_id: string; issued_by: string } | null>
  releaseGroupLinkCode(code: string, usedAtIso: string): Promise<void>
  linkFailures(chatId: string, since: Date): Promise<number>
  recordLinkFailure(chatId: string, at: Date): Promise<void>
  linkGroup(a: { business_id: string; chat_id: string; title: string; linked_by: string; now: Date }): Promise<ChannelGroup>
  markGroupUnlinked(groupId: string, now: Date): Promise<void>
  migrateGroupChat(oldChatId: string, newChatId: string): Promise<void>
  claimPermissionCheck(groupId: string, now: Date): Promise<boolean>
  claimPermissionWarning(groupId: string, now: Date): Promise<boolean>
  mappedTemplates(groupId: string): Promise<Template[]>
  sites(businessId: string): Promise<SiteInfo[]>
  completionsSince(businessId: string, since: Date): Promise<CompletionWho[]>
  firstNames(profileIds: string[]): Promise<Map<string, string>>
  items(templateId: string): Promise<TemplateItem[]>
  liveLists(groupId: string): Promise<LiveListRow[]>
  orphanLiveLists(): Promise<{ row: LiveListRow; chat_id: string }[]>
  saveLiveList(r: Omit<LiveListRow, 'id'>): Promise<void>
  /**
   * Compare-and-set: applies only while the row still has the message_id and rendered_hash the caller read. Returns whether
   * it applied. `message_id` in the patch points the row at another message (the 🎉 that replaces a finished list).
   */
  updateLiveList(row: Pick<LiveListRow, 'id' | 'message_id' | 'rendered_hash'>, patch: { tokens: Record<string, string>; rendered_hash: string; message_id?: string }): Promise<boolean>
  /** Deletes only while the row still points at `messageId` (a repost keeps the id but changes the message). Returns whether it applied. */
  deleteLiveList(id: string, messageId: string): Promise<boolean>
  saveGroupToken(t: GroupFormToken): Promise<void>
  peekGroupToken(token: string): Promise<GroupFormToken | null>
  takeGroupToken(token: string, now: Date, byName: string): Promise<GroupFormToken | null>
  releaseGroupToken(token: string, usedAtIso: string): Promise<void>
  claimGroupReminders(groupId: string, siteId: string, keys: ReminderKey[]): Promise<Set<string>>
  releaseGroupReminders(groupId: string, siteId: string, keys: ReminderKey[]): Promise<void>
  person(profileId: string): Promise<Person | null>
  telegramIdentity(businessId: string, tgUserId: string): Promise<{ profile_id: string } | null>
  createTelegramPerson(a: { businessId: string; siteId: string; tgUserId: string; displayName: string }): Promise<{ profile_id: string; created: boolean }>
  /** Expire still-unused tokens now (a repost invalidates the previous list's forms). No-op for an empty array. */
  expireTokens(tokens: string[]): Promise<void>
}

/** App notification (bell) to every active owner/manager. */
export async function notifyManagers(d: Pick<CoreDb, 'managerIds' | 'insertNotifications'>, businessId: string, n: { title: string; message: string; link: string }): Promise<void> {
  const ids = await d.managerIds(businessId)
  await d.insertNotifications(ids.map((user_id) => ({ user_id, type: 'team', title: n.title, message: n.message, link: n.link })))
}

const DAY_MS = 86400_000
const GROUP_COLS = 'id, business_id, channel, chat_id, title, alerts'
const LIST_COLS = 'id, group_id, site_id, list_date, message_id, tokens, rendered_hash'
const TOKEN_COLS = 'token, kind, business_id, group_id, site_id, template_id, item_ids, expires_at, used_at, used_by_name'
export const TEMPLATE_COLS = 'id, business_id, site_id, name, frequency, deadline_time, multi_per_day, min_per_day, assigned_roles, assigned_role_ids, active'

/** Active templates mapped to a group (channel_group_checklists), role arrays defaulted. */
export async function mappedTemplates(admin: Any, groupId: string): Promise<Template[]> {
  const { data, error } = await admin.from('channel_group_checklists').select(`template:checklist_templates(${TEMPLATE_COLS})`).eq('group_id', groupId)
  if (error) throw error
  return ((data ?? []) as Any[]).map((r) => r.template).filter((t) => t && t.active)
    .map((t) => ({ ...t, assigned_roles: t.assigned_roles ?? [], assigned_role_ids: t.assigned_role_ids ?? [] }))
}

/** Completions (with who) of a business since a time. Paged: a busy business easily has >1000 in a month (PostgREST row cap). */
export function completionsWhoSince(admin: Any, businessId: string, since: Date): Promise<CompletionWho[]> {
  return pageAll<CompletionWho>((from, to) => admin.from('checklist_completions')
    .select('template_id, site_id, completed_at, completed_by').eq('business_id', businessId).gte('completed_at', since.toISOString())
    .order('completed_at', { ascending: false }).order('id', { ascending: false }).range(from, to))
}

/** profile id → first name, for the given ids (missing profiles are absent). */
export async function firstNamesOf(admin: Any, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const { data, error } = await admin.from('profiles').select('id, full_name').in('id', ids)
  if (error) throw error
  return new Map(((data ?? []) as Any[]).map((p) => [p.id as string, firstName(String(p.full_name ?? ''))]))
}

export function makeGroupDeps(admin: Any, channel: GroupChannel = 'telegram'): GroupDeps {
  const one = async (q: Any) => { const { data, error } = await q; if (error) throw error; return data }
  const errMsg = (e: Any) => String(e?.message ?? e).slice(0, 200)
  const asList = (r: Any): LiveListRow => ({ ...r, tokens: r.tokens ?? {} })
  const core = makeCoreDb(admin)

  /** Atomic "at most once per 24 h" claim on a timestamp column (two UPDATEs = the OR, no filter strings). */
  const claimDaily = async (id: string, col: 'last_permission_check_at' | 'last_permission_warning_at', now: Date) => {
    const at = now.toISOString()
    const first = await one(admin.from('channel_groups').update({ [col]: at }).eq('id', id).is(col, null).select('id'))
    if (first?.length) return true
    const later = await one(admin.from('channel_groups').update({ [col]: at }).eq('id', id)
      .lt(col, new Date(now.getTime() - DAY_MS).toISOString()).select('id'))
    return !!later?.length
  }

  const telegramIdentity = async (b: string, uid: string) => {
    const id = await one(admin.from('channel_identities').select('profile_id')
      .eq('business_id', b).eq('channel', channel).eq('external_id', uid).is('revoked_at', null).maybeSingle())
    if (!id) return null
    const p = await one(admin.from('profiles').select('id').eq('id', id.profile_id).eq('business_id', b).is('removed_at', null).maybeSingle())
    return p ? { profile_id: id.profile_id as string } : null
  }

  return {
    now: () => new Date(),
    newToken: () => crypto.randomUUID().replace(/-/g, ''),

    claimInbound: async (updateId) => {
      const { error } = await admin.from('channel_messages_log').insert({
        business_id: null, site_id: null, profile_id: null, channel, direction: 'in', kind: 'group_update',
        billable: false, wa_message_id: `grp:${updateId}`,
      })
      if (!error) return true
      if (error.code === '23505') return false   // uq_channel_inbound_msg: already handled
      console.error('telegram inbound log failed', errMsg(error))
      return true
    },
    ready: async (b) => !!(await one(admin.rpc('channel_ready', { b, ch: channel }))),
    businessName: async (b) => (await one(admin.from('businesses').select('name').eq('id', b).maybeSingle()))?.name || 'your team',

    groupByChat: async (c) => (await one(admin.from('channel_groups').select(GROUP_COLS).eq('channel', channel).eq('chat_id', c).is('unlinked_at', null).maybeSingle())) ?? null,
    groupById: async (id) => (await one(admin.from('channel_groups').select(GROUP_COLS).eq('id', id).is('unlinked_at', null).maybeSingle())) ?? null,
    linkedGroups: () => pageAll<ChannelGroup>((from, to) => admin.from('channel_groups').select(GROUP_COLS).eq('channel', channel).is('unlinked_at', null).order('id').range(from, to)),
    alertGroups: async (b) => (await one(admin.from('channel_groups').select(GROUP_COLS).eq('channel', channel).eq('business_id', b).eq('alerts', true).is('unlinked_at', null))) ?? [],

    claimGroupLinkCode: async (code, now) => {
      const nowIso = now.toISOString()
      const rows = await one(admin.from('channel_group_link_codes').update({ used_at: nowIso })
        .eq('channel', channel).eq('code', code).is('used_at', null).gt('expires_at', nowIso).select('business_id, issued_by'))
      return rows?.[0] ?? null
    },
    releaseGroupLinkCode: async (code, at) => {
      await one(admin.from('channel_group_link_codes').update({ used_at: null }).eq('code', code).eq('used_at', at))
    },
    linkFailures: async (chatId, since) => {
      const { count, error } = await admin.from('channel_messages_log').select('id', { count: 'exact', head: true })
        .eq('kind', 'group_link_fail').eq('ref_id', await hashExternalId(chatId)).gte('created_at', since.toISOString())
      if (error) throw error
      return count ?? 0
    },
    recordLinkFailure: async (chatId, at) => {
      await one(admin.from('channel_messages_log').insert({
        business_id: null, site_id: null, profile_id: null, channel, direction: 'in', kind: 'group_link_fail',
        billable: false, ref_id: await hashExternalId(chatId), created_at: at.toISOString(),
      }))
    },
    linkGroup: async (a) => {
      const at = a.now.toISOString()
      const existing = await one(admin.from('channel_groups').select('id, business_id, unlinked_at').eq('channel', channel).eq('chat_id', a.chat_id).maybeSingle())
      if (!existing) {
        return await one(admin.from('channel_groups').insert({
          business_id: a.business_id, channel, chat_id: a.chat_id, title: a.title, linked_by: a.linked_by, linked_at: at,
        }).select(GROUP_COLS).single())
      }
      // Relinked to another business, or to the same one after an unlink: old checklist choices and the alerts flag
      // don't carry over ("A manager will choose which checks this group does."). A /link re-run in a group that is
      // still linked to the same business keeps them.
      const fresh = existing.business_id !== a.business_id || existing.unlinked_at != null
      if (fresh) await one(admin.from('channel_group_checklists').delete().eq('group_id', existing.id))
      return await one(admin.from('channel_groups').update({
        business_id: a.business_id, title: a.title, linked_by: a.linked_by, linked_at: at, unlinked_at: null,
        ...(fresh ? { alerts: false } : {}),
      }).eq('id', existing.id).select(GROUP_COLS).single())
    },
    markGroupUnlinked: async (id, now) => {
      await one(admin.from('channel_groups').update({ unlinked_at: now.toISOString() }).eq('id', id).is('unlinked_at', null))
    },
    migrateGroupChat: async (oldId, newId) => {
      const { error } = await admin.from('channel_groups').update({ chat_id: newId }).eq('channel', channel).eq('chat_id', oldId)
      if (error) console.error('telegram group migrate failed', oldId, errMsg(error))
    },
    claimPermissionCheck: (id, now) => claimDaily(id, 'last_permission_check_at', now),
    claimPermissionWarning: (id, now) => claimDaily(id, 'last_permission_warning_at', now),

    mappedTemplates: (gid) => mappedTemplates(admin, gid),
    sites: async (b) => ((await one(admin.from('sites').select('id, name, timezone, status').eq('business_id', b).is('removed_at', null))) ?? [])
      .filter((s: Any) => s.status !== 'removed')
      .map((s: Any) => ({ id: s.id, name: s.name ?? '', timezone: s.timezone ?? 'Europe/London' })),
    completionsSince: (b, since) => completionsWhoSince(admin, b, since),
    firstNames: (ids) => firstNamesOf(admin, ids),
    items: async (tid) => (await one(admin.from('checklist_template_items')
      .select('id, name, item_type, required, min_value, max_value, unit, sort_order').eq('template_id', tid))) ?? [],

    liveLists: async (gid) => ((await one(admin.from('channel_live_lists').select(LIST_COLS).eq('group_id', gid))) ?? []).map(asList),
    orphanLiveLists: async () => {
      const rows = await one(admin.from('channel_live_lists').select(`${LIST_COLS}, group:channel_groups!inner(channel, chat_id, unlinked_at)`)
        .eq('group.channel', channel).not('group.unlinked_at', 'is', null))
      return ((rows ?? []) as Any[]).map(({ group, ...row }) => ({ row: asList(row), chat_id: group.chat_id as string }))
    },
    saveLiveList: async (r) => {
      await one(admin.from('channel_live_lists').upsert({ ...r, updated_at: new Date().toISOString() }, { onConflict: 'group_id,site_id' }))
    },
    updateLiveList: async (row, p) => {
      let q = admin.from('channel_live_lists').update({ ...p, updated_at: new Date().toISOString() }).eq('id', row.id).eq('message_id', row.message_id)
      q = row.rendered_hash === null ? q.is('rendered_hash', null) : q.eq('rendered_hash', row.rendered_hash)
      return !!(await one(q.select('id')))?.length
    },
    deleteLiveList: async (id, messageId) => !!(await one(admin.from('channel_live_lists').delete().eq('id', id).eq('message_id', messageId).select('id')))?.length,

    saveGroupToken: async (t) => { await one(admin.from('channel_form_tokens').insert({ ...t, profile_id: null, response_id: null })) },
    peekGroupToken: async (tok) => {
      const r = await one(admin.from('channel_form_tokens').select(TOKEN_COLS).eq('token', tok).maybeSingle())
      return r && r.kind === 'group_checklist' ? { ...r, item_ids: r.item_ids ?? [] } : null
    },
    // One atomic UPDATE: the first submit takes the token and records the winner's first name.
    takeGroupToken: async (tok, now, byName) => {
      const nowIso = now.toISOString()
      const rows = await one(admin.from('channel_form_tokens').update({ used_at: nowIso, used_by_name: byName })
        .eq('token', tok).eq('kind', 'group_checklist').is('used_at', null).gt('expires_at', nowIso).select(TOKEN_COLS))
      const r = rows?.[0]
      return r ? { ...r, item_ids: r.item_ids ?? [] } : null
    },
    expireTokens: async (tokens) => {
      if (!tokens.length) return
      await one(admin.from('channel_form_tokens').update({ expires_at: new Date().toISOString() }).in('token', tokens).is('used_at', null))
    },
    releaseGroupToken: async (tok, at) => {
      await one(admin.from('channel_form_tokens').update({ used_at: null, used_by_name: null }).eq('token', tok).eq('used_at', at))
    },

    claimGroupReminders: async (gid, sid, keys) => {
      if (!keys.length) return new Set<string>()
      const rows = await one(admin.from('channel_group_reminders_sent')
        .upsert(keys.map((k) => ({ group_id: gid, site_id: sid, template_id: k.template_id, period_key: k.period_key })),
          { onConflict: 'group_id,template_id,site_id,period_key', ignoreDuplicates: true })
        .select('template_id, period_key'))
      return new Set(((rows ?? []) as Any[]).map((r) => `${r.template_id}:${r.period_key}`))
    },
    releaseGroupReminders: async (gid, sid, keys) => {
      for (const k of keys) {
        const { error } = await admin.from('channel_group_reminders_sent').delete()
          .eq('group_id', gid).eq('site_id', sid).eq('template_id', k.template_id).eq('period_key', k.period_key)
        if (error) console.error('group reminder key release failed', gid, k.template_id, errMsg(error))
      }
    },

    person: core.person,
    telegramIdentity,
    createTelegramPerson: async (a) => {
      const role = await defaultStaffRole(admin, a.businessId)
      if (!role) throw new Error('no staff role to give a new group member')
      const m = await createChannelOnlyMember(admin, {
        businessId: a.businessId, siteId: a.siteId, roleId: role.id, roleTier: role.base_tier, fullName: a.displayName, emailPrefix: 'tg',
      })
      if (!m.ok) throw new Error(`${channel} member: ${m.error}`)
      const { error } = await admin.from('channel_identities').insert({
        business_id: a.businessId, profile_id: m.profileId, channel, external_id: a.tgUserId,
        consent_source: 'group_form', consent_text_version: 1, last_inbound_at: new Date().toISOString(),
      })
      if (!error) return { profile_id: m.profileId, created: true }
      await rollbackMember(admin, m.profileId, true)
      if (error.code === '23505') {
        // The same person submitted two checks at once: the other request created them first.
        const other = await telegramIdentity(a.businessId, a.tgUserId)
        if (other) return { profile_id: other.profile_id, created: false }
      }
      throw error
    },

    insertCompletion: core.insertCompletion,
    insertResponses: core.insertResponses,
    managerIds: core.managerIds,
    insertNotifications: core.insertNotifications,
  }
}
