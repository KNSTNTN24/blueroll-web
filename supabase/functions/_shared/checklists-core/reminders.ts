import type { CompletionLite, DueChecklist, Person, Template } from './types.ts'
import { dueChecklists } from './due.ts'

export const LEAD_MINUTES = 30
export const MAX_PER_MESSAGE = 3
export interface Recipient { person: Person; external_id: string; site_id: string; tz: string }
export interface ReminderJob { profile_id: string; external_id: string; site_id: string; items: DueChecklist[] }
export interface NeededCorrective { response_id: string; completed_by: string; business_id: string; site_id: string; created_at: string }
export interface CorrectiveAction { response_id: string; action: 'nudge' | 'alert_no_action' }

export const reminderKey = (profileId: string, templateId: string, siteId: string, periodKey: string) =>
  `${profileId}:${templateId}:${siteId}:${periodKey}`

export function planReminders(args: {
  now: Date; recipients: Recipient[]; templates: Template[]; completions: CompletionLite[]; alreadySent: Set<string>
  /** Only remind about (template, site) pairs that can actually be filled in WhatsApp (published Flow). Default: all. */
  hasFlow?: (templateId: string, siteId: string) => boolean
}): ReminderJob[] {
  const { now, recipients, templates, completions, alreadySent, hasFlow = () => true } = args
  const jobs: ReminderJob[] = []
  for (const r of recipients) {
    const due = dueChecklists({ templates, person: r.person, siteId: r.site_id, tz: r.tz, now, completions })
      .filter((d) => {
        if (!d.deadline_utc || !hasFlow(d.template.id, r.site_id)) return false
        const dl = new Date(d.deadline_utc).getTime()
        return now.getTime() >= dl - LEAD_MINUTES * 60_000 && now.getTime() < dl
          && !alreadySent.has(reminderKey(r.person.profile_id, d.template.id, r.site_id, d.period_key))
      })
      .sort((a, b) => a.deadline_utc!.localeCompare(b.deadline_utc!))
    for (let i = 0; i < due.length; i += MAX_PER_MESSAGE) {
      jobs.push({ profile_id: r.person.profile_id, external_id: r.external_id, site_id: r.site_id, items: due.slice(i, i + MAX_PER_MESSAGE) })
    }
  }
  return jobs
}

export function planCorrective(args: { now: Date; needed: NeededCorrective[]; nudged: Set<string>; alerted: Set<string> }): CorrectiveAction[] {
  const out: CorrectiveAction[] = []
  for (const n of args.needed) {
    const age = args.now.getTime() - new Date(n.created_at).getTime()
    if (age >= 60 * 60_000 && !args.alerted.has(n.response_id)) out.push({ response_id: n.response_id, action: 'alert_no_action' })
    else if (age >= 30 * 60_000 && !args.nudged.has(n.response_id)) out.push({ response_id: n.response_id, action: 'nudge' })
  }
  return out
}
