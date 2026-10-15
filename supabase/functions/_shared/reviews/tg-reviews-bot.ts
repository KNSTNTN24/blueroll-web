// supabase/functions/_shared/reviews/tg-reviews-bot.ts
// @BluerollReviewsBot (spec §8): groups only. /link <code>, /pending, /help; card buttons (callback queries);
// "Edit" via a force-reply prompt answered by the same person. Privacy mode stays on: we receive commands, callback
// queries and replies to our own messages. Group membership is re-checked on every press. Never logs Telegram user ids.
import { memberStatus, membersCanInvite, tgText, type TgApi } from '../channels/telegram.ts'
import type { ChannelGroup, GroupDeps } from '../channels/groups-db.ts'
import { telegramDisplayName } from '../channels/members.ts'
import { CONFIRM_WINDOW_SEC, parseCb, cardSend, shortName } from './card.ts'
import {
  ACTION_TEXT, doAnother, doEdit, doPublish, doSkip, latestDraft, makeDraft, refreshCards, renderFor,
} from './actions.ts'
import type { Ctx } from './deps.ts'
import type { Actor } from './types.ts'

export const REVIEWS_BOT_USERNAME = 'BluerollReviewsBot'
const TG_API = 'https://api.telegram.org'
const EDIT_TTL_MS = 15 * 60_000
const PENDING_LIMIT = 10
export const MAX_LINK_FAILURES = 5
const LINK_FAILURE_WINDOW_MS = 3600_000

export const RV_TEXT = {
  privateHelp: "Blueroll reviews arrive in your managers' Telegram group. Ask your manager to add you.",
  linked: (business: string) => `Linked to ${business}. Choose which restaurants this group gets in Blueroll → Settings → Google reviews.`,
  linkUsage: 'To link this group, send /link followed by the 6-digit code from Blueroll → Settings → Google reviews.',
  linkInvalid: 'That code is not valid or has expired. Get a new code in Blueroll → Settings → Google reviews.',
  linkLimited: 'Too many wrong codes. Please try again in an hour.',
  unavailable: "Blueroll reviews aren't available for this team right now.",
  notLinked: 'This group is not linked to Blueroll yet. A manager can link it in Blueroll → Settings → Google reviews.',
  nothingPending: 'No reviews need a reply right now 👍',
  help: 'New Google reviews arrive here with a suggested reply. Tap Publish to post it on Google, Edit to change it, Another for a new version, or Skip. Send /pending to see reviews that still need a reply.',
  permissionWarning: "Anyone in this group can add people — and anyone in this group can publish replies on Google. An admin should turn off 'Add members' for members in group settings.",
  notMember: "You're no longer in this group",
  noLongerLinked: 'This group is no longer linked to Blueroll',
  telegramDown: "Telegram didn't answer — please try again",
  confirmTimeout: 'That took too long — tap Publish again',
  editPrompt: (name: string) => `Reply to this message with the new text for ${name}'s review`,
  editTimeout: 'That edit timed out — tap Edit again',
}

export type RvEvent =
  | { kind: 'private'; chatId: string; id: string }
  | { kind: 'command'; chatId: string; chatTitle: string; userId: string; command: 'link' | 'pending' | 'help'; arg: string; id: string }
  | { kind: 'callback'; callbackId: string; chatId: string; messageId: string; userId: string; userName: string; data: string; id: string }
  | { kind: 'reply'; chatId: string; messageId: string; replyTo: string; userId: string; userName: string; text: string; id: string }
  | { kind: 'bot_removed'; chatId: string; id: string }
  | { kind: 'migrated'; chatId: string; newChatId: string; id: string }

// deno-lint-ignore no-explicit-any
type Any = any
const COMMANDS: Record<string, 'link' | 'pending' | 'help'> = { link: 'link', pending: 'pending', help: 'help', start: 'help' }
const isGroup = (t: unknown) => t === 'group' || t === 'supergroup'
const isChatId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v !== 0
const isUserId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
const nameOf = (from: Any) => telegramDisplayName(String(from?.first_name ?? ''), String(from?.last_name ?? ''))

