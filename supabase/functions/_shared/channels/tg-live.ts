// supabase/functions/_shared/channels/tg-live.ts
// Telegram live list service (spec §4): one message per (group, site). Repost = send (notifies) → store → delete the
// previous one. Refresh = edit silently when the rendered list changed; delete it when stale or all done.
import type { SiteInfo } from './bot.ts'
import { telegramFormItemIds } from './bot.ts'
import type { ChannelGroup, GroupDeps, LiveListRow } from './groups-db.ts'
import { miniAppLink, tgEditHtml, tgHtml, tgOutcome, type TgApi } from './telegram.ts'
import { localDate, refreshDecision, renderLiveList, sitesForGroup, type DoneLine, type OpenLine, type RenderedList } from './live-list.ts'
import { completionsWindowStart, dueAtSite } from '../checklists-core/due.ts'
import { periodStartUtc } from '../checklists-core/time.ts'

export const GROUP_TOKEN_TTL_MS = 24 * 3600_000
/** A kept token must stay valid long enough for someone to open and fill in the form. */
const TOKEN_REUSE_MARGIN_MS = 3600_000

export type ListOutcome = 'posted' | 'empty' | 'edited' | 'unchanged' | 'deleted' | 'failed' | 'unlinked'

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

async function tokenFor(d: GroupDeps, group: ChannelGroup, siteId: string, templateId: string, itemIds: string[], prev: string | undefined, now: Date): Promise<string> {
  if (prev) {
    const t = await d.peekGroupToken(prev)
    if (t && !t.used_at && t.group_id === group.id && t.site_id === siteId && t.template_id === templateId
      && new Date(t.expires_at).getTime() - now.getTime() > TOKEN_REUSE_MARGIN_MS && sameIds(t.item_ids, itemIds)) return prev
  }
  const token = d.newToken()
  await d.saveGroupToken({
    token, kind: 'group_checklist', business_id: group.business_id, group_id: group.id, site_id: siteId, template_id: templateId,
    item_ids: itemIds, expires_at: new Date(now.getTime() + GROUP_TOKEN_TTL_MS).toISOString(), used_at: null, used_by_name: null,
  })
  return token
}

/**
 * What the list for (group, site) shows now. `prevTokens` (template id → token) are reused while still unused, valid
 * and for the same items; otherwise a fresh group token is minted (e.g. after a submit on a multi-per-day checklist).
 */
export async function buildList(d: GroupDeps, group: ChannelGroup, site: SiteInfo, now: Date, prevTokens: Record<string, string>): Promise<{ rendered: RenderedList; tokens: Record<string, string> }> {
  const templates = (await d.mappedTemplates(group.id)).filter((t) => t.active && (t.site_id === null || t.site_id === site.id))
  const completions = templates.length ? await d.completionsSince(group.business_id, completionsWindowStart(templates, [site.timezone], now)) : []
  const due = dueAtSite({ templates, siteId: site.id, tz: site.timezone, now, completions })
  const dueIds = new Set(due.map((x) => x.template.id))
  const tokens: Record<string, string> = {}
  const open: OpenLine[] = []
  for (const x of due) {
    const ids = telegramFormItemIds(await d.items(x.template.id))
    let url: string | null = null
    if (ids) {
      const token = await tokenFor(d, group, site.id, x.template.id, ids, prevTokens[x.template.id], now)
      tokens[x.template.id] = token
      url = miniAppLink(token)
    }
    open.push({ templateId: x.template.id, name: x.template.name, deadlineUtc: x.deadline_utc, url })
  }
  // Done in the current period (any source: Telegram, app, web): latest completion per checklist.
  const doneRaw = templates.filter((t) => !dueIds.has(t.id)).flatMap((t) => {
    const start = periodStartUtc(t.multi_per_day ? 'daily' : t.frequency, now, site.timezone).getTime()
    const last = completions
      .filter((c) => c.template_id === t.id && c.site_id === site.id && new Date(c.completed_at).getTime() >= start)
      .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())[0]
    return last ? [{ t, last }] : []
  })
  const names = await d.firstNames([...new Set(doneRaw.map((x) => x.last.completed_by).filter((x): x is string => !!x))])
  const done: DoneLine[] = doneRaw.map(({ t, last }) => ({
    templateId: t.id, name: t.name, completedAt: last.completed_at, by: (last.completed_by && names.get(last.completed_by)) || null,
  }))
  return { rendered: await renderLiveList({ siteName: site.name, tz: site.timezone, now, open, done }), tokens }
}

export async function deleteListMessage(api: TgApi, chatId: string, messageId: string): Promise<void> {
  if (!messageId) return
  await api('deleteMessage', { chat_id: chatId, message_id: Number(messageId) })   // best effort: result ignored
}

async function dropList(d: GroupDeps, api: TgApi, group: ChannelGroup, row: LiveListRow): Promise<boolean> {
  // Row first (compare-and-set on message_id): if a repost replaced it, the new message must not be deleted.
  if (!(await d.deleteLiveList(row.id, row.message_id))) return false
  await deleteListMessage(api, group.chat_id, row.message_id)
  return true
}

