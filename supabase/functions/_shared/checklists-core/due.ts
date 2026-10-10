import type { CompletionLite, DueChecklist, Person, Template } from './types.ts'
import { deadlineUtc, periodKey, periodStartUtc } from './time.ts'

export function isAssigned(t: Template, p: Person): boolean {
  return p.role_id ? t.assigned_role_ids.includes(p.role_id) : t.assigned_roles.includes(p.role)
}

export function availableChecklists(templates: Template[], p: Person, siteId: string): Template[] {
  return templates.filter((t) => t.active && (t.site_id === null || t.site_id === siteId) && isAssigned(t, p))
}

export function dueChecklists(args: {
  templates: Template[]; person: Person; siteId: string; tz: string; now: Date; completions: CompletionLite[]
}): DueChecklist[] {
  const { templates, person, siteId, tz, now, completions } = args
  const out: DueChecklist[] = []
  for (const t of availableChecklists(templates, person, siteId)) {
    const need = t.multi_per_day ? (t.min_per_day ?? 0) : 1
    if (need === 0) continue
    const freq = t.multi_per_day ? 'daily' : t.frequency
    const start = periodStartUtc(freq, now, tz).getTime()
    const done = completions.filter((c) =>
      c.template_id === t.id && c.site_id === siteId && new Date(c.completed_at).getTime() >= start).length
    if (done >= need) continue
    const dl = deadlineUtc(t.deadline_time, now, tz)
    out.push({
      template: t, site_id: siteId, deadline_utc: dl ? dl.toISOString() : null,
      period_key: periodKey(freq, now, tz), overdue: !!dl && now.getTime() > dl.getTime(),
    })
  }
  return out
}

/**
 * Earliest instant any of these templates' current period starts, across the given site timezones
 * (multi-per-day templates count per day). Completions before it can't affect what is due, so loading
 * completions from here keeps the query small. No templates → now.
 */
export function completionsWindowStart(templates: Template[], tzs: string[], now: Date): Date {
  let min = now.getTime()
  for (const t of templates) for (const tz of tzs) {
    min = Math.min(min, periodStartUtc(t.multi_per_day ? 'daily' : t.frequency, now, tz).getTime())
  }
  return new Date(min)
}
