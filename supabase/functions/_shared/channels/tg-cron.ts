// supabase/functions/_shared/channels/tg-cron.ts
// Telegram groups step of the 10-minute cron (spec §4, §8): take down lists of unlinked groups and of teams that can't
// use Telegram now; daily permission check; group reminders (repost); silent refresh of every other list.
import type { GroupDeps } from './groups-db.ts'
import type { TgApi } from './telegram.ts'
import { deleteListMessage, refreshList, repostList } from './tg-live.ts'
import { checkGroupPermissions } from './tg-group-bot.ts'
import { sitesForGroup } from './live-list.ts'
import { planGroupReminders } from '../checklists-core/reminders.ts'
import { completionsWindowStart } from '../checklists-core/due.ts'

export interface GroupRunResult { reposted: number; refreshed: number; removed: number; warned: number; failed: number }

const errMsg = (e: unknown) => String((e as { message?: string })?.message ?? e).slice(0, 200)

export async function runTelegramGroups(d: GroupDeps, api: TgApi, now: Date): Promise<GroupRunResult> {
  const res: GroupRunResult = { reposted: 0, refreshed: 0, removed: 0, warned: 0, failed: 0 }

  // Unlinked in Settings (the web app can't call the Bot API): delete the message, then the row.
  for (const { row, chat_id } of await d.orphanLiveLists()) {
    if (await d.deleteLiveList(row.id, row.message_id)) { await deleteListMessage(api, chat_id, row.message_id); res.removed++ }
  }

  const ready = new Map<string, boolean>()
  for (const group of await d.linkedGroups()) {
    try {
      if (!ready.has(group.business_id)) ready.set(group.business_id, await d.ready(group.business_id))
      const lists = await d.liveLists(group.id)
      if (!ready.get(group.business_id)) {
        // Telegram turned off or subscription lapsed: no reminders, and the lists come down.
        for (const row of lists) {
          if (await d.deleteLiveList(row.id, row.message_id)) { await deleteListMessage(api, group.chat_id, row.message_id); res.removed++ }
        }
        continue
      }
      if (await d.claimPermissionCheck(group.id, now)) {
        if ((await checkGroupPermissions(d, api, group, now)) === 'warned') res.warned++
      }

      const templates = await d.mappedTemplates(group.id)
      const sites = sitesForGroup(templates, await d.sites(group.business_id))
      const reposted = new Set<string>()
      let unlinked = false
      if (templates.length && sites.length) {
        const completions = await d.completionsSince(group.business_id, completionsWindowStart(templates, [...new Set(sites.map((s) => s.timezone))], now))
        for (const job of planGroupReminders({ now, sites, templates, completions })) {
          const keys = job.items.map((it) => ({ template_id: it.template.id, period_key: it.period_key }))
          const claimed = await d.claimGroupReminders(group.id, job.site_id, keys)
          if (!claimed.size) continue
          const o = await repostList(d, api, group, sites.find((s) => s.id === job.site_id)!, now)
          if (o === 'posted') { res.reposted++; reposted.add(job.site_id) }
          else if (o === 'empty') reposted.add(job.site_id)
          else if (o === 'unlinked') { unlinked = true; break }
          else {
            res.failed++
            await d.releaseGroupReminders(group.id, job.site_id, keys.filter((k) => claimed.has(`${k.template_id}:${k.period_key}`)))
          }
        }
      }
      if (unlinked) continue

      for (const row of lists) {
        if (reposted.has(row.site_id)) continue   // replaced this run
        const o = await refreshList(d, api, group, row, sites.find((s) => s.id === row.site_id) ?? null, now)
        if (o === 'edited') res.refreshed++
        else if (o === 'deleted') res.removed++
        else if (o === 'failed') res.failed++
        else if (o === 'unlinked') break
      }
    } catch (err) {
      res.failed++
      console.error('telegram group run failed', group.id, errMsg(err))
    }
  }
  return res
}
