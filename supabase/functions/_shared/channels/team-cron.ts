// supabase/functions/_shared/channels/team-cron.ts
// WhatsApp teams step of the 10-minute cron (spec 2026-10-12 §5): per team, the morning list (once per member per day),
// one nudge per overdue checklist, and the missed summary; plus the 🎉 the bot sends when a submit closes the day.
// Every message is claim-then-send on channel_group_events, released on failure (except "can't reach this number").
import type { DueChecklist } from '../checklists-core/types.ts'
import { completionsWindowStart } from '../checklists-core/due.ts'
import type { OutboundMessage, SendFn, SendResult } from './types.ts'
import type { SiteInfo } from './bot.ts'
import type { Team, TeamDeps } from './teams-db.ts'
import type { CompletionWho } from './groups-db.ts'
import { planTeamDay, summaryParams, teamDayTimes } from './team-day.ts'
import { sendTracked, UNREACHABLE_CODES } from './team-members.ts'
import { templateMessage, textMessage } from './whatsapp.ts'
import { hhmm } from './live-list.ts'
import { isBillable } from './service-window.ts'
import { TEAM_TEXT } from './team-text.ts'

export interface TeamRunResult { morning: number; overdue: number; summaries: number; failed: number }

const errMsg = (e: unknown) => String((e as { message?: string })?.message ?? e).slice(0, 200)
/** Worth retrying next run: anything but Meta's "can't reach this number". */
const retryable = (r: SendResult) => !(r.errorCode != null && UNREACHABLE_CODES.has(r.errorCode))

export const teamLabel = (team: Team, site: SiteInfo) => `${team.title} (${site.name})`

/**
 * Morning list (ruling F2): ALWAYS the approved `checklist_reminder_list` with the "Show checks" quick reply, even with a
 * single open checklist. {{1}} count, {{2}} team label, {{3}} "Name (HH:MM), Name".
 */
export function morningMessage(to: string, team: Team, site: SiteInfo, open: DueChecklist[]): { msg: OutboundMessage; template: 'checklist_reminder_list' } {
  const list = open.map((x) => (x.deadline_utc ? `${x.template.name} (${hhmm(x.deadline_utc, site.timezone)})` : x.template.name)).join(', ')
  return { msg: templateMessage(to, 'checklist_reminder_list', [String(open.length), teamLabel(team, site), list], [`checks:${team.id}`]), template: 'checklist_reminder_list' }
}

