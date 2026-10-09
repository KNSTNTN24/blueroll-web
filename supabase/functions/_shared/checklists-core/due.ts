import type { CompletionLite, DueChecklist, Person, Template } from './types.ts'
// @ts-ignore TS5097 under web tsc (Deno requires the .ts extension); harmless in Deno
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
    const start = periodStartUtc(t.frequency, now, tz).getTime()
    const done = completions.filter((c) =>
      c.template_id === t.id && c.site_id === siteId && new Date(c.completed_at).getTime() >= start).length
    if (done >= need) continue
    const dl = deadlineUtc(t.deadline_time, now, tz)
    out.push({
      template: t, site_id: siteId, deadline_utc: dl ? dl.toISOString() : null,
      period_key: periodKey(t.frequency, now, tz), overdue: !!dl && now.getTime() > dl.getTime(),
    })
  }
  return out
}
