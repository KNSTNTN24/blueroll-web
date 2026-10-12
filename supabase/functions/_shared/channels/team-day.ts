// supabase/functions/_shared/channels/team-day.ts
// A WhatsApp team's day (spec 2026-10-12 §5), pure: what is open/done at the team's site, when the morning list and the
// missed summary are due, which checklists are overdue now, and the "first submit wins" take key.
import type { DueChecklist, Template } from '../checklists-core/types.ts'
import { dueAtSite } from '../checklists-core/due.ts'
import { deadlineUtc, periodStartUtc } from '../checklists-core/time.ts'
import { localDate } from './live-list.ts'
import type { CompletionWho } from './groups-db.ts'

export const MORNING_LEAD_MS = 3600_000
export const SUMMARY_DELAY_MS = 3600_000
// Ruling F11: the overdue nudge is only due within 1 h after the deadline (a cron outage longer than that skips it).
export const OVERDUE_WINDOW_MS = 3600_000
export const MORNING_FALLBACK = '08:00'
export const SUMMARY_FALLBACK = '22:00'
// Ruling F11: the missed summary is capped at 23:50 local so a late deadline cannot push it into tomorrow.
export const SUMMARY_LATEST = '23:50'

export interface DoneItem { template: Template; completedAt: string; by: string | null }
export interface TeamDayState { open: DueChecklist[]; done: DoneItem[] }
export interface TeamDayPlan { date: string; state: TeamDayState; morning: boolean; overdue: DueChecklist[]; summary: boolean }
type DayArgs = { templates: Template[]; siteId: string; tz: string; now: Date; completions: CompletionWho[] }

const freqOf = (t: Template) => (t.multi_per_day ? 'daily' : t.frequency)

/** Counts towards "missed" and "all done": daily or several-a-day checklists, and anything with a deadline. */
export const countsToday = (t: Template): boolean => t.multi_per_day || t.frequency === 'daily' || !!t.deadline_time

export function todayOnly(s: TeamDayState): TeamDayState {
  return { open: s.open.filter((x) => countsToday(x.template)), done: s.done.filter((x) => countsToday(x.template)) }
}

export function teamDayState(a: DayArgs): TeamDayState {
  const open = dueAtSite({ templates: a.templates, siteId: a.siteId, tz: a.tz, now: a.now, completions: a.completions })
  const openIds = new Set(open.map((x) => x.template.id))
  const done = a.templates.filter((t) => t.active && (t.site_id === null || t.site_id === a.siteId) && !openIds.has(t.id)).flatMap((t) => {
    const start = periodStartUtc(freqOf(t), a.now, a.tz).getTime()
    const last = a.completions
      .filter((c) => c.template_id === t.id && c.site_id === a.siteId && new Date(c.completed_at).getTime() >= start)
      .sort((x, y) => new Date(y.completed_at).getTime() - new Date(x.completed_at).getTime())[0]
    return last ? [{ template: t, completedAt: last.completed_at, by: last.completed_by ?? null }] : []
  })
  return { open, done }
}

const atLocal = (hhmm: string, now: Date, tz: string): Date => deadlineUtc(hhmm, now, tz)!

export function teamDayTimes(templates: Template[], tz: string, now: Date): { morningAt: Date; summaryAt: Date; date: string } {
  const deadlines = templates.filter((t) => t.active && t.deadline_time)
    .map((t) => deadlineUtc(t.deadline_time, now, tz)).filter((x): x is Date => !!x).map((x) => x.getTime())
  const morningAt = deadlines.length ? new Date(Math.min(...deadlines) - MORNING_LEAD_MS) : atLocal(MORNING_FALLBACK, now, tz)
  const summaryAt = deadlines.length
    ? new Date(Math.min(Math.max(...deadlines) + SUMMARY_DELAY_MS, atLocal(SUMMARY_LATEST, now, tz).getTime()))
    : atLocal(SUMMARY_FALLBACK, now, tz)
  return { morningAt, summaryAt, date: localDate(now, tz) }
}

export function planTeamDay(a: DayArgs): TeamDayPlan {
  const state = teamDayState(a)
  const { morningAt, summaryAt, date } = teamDayTimes(a.templates, a.tz, a.now)
  const t = a.now.getTime()
  return {
    date, state,
    morning: state.open.length > 0 && t >= morningAt.getTime() && t < summaryAt.getTime(),
    overdue: state.open.filter((x) => {
      if (!x.deadline_utc) return false
      const dl = new Date(x.deadline_utc).getTime()
      return t >= dl && t < dl + OVERDUE_WINDOW_MS
    }),
    summary: todayOnly(state).open.length > 0 && t >= summaryAt.getTime(),
  }
}

/** One take per (team, checklist, site, period); a several-a-day checklist has one take per slot (#1, #2, …). */
export function takePeriodKey(t: Pick<Template, 'multi_per_day'>, periodKey: string, done: number): string {
  return t.multi_per_day ? `${periodKey}#${done + 1}` : periodKey
}

export function doneInPeriod(t: Template, siteId: string, tz: string, now: Date, completions: CompletionWho[]): number {
  const start = periodStartUtc(freqOf(t), now, tz).getTime()
  return completions.filter((c) => c.template_id === t.id && c.site_id === siteId && new Date(c.completed_at).getTime() >= start).length
}

const byDeadline = (a: DueChecklist, b: DueChecklist) =>
  (a.deadline_utc ?? '9').localeCompare(b.deadline_utc ?? '9') || a.template.name.localeCompare(b.template.name)

/** team_day_summary {{1}} team, {{2}} site, {{3}} done, {{4}} total, {{5}} missed names — today's checklists only. */
export function summaryParams(team: string, site: string, s: TeamDayState): [string, string, string, string, string] {
  const t = todayOnly(s)
  return [team, site, String(t.done.length), String(t.open.length + t.done.length), [...t.open].sort(byDeadline).map((x) => x.template.name).join(', ')]
}