export async function unlinkGroup(d: GroupDeps, api: TgApi, group: ChannelGroup, now: Date): Promise<void> {
  for (const row of await d.liveLists(group.id)) await dropList(d, api, group, row)
  await d.markGroupUnlinked(group.id, now)
}

/**
 * Reminder or /checks: post a fresh list (notifies), then delete the previous one. Nothing open → nothing sent.
 * Still-valid tokens of the previous list are carried over (forms open in the group keep working); only replaced ones expire.
 */
export async function repostList(d: GroupDeps, api: TgApi, group: ChannelGroup, site: SiteInfo, now: Date): Promise<ListOutcome> {
  const prev = (await d.liveLists(group.id)).find((l) => l.site_id === site.id) ?? null
  const { rendered, tokens } = await buildList(d, group, site, now, prev?.tokens ?? {})
  if (!rendered.openCount) {
    if (prev) await dropList(d, api, group, prev)
    return 'empty'
  }
  const r = await api('sendMessage', tgHtml(group.chat_id, rendered.text, rendered.keyboard))
  if (!r.ok) {
    const o = tgOutcome(r)
    if (o === 'kicked') { await unlinkGroup(d, api, group, now); return 'unlinked' }
    if (o === 'migrated' && r.migrateTo) await d.migrateGroupChat(group.chat_id, r.migrateTo)
    console.error('live list send failed', group.chat_id, r.status, r.description.slice(0, 120))
    return 'failed'
  }
  await d.saveLiveList({
    group_id: group.id, site_id: site.id, list_date: localDate(now, site.timezone),
    message_id: String(r.result?.message_id ?? ''), tokens, rendered_hash: rendered.hash,
  })
  if (prev) {
    // Tokens the new list replaced are retired (first submit wins); tokens it carried over stay valid.
    const kept = new Set(Object.values(tokens))
    await d.expireTokens(Object.values(prev.tokens ?? {}).filter((t) => !kept.has(t)))
    await deleteListMessage(api, group.chat_id, prev.message_id)
  }
  return 'posted'
}

/** /checks: repost every site of the group (sites where at least one mapped checklist applies). */
export async function repostGroup(d: GroupDeps, api: TgApi, group: ChannelGroup, now: Date): Promise<ListOutcome[]> {
  const sites = sitesForGroup(await d.mappedTemplates(group.id), await d.sites(group.business_id))
  const out: ListOutcome[] = []
  for (const site of sites) {
    const o = await repostList(d, api, group, site, now)
    out.push(o)
    if (o === 'unlinked') break
  }
  return out
}

/** Cron (every 10 min) and after a submit. `site` null = the site no longer exists or no longer has mapped checklists. */
export async function refreshList(d: GroupDeps, api: TgApi, group: ChannelGroup, row: LiveListRow, site: SiteInfo | null, now: Date, retried = false): Promise<ListOutcome> {
  // Writes to the row are compare-and-set on (message_id, rendered_hash): if a repost or another refresh got there first,
  // re-read the row once and redo the refresh against it; a second loss is left to the next run.
  const lost = async (): Promise<ListOutcome> => {
    if (retried) return 'failed'
    const fresh = (await d.liveLists(group.id)).find((l) => l.id === row.id || l.site_id === row.site_id)
    return fresh ? refreshList(d, api, group, fresh, site, now, true) : 'unchanged'
  }
  if (!site || row.list_date !== localDate(now, site.timezone)) { return (await dropList(d, api, group, row)) ? 'deleted' : lost() }
  const { rendered, tokens } = await buildList(d, group, site, now, row.tokens ?? {})
  const decision = refreshDecision({ listDate: row.list_date, today: localDate(now, site.timezone), openCount: rendered.openCount, storedHash: row.rendered_hash, newHash: rendered.hash })
  if (decision === 'delete_stale' || decision === 'delete_done') {
    return (await dropList(d, api, group, row)) ? 'deleted' : lost()
  }
  if (decision === 'unchanged') return 'unchanged'
  const r = await api('editMessageText', tgEditHtml(group.chat_id, row.message_id, rendered.text, rendered.keyboard))
  const o = tgOutcome(r)
  if (o === 'ok' || o === 'not_modified') {
    return (await d.updateLiveList(row, { tokens, rendered_hash: rendered.hash })) ? 'edited' : lost()
  }
  if (o === 'gone') return (await d.deleteLiveList(row.id, row.message_id)) ? 'deleted' : lost()   // the next reminder or /checks posts a fresh list
  if (o === 'kicked') { await unlinkGroup(d, api, group, now); return 'unlinked' }
  if (o === 'migrated' && r.migrateTo) await d.migrateGroupChat(group.chat_id, r.migrateTo)
  console.error('live list edit failed', group.chat_id, r.status, r.description.slice(0, 120))
  return 'failed'   // row kept; next run retries
}

export async function refreshGroupSite(d: GroupDeps, api: TgApi, groupId: string, siteId: string, now: Date): Promise<ListOutcome | null> {
  const group = await d.groupById(groupId)
  if (!group) return null
  const row = (await d.liveLists(groupId)).find((l) => l.site_id === siteId)
  if (!row) return null
  const sites = sitesForGroup(await d.mappedTemplates(group.id), await d.sites(group.business_id))
  return refreshList(d, api, group, row, sites.find((s) => s.id === siteId) ?? null, now)
}
