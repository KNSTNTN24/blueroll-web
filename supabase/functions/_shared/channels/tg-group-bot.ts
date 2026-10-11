// supabase/functions/_shared/channels/tg-group-bot.ts
// Telegram groups bot (spec §3, §7, §8): /link <code>, /checks, /help in groups; bot removed → unlink; group migrated
// to a supergroup → keep the link; any private message → "use your team's group". Pure over GroupDeps + TgApi.
import { membersCanInvite, tgText, type TgApi, type TgEvent } from './telegram.ts'
import { notifyManagers, type ChannelGroup, type GroupDeps } from './groups-db.ts'
import { repostGroup, unlinkGroup } from './tg-live.ts'

export const GROUP_TEXT = {
  privateHelp: "Blueroll checks happen in your team's Telegram group. Ask your manager to add you.",
  linked: (business: string) => `Linked to ${business}. A manager will choose which checks this group does.`,
  linkUsage: 'To link this group, send /link followed by the 6-digit code from Blueroll → Settings → Messaging.',
  linkInvalid: 'That code is not valid or has expired. Ask a manager for a new code in Blueroll → Settings → Messaging.',
  linkLimited: 'Too many wrong codes. Please try again in an hour.',
  unavailable: "Blueroll checks aren't available for this team right now.",
  notLinked: 'This group is not linked to Blueroll yet. A manager can link it in Blueroll → Settings → Messaging.',
  noChecks: 'No checks are chosen for this group yet. A manager can choose them in Blueroll → Settings → Messaging.',
  nothingDue: 'Nothing is due right now 👍',
  help: 'Blueroll checks: tap a check on the list to fill it in. Send /checks to see the list again.',
  permissionWarning: "Anyone in this group can add people. To keep checks safe, an admin should turn off 'Add members' for members in group settings.",
}

export const MAX_LINK_FAILURES = 5
const LINK_FAILURE_WINDOW_MS = 3600_000

/** Spec §8: on link and once a day — if members can add people, say so in the group and tell managers (≤ once a day). */
export async function checkGroupPermissions(d: GroupDeps, api: TgApi, group: ChannelGroup, now: Date): Promise<'ok' | 'warned' | 'skipped' | 'unknown'> {
  const can = membersCanInvite(await api('getChat', { chat_id: group.chat_id }))
  if (can === null) return 'unknown'
  if (!can) return 'ok'
  if (!(await d.claimPermissionWarning(group.id, now))) return 'skipped'
  await api('sendMessage', tgText(group.chat_id, GROUP_TEXT.permissionWarning))
  await notifyManagers(d, group.business_id, {
    title: 'Telegram group is open to new members',
    message: `Anyone in “${group.title || 'your Telegram group'}” can add people. An admin should turn off 'Add members' for members in the group settings.`,
    link: '/settings',
  })
  return 'warned'
}

type Command = Extract<TgEvent, { kind: 'command' }>

async function link(e: Command, d: GroupDeps, api: TgApi, now: Date) {
  const say = (text: string) => api('sendMessage', tgText(e.chatId, text))
  if (!/^\d{6}$/.test(e.arg)) { await say(GROUP_TEXT.linkUsage); return }
  if (await d.linkFailures(e.chatId, new Date(now.getTime() - LINK_FAILURE_WINDOW_MS)) >= MAX_LINK_FAILURES) { await say(GROUP_TEXT.linkLimited); return }
  const code = await d.claimGroupLinkCode(e.arg, now)
  if (!code) { await d.recordLinkFailure(e.chatId, now); await say(GROUP_TEXT.linkInvalid); return }
  const usedAt = now.toISOString()
  let ready: boolean
  try { ready = await d.ready(code.business_id) }
  catch (err) { await d.releaseGroupLinkCode(e.arg, usedAt); throw err }   // transient: don't burn the manager's code
  if (!ready) { await d.releaseGroupLinkCode(e.arg, usedAt); await say(GROUP_TEXT.unavailable); return }
  const prev = await d.groupByChat(e.chatId)
  if (prev && prev.business_id !== code.business_id) {
    // Old business's lists go; their still-open forms must not outlive the move (tokens carry the old business id).
    const stale = (await d.liveLists(prev.id)).flatMap((l) => Object.values(l.tokens ?? {}))
    await unlinkGroup(d, api, prev, now)
    await d.expireTokens(stale)
  }
  const group = await d.linkGroup({ business_id: code.business_id, chat_id: e.chatId, title: e.chatTitle, linked_by: code.issued_by, now })
  await say(GROUP_TEXT.linked(await d.businessName(code.business_id)))
  await checkGroupPermissions(d, api, group, now)
}

async function checks(e: Command, d: GroupDeps, api: TgApi, now: Date) {
  const say = (text: string) => api('sendMessage', tgText(e.chatId, text))
  const group = await d.groupByChat(e.chatId)
  if (!group) { await say(GROUP_TEXT.notLinked); return }
  if (!(await d.ready(group.business_id))) { await say(GROUP_TEXT.unavailable); return }
  if (!(await d.mappedTemplates(group.id)).length) { await say(GROUP_TEXT.noChecks); return }
  const outcomes = await repostGroup(d, api, group, now)
  if (outcomes.every((o) => o === 'empty')) await say(GROUP_TEXT.nothingDue)
}

export async function handleGroupEvent(e: TgEvent, d: GroupDeps, api: TgApi): Promise<void> {
  if (e.id && !(await d.claimInbound(e.id))) return   // Telegram re-delivered this update
  const now = d.now()
  switch (e.kind) {
    case 'private':
      await api('sendMessage', tgText(e.chatId, GROUP_TEXT.privateHelp))
      return
    case 'migrated':
      await d.migrateGroupChat(e.chatId, e.newChatId)
      return
    case 'bot_removed': {
      const group = await d.groupByChat(e.chatId)
      if (group) await unlinkGroup(d, api, group, now)
      return
    }
    case 'command':
      if (e.command === 'help') { await api('sendMessage', tgText(e.chatId, GROUP_TEXT.help)); return }
      if (e.command === 'link') return link(e, d, api, now)
      return checks(e, d, api, now)
  }
}
