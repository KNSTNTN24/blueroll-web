import type { CompletionLite, DueChecklist, Template } from './types.ts'
import { dueAtSite } from './due.ts'

export const LEAD_MINUTES = 30
export interface NeededCorrective { response_id: string; completed_by: string; business_id: string; site_id: string; created_at: string }
export interface CorrectiveAction { response_id: string; action: 'nudge' | 'alert_no_action' }

export function planCorrective(args: { now: Date; needed: NeededCorrective[]; nudged: Set<string>; alerted: Set<string> }): CorrectiveAction[] {
  const out: CorrectiveAction[] = []
  for (const n of args.needed) {
    const age = args.now.getTime() - new Date(n.created_at).getTime()
    if (age >= 60 * 60_000 && !args.alerted.has(n.response_id)) out.push({ response_id: n.response_id, action: 'alert_no_action' })
    else if (age >= 30 * 60_000 && !args.nudged.has(n.response_id)) out.push({ response_id: n.response_id, action: 'nudge' })
  }
  return out
}

export interface GroupReminderJob { site_id: string; items: DueChecklist[] }

/**
 * Telegram groups (spec §4): what is inside its reminder window right now at each of the group's sites, regardless of
 * assignment. "Once per (group, template, site, period)" is enforced by the caller's claim on
 * channel_group_reminders_sent, not here.
 */
export function planGroupReminders(args: { now: Date; sites: { id: string; timezone: string }[]; templates: Template[]; completions: CompletionLite[] }): GroupReminderJob[] {
  const t = args.now.getTime()
  const jobs: GroupReminderJob[] = []
  for (const s of args.sites) {
    const items = dueAtSite({ templates: args.templates, siteId: s.id, tz: s.timezone, now: args.now, completions: args.completions })
      .filter((d) => {
        if (!d.deadline_utc) return false
        const dl = new Date(d.deadline_utc).getTime()
        return t >= dl - LEAD_MINUTES * 60_000 && t < dl
      })
    if (items.length) jobs.push({ site_id: s.id, items })
  }
  return jobs
}
