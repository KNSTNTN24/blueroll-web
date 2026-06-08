// Status + ordering for checklist cards. Counter model for multi-per-day
// (spec 2026-06-07 v-next, items 4+5): done when today's completions >= min;
// min 0 = optional (never pending/overdue). Single-per-day keeps the legacy
// pending/completed/awaiting-sign-off states + an Overdue state past deadline.
export type TemplateLike = {
  name: string
  frequency: string
  deadline_time: string | null
  multi_per_day: boolean
  min_per_day: number
  supervisor_role: string | null
}
export type CompletionLike = { signed_off_by: string | null }
export type Status = {
  label: string
  status: 'success' | 'warning' | 'info' | 'neutral'
  done: boolean
}

function pastDeadline(deadline: string | null, now: Date): boolean {
  if (!deadline) return false
  const [h, m] = deadline.split(':').map(Number)
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  return now > d
}

export function checklistStatus(
  t: TemplateLike,
  periodCompletions: CompletionLike[],
  now: Date = new Date(),
): Status {
  if (t.multi_per_day) {
    const n = periodCompletions.length
    const min = Math.max(0, t.min_per_day)
    if (min === 0) return { label: `${n} today`, status: 'success', done: true }
    if (n >= min) return { label: `${n}/${min} today`, status: 'success', done: true }
    return { label: `${n}/${min} today`, status: 'neutral', done: false }
  }
  const completion = periodCompletions[0]
  if (!completion) {
    if (pastDeadline(t.deadline_time, now)) return { label: 'Overdue', status: 'warning', done: false }
    return { label: 'Pending', status: 'neutral', done: false }
  }
  if (completion.signed_off_by) return { label: 'Signed Off', status: 'success', done: true }
  if (t.supervisor_role) return { label: 'Awaiting Sign-off', status: 'warning', done: true }
  return { label: 'Completed', status: 'success', done: true }
}

export function compareTemplates(
  a: { t: TemplateLike; done: boolean },
  b: { t: TemplateLike; done: boolean },
): number {
  if (a.done !== b.done) return a.done ? 1 : -1
  const ad = a.t.deadline_time, bd = b.t.deadline_time
  if (ad !== bd) {
    if (ad === null) return 1
    if (bd === null) return -1
    if (ad !== bd) return ad < bd ? -1 : 1
  }
  return a.t.name.localeCompare(b.t.name)
}