export function parseReviewsUpdate(update: unknown): RvEvent[] {
  try {
    const u = update as Any
    const id = String(u?.update_id ?? '')
    const q = u?.callback_query
    if (q && typeof q === 'object') {
      const m = q.message
      if (!m || !isGroup(m.chat?.type) || !isChatId(m.chat?.id) || !isUserId(q.from?.id) || typeof q.data !== 'string') return []
      return [{ kind: 'callback', callbackId: String(q.id), chatId: String(m.chat.id), messageId: String(m.message_id), userId: String(q.from.id), userName: nameOf(q.from), data: q.data, id }]
    }
    const mcm = u?.my_chat_member
    if (mcm && typeof mcm === 'object') {
      if (!isGroup(mcm.chat?.type) || !isChatId(mcm.chat?.id)) return []
      const st = mcm.new_chat_member?.status
      return st === 'left' || st === 'kicked' ? [{ kind: 'bot_removed', chatId: String(mcm.chat.id), id }] : []
    }
    const m = u?.message
    if (!m || typeof m !== 'object' || !isChatId(m.chat?.id)) return []
    const chatId = String(m.chat.id)
    if (m.chat.type === 'private') return m.from?.is_bot === true || !isUserId(m.from?.id) ? [] : [{ kind: 'private', chatId, id }]
    if (!isGroup(m.chat.type)) return []
    if (isChatId(m.migrate_to_chat_id)) return [{ kind: 'migrated', chatId, newChatId: String(m.migrate_to_chat_id), id }]
    if (m.from?.is_bot === true || !isUserId(m.from?.id) || typeof m.text !== 'string') return []
    const rt = m.reply_to_message
    if (rt && rt.from?.is_bot === true && String(rt.from?.username ?? '').toLowerCase() === REVIEWS_BOT_USERNAME.toLowerCase()) {
      return [{ kind: 'reply', chatId, messageId: String(m.message_id), replyTo: String(rt.message_id), userId: String(m.from.id), userName: nameOf(m.from), text: m.text, id }]
    }
    const cmd = /^\/([A-Za-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(m.text.trim())
    if (!cmd) return []
    const [, name, target, arg] = cmd
    if (target && target.toLowerCase() !== REVIEWS_BOT_USERNAME.toLowerCase()) return []
    const key = name.toLowerCase()
    const command = Object.prototype.hasOwnProperty.call(COMMANDS, key) ? COMMANDS[key] : undefined
    if (!command) return []
    return [{ kind: 'command', chatId, chatTitle: typeof m.chat.title === 'string' ? m.chat.title : '', userId: String(m.from.id), command, arg: (arg ?? '').trim(), id }]
  } catch { /* malformed */ }
  return []
}

const say = (api: TgApi, chatId: string, text: string) => api('sendMessage', tgText(chatId, text))
const answer = (api: TgApi, callbackId: string, text = '', alert = false) =>
  api('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text, show_alert: alert } : {}) })

export async function checkReviewGroupPermissions(g: GroupDeps, ctx: Ctx, group: ChannelGroup, now: Date): Promise<'ok' | 'warned' | 'skipped' | 'unknown'> {
  const can = membersCanInvite(await ctx.tg('getChat', { chat_id: group.chat_id }))
  if (can === null) return 'unknown'
  if (!can) return 'ok'
  if (!(await g.claimPermissionWarning(group.id, now))) return 'skipped'
  await say(ctx.tg, group.chat_id, RV_TEXT.permissionWarning)
  const ids = await ctx.d.reviewManagerIds(group.business_id)
  await ctx.d.notify(ids.map((user_id) => ({
    user_id, title: 'Reviews group is open to new members',
    message: `Anyone in “${group.title || 'your reviews group'}” can add people, and anyone in it can publish replies on Google. An admin should turn off 'Add members' for members in the group settings.`,
    link: '/settings?tab=reviews',
  })))
  return 'warned'
}

type Command = Extract<RvEvent, { kind: 'command' }>

async function link(e: Command, g: GroupDeps, ctx: Ctx, now: Date) {
  if (!/^\d{6}$/.test(e.arg)) { await say(ctx.tg, e.chatId, RV_TEXT.linkUsage); return }
  if (await g.linkFailures(e.chatId, new Date(now.getTime() - LINK_FAILURE_WINDOW_MS)) >= MAX_LINK_FAILURES) { await say(ctx.tg, e.chatId, RV_TEXT.linkLimited); return }
  const code = await g.claimGroupLinkCode(e.arg, now)
  if (!code) { await g.recordLinkFailure(e.chatId, now); await say(ctx.tg, e.chatId, RV_TEXT.linkInvalid); return }
  const usedAt = now.toISOString()
  let ready: boolean
  try { ready = await g.ready(code.business_id) }
  catch (err) { await g.releaseGroupLinkCode(e.arg, usedAt); throw err }
  if (!ready) { await g.releaseGroupLinkCode(e.arg, usedAt); await say(ctx.tg, e.chatId, RV_TEXT.unavailable); return }
  const prev = await g.groupByChat(e.chatId)
  // Fresh link (new business, or after an unlink): clear old routes before AND after linkGroup, so a crash in between can't leave them on a relinked group.
  const fresh = !prev || prev.business_id !== code.business_id
  if (fresh && prev) await ctx.d.deleteRoutes(prev.id)
  const group = await g.linkGroup({ business_id: code.business_id, chat_id: e.chatId, title: e.chatTitle, linked_by: code.issued_by, now })
  // Review Focus 3: a fresh link (new business, or after an unlink) never inherits routes.
  if (fresh) await ctx.d.deleteRoutes(group.id)
  await say(ctx.tg, e.chatId, RV_TEXT.linked(await g.businessName(code.business_id)))
  await checkReviewGroupPermissions(g, ctx, group, now)
}

async function pending(e: Command, g: GroupDeps, ctx: Ctx) {
  const group = await g.groupByChat(e.chatId)
  if (!group) { await say(ctx.tg, e.chatId, RV_TEXT.notLinked); return }
  if (!(await g.ready(group.business_id))) { await say(ctx.tg, e.chatId, RV_TEXT.unavailable); return }
  const sites = await ctx.d.groupSites(group.id)
  const open = sites.length ? await ctx.d.openReviewsForSites(group.business_id, sites, PENDING_LIMIT) : []
  if (!open.length) { await say(ctx.tg, e.chatId, RV_TEXT.nothingPending); return }
  for (const r0 of open) {
    if (!(await latestDraft(ctx, r0))) await makeDraft(ctx, r0)
    const r = (await ctx.d.review(r0.id)) ?? r0
    const res = await ctx.tg('sendMessage', cardSend(e.chatId, await renderFor(ctx, r)))
    const mid = res.ok ? res.result?.message_id : null
    if (mid != null) await ctx.d.saveCard({ review_id: r.id, chat_id: e.chatId, message_id: String(mid), group_id: group.id })
  }
}

type Callback = Extract<RvEvent, { kind: 'callback' }>

async function onCallback(e: Callback, g: GroupDeps, ctx: Ctx, now: Date) {
  const c = parseCb(e.data)
  if (!c) { await answer(ctx.tg, e.callbackId); return }
  const group = await g.groupByChat(e.chatId)
  if (!group) { await answer(ctx.tg, e.callbackId, RV_TEXT.noLongerLinked, true); return }
  const ms = memberStatus(await ctx.tg('getChatMember', { chat_id: e.chatId, user_id: Number(e.userId) }))
  if (ms === 'not_member') { await answer(ctx.tg, e.callbackId, RV_TEXT.notMember, true); return }
  if (ms === 'unknown') { await answer(ctx.tg, e.callbackId, RV_TEXT.telegramDown, true); return }
  const r = await ctx.d.review(c.reviewId)
  if (!r || r.business_id !== group.business_id) { await answer(ctx.tg, e.callbackId, ACTION_TEXT.gone, true); return }
  const actor: Actor = { channel: 'telegram', profile_id: null, external_id: e.userId, name: e.userName }
  const only = { review_id: r.id, chat_id: e.chatId, message_id: e.messageId }
  const draft = await latestDraft(ctx, r)
  const current = (draft?.draft_version ?? 0) === c.draftVersion

  switch (c.action) {
    case 'p': {
      if (!current) { await answer(ctx.tg, e.callbackId, ACTION_TEXT.stale, true); return }
      await refreshCards(ctx, r.id, { only, confirmAt: Math.floor(now.getTime() / 1000) })
      await answer(ctx.tg, e.callbackId)
      return
    }
    case 'c':
      await refreshCards(ctx, r.id, { only })
      await answer(ctx.tg, e.callbackId)
      return
    case 'y': {
      if (c.at == null || now.getTime() / 1000 - c.at > CONFIRM_WINDOW_SEC) {
        await refreshCards(ctx, r.id, { only })
        await answer(ctx.tg, e.callbackId, RV_TEXT.confirmTimeout, true)
        return
      }
      const res = await doPublish(ctx, r.id, c.draftVersion, actor)
      if (!res.ok && res.outcome === 'stale') await refreshCards(ctx, r.id, { only })
      await answer(ctx.tg, e.callbackId, res.text, !res.ok)
      return
    }
    case 's': {
      const res = await doSkip(ctx, r.id, actor)
      await answer(ctx.tg, e.callbackId, res.ok ? '' : res.text, !res.ok)
      return
    }
    case 'a': {
      if (!current) { await answer(ctx.tg, e.callbackId, ACTION_TEXT.stale, true); return }
      const res = await doAnother(ctx, r.id, actor)
      await answer(ctx.tg, e.callbackId, res.ok ? '' : res.text, !res.ok)
      return
    }
    case 'e': {
      if (!current) { await answer(ctx.tg, e.callbackId, ACTION_TEXT.stale, true); return }
      const sent = await ctx.tg('sendMessage', {
        chat_id: e.chatId, text: RV_TEXT.editPrompt(shortName(r.reviewer_name)),
        reply_parameters: { message_id: Number(e.messageId) }, reply_markup: { force_reply: true, selective: true },
      })
      const mid = sent.ok ? sent.result?.message_id : null
      if (mid == null) { await answer(ctx.tg, e.callbackId, RV_TEXT.telegramDown, true); return }
      {
        await ctx.d.saveEditPrompt({
          chat_id: e.chatId, prompt_message_id: String(mid), card_message_id: e.messageId, review_id: r.id, review_version: r.version,
          user_id: e.userId, expires_at: new Date(now.getTime() + EDIT_TTL_MS).toISOString(),
        })
      }
      await answer(ctx.tg, e.callbackId)
      return
    }
  }
}

type Reply = Extract<RvEvent, { kind: 'reply' }>

async function onReply(e: Reply, g: GroupDeps, ctx: Ctx, now: Date) {
  const p = await ctx.d.editPrompt(e.chatId, e.replyTo)
  if (!p || p.user_id !== e.userId) return   // not our prompt, or someone else answering it: ignore
  if (Date.parse(p.expires_at) < now.getTime()) {
    await ctx.d.dropEditPrompt(e.chatId, e.replyTo)
    await say(ctx.tg, e.chatId, RV_TEXT.editTimeout)
    return
  }
  const group = await g.groupByChat(e.chatId)
  const r = await ctx.d.review(p.review_id)
  if (!group || !r || r.business_id !== group.business_id) return
  const res = await doEdit(ctx, r.id, p.review_version, e.text, { channel: 'telegram', profile_id: null, external_id: e.userId, name: e.userName })
  if (!res.ok) { await say(ctx.tg, e.chatId, res.text); return }
  await ctx.d.dropEditPrompt(e.chatId, e.replyTo)
  await ctx.tg('deleteMessage', { chat_id: e.chatId, message_id: Number(e.replyTo) })     // best effort: needs no rights
  await ctx.tg('deleteMessage', { chat_id: e.chatId, message_id: Number(e.messageId) })   // best effort: needs admin rights
}

export async function handleReviewsEvent(e: RvEvent, g: GroupDeps, ctx: Ctx): Promise<void> {
  if (e.id && !(await g.claimInbound(e.id))) return   // Telegram re-delivered this update
  const now = g.now()
  switch (e.kind) {
    case 'private': await say(ctx.tg, e.chatId, RV_TEXT.privateHelp); return
    case 'migrated':
      await g.migrateGroupChat(e.chatId, e.newChatId)
      await ctx.d.migrateCards(e.chatId, e.newChatId)
      return
    case 'bot_removed': {
      const group = await g.groupByChat(e.chatId)
      if (group) { await g.markGroupUnlinked(group.id, now); await ctx.d.deleteRoutes(group.id) }
      return
    }
    case 'callback': return onCallback(e, g, ctx, now)
    case 'reply': return onReply(e, g, ctx, now)
    case 'command':
      if (e.command === 'help') { await say(ctx.tg, e.chatId, RV_TEXT.help); return }
      if (e.command === 'link') return link(e, g, ctx, now)
      return pending(e, g, ctx)
  }
}

export async function setupReviewsBot(cfg: { token: string; webhookUrl: string; secret: string; fetchFn?: typeof fetch }): Promise<{ ok: boolean; errors: string[] }> {
  const f = cfg.fetchFn ?? fetch
  const errors: string[] = []
  const call = async (method: string, body: unknown) => {
    try {
      const r = await f(`${TG_API}/bot${cfg.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) errors.push(`${method}: ${r.status} ${String(j?.description ?? '').replaceAll(cfg.token, '***')}`.trim())
    } catch (e) { errors.push(`${method}: ${String((e as Error)?.message ?? e).replaceAll(cfg.token, '***')}`) }
  }
  await call('setWebhook', { url: cfg.webhookUrl, secret_token: cfg.secret, allowed_updates: ['message', 'my_chat_member', 'callback_query'] })
  await call('setMyCommands', { commands: [{ command: 'help', description: 'How Blueroll reviews work' }] })
  await call('setMyCommands', { scope: { type: 'all_group_chats' }, commands: [
    { command: 'pending', description: 'Show reviews that need a reply' },
    { command: 'link', description: 'Link this group to Blueroll' },
    { command: 'help', description: 'How Blueroll reviews work' },
  ] })
  return { ok: errors.length === 0, errors }
}