export async function runWhatsAppTeams(t: TeamDeps, send: SendFn, now: Date): Promise<TeamRunResult> {
  const res: TeamRunResult = { morning: 0, overdue: 0, summaries: 0, failed: 0 }
  const ready = new Map<string, boolean>()
  // Completions per business for this run: teams of one business share one fetch (re-fetched only for an earlier window).
  const loaded = new Map<string, { since: number; rows: CompletionWho[] }>()
  const completionsFor = async (businessId: string, since: Date): Promise<CompletionWho[]> => {
    const c = loaded.get(businessId)
    if (c && c.since <= since.getTime()) return c.rows
    const rows = await t.completionsSince(businessId, since)
    loaded.set(businessId, { since: since.getTime(), rows })
    return rows
  }
  for (const team of await t.liveTeams()) {
    try {
      if (!ready.has(team.business_id)) ready.set(team.business_id, await t.ready(team.business_id))
      if (!ready.get(team.business_id)) continue
      const site = await t.site(team.site_id)
      if (!site) continue
      // Active, mapped, site_id null or the team's site (TeamDeps filters; the planner does not).
      const templates = await t.teamTemplates(team)
      if (!templates.length) continue
      // Before the morning time nothing can be due: every deadline is ≥ morning + 1 h and the summary comes later still.
      if (now.getTime() < teamDayTimes(templates, site.timezone, now).morningAt.getTime()) continue
      const completions = await completionsFor(team.business_id, completionsWindowStart(templates, [site.timezone], now))
      const plan = planTeamDay({ templates, siteId: site.id, tz: site.timezone, now, completions })
      if (!plan.morning && !plan.overdue.length && !plan.summary) continue
      const recipients = await t.recipients(team)
      const base = { business_id: team.business_id, site_id: site.id }

      if (plan.morning) {
        for (const r of recipients) {
          const kind = `morning:${r.member_id}`
          if (!(await t.claimEvent(team.id, kind, plan.date))) continue
          const m = morningMessage(r.phone, team, site, plan.state.open)
          const s = await sendTracked(t, send, { ...base, to: r.phone, msg: m.msg, profile_id: r.profile_id, kind: 'team_morning', template_name: m.template, lastInboundAt: r.last_inbound_at })
          if (s.ok) res.morning++
          else { res.failed++; if (retryable(s)) await t.releaseEvent(team.id, kind, plan.date) }
        }
      }

      for (const item of plan.overdue) {
        const key = `${item.template.id}:${item.period_key}`
        if (!(await t.claimEvent(team.id, 'overdue', key))) continue
        let ok = 0
        let retry = false
        for (const r of recipients) {
          const msg = templateMessage(r.phone, 'checklist_reminder', [item.template.name, hhmm(item.deadline_utc!, site.timezone), teamLabel(team, site)], [`tfill:${team.id}:${item.template.id}`])
          const s = await sendTracked(t, send, { ...base, to: r.phone, msg, profile_id: r.profile_id, kind: 'team_overdue', template_name: 'checklist_reminder', lastInboundAt: r.last_inbound_at })
          if (s.ok) ok++
          else { res.failed++; retry ||= retryable(s) }
        }
        if (ok) res.overdue++
        else if (retry) await t.releaseEvent(team.id, 'overdue', key)
      }

      if (plan.summary) {
        const p = summaryParams(team.title, site.name, plan.state)
        // Ruling D1: owners of the business + managers of the team's site, fetched once per team.
        let managers: Set<string> | null = null
        const summaryManagers = async () => (managers ??= new Set(await t.summaryManagerIds(team)))
        // Spec §5: managers ALWAYS get the app notification — its own claim, once per team per day, whatever WhatsApp does.
        if (await t.claimEvent(team.id, 'day_end_app', plan.date)) {
          const n = { type: 'team', title: TEAM_TEXT.missedTitle(team.title), message: TEAM_TEXT.summary(p[0], p[1], Number(p[2]), Number(p[3]), p[4]), link: '/checklists' }
          await t.insertNotifications([...await summaryManagers()].map((user_id) => ({ user_id, ...n })))
        }
        if (await t.claimEvent(team.id, 'day_end', plan.date)) {
          // Members first, then those managers linked on WhatsApp; one message per number (a manager may also be a member).
          const targets = new Map<string, { profile_id: string; last_inbound_at: string | null }>()
          for (const r of recipients) targets.set(r.phone, r)
          const mgr = await summaryManagers()
          for (const m of await t.managerContacts(team.business_id)) if (mgr.has(m.profile_id) && !targets.has(m.phone)) targets.set(m.phone, m)
          let ok = 0
          let retry = false
          for (const [phone, x] of targets) {
            const s = await sendTracked(t, send, { ...base, to: phone, msg: templateMessage(phone, 'team_day_summary', p, []), profile_id: x.profile_id, kind: 'team_summary', template_name: 'team_day_summary', lastInboundAt: x.last_inbound_at })
            if (s.ok) ok++
            else { res.failed++; retry ||= retryable(s) }
          }
          if (!ok && retry) await t.releaseEvent(team.id, 'day_end', plan.date)   // e.g. template not approved yet: the next run retries
          else res.summaries++
        }
      }
    } catch (err) {
      res.failed++
      console.error('whatsapp team run failed', team.id, errMsg(err))
    }
  }
  return res
}

/** A submit closed the team's last open checklist today: 🎉 (free-form, so only inside each member's 24 h window). */
export async function celebrateTeam(t: TeamDeps, send: SendFn, team: Team, date: string, now: Date): Promise<number> {
  // Never released, even if every send fails or nobody is inside their window: the day is done, so no summary is due
  // either, and the claim only stops a second 🎉.
  if (!(await t.claimEvent(team.id, 'day_end', date))) return 0
  let n = 0
  for (const r of await t.recipients(team)) {
    if (isBillable(r.last_inbound_at, now)) continue
    const s = await sendTracked(t, send, { to: r.phone, msg: textMessage(r.phone, TEAM_TEXT.allDone(team.title)), business_id: team.business_id,
      site_id: team.site_id, profile_id: r.profile_id, kind: 'team_all_done', lastInboundAt: r.last_inbound_at })
    if (s.ok) n++
  }
  return n
}
