// supabase/functions/_shared/channels/bot.ts
// WhatsApp conversation logic over injected dependencies (pure; unit-tested with fakes). Checks reach WhatsApp only
// through teams (spec 2026-10-12): one menu per team, any active member fills in, the first submit wins. LINK codes and
// role-assignment reminders are retired; existing identities keep working.
import type { InboundEvent, SendFn, OutboundMessage } from './types.ts'
import type { Person, Template, TemplateItem } from '../checklists-core/types.ts'
import type { CoreDb } from '../checklists-core/record.ts'
import { recordCompletion } from '../checklists-core/record.ts'
import { completionsWindowStart } from '../checklists-core/due.ts'
import { formItems, parseFormAnswers } from '../checklists-core/answers.ts'
import { CORRECTIVE_ACTIONS, itemsHash } from './whatsapp-flows.ts'
import { whatsappUI, type Channel, type ChannelUI, type ManagerAlert } from './ui.ts'
import { renderDueMenu } from './due-menu.ts'
import { hhmm, localDate } from './live-list.ts'
import { doneInPeriod, takePeriodKey, teamDayState, todayOnly, type TeamDayState } from './team-day.ts'
import { handleJoin } from './team-members.ts'
import { celebrateTeam } from './team-cron.ts'
import { TEAM_TEXT } from './team-text.ts'
import type { Team, TeamDeps } from './teams-db.ts'
import type { CompletionWho } from './groups-db.ts'
export { isBillable, SERVICE_WINDOW_MS } from './service-window.ts'

export interface Identity { id: string; business_id: string; profile_id: string; external_id: string }
export interface SiteInfo { id: string; name: string; timezone: string }
export interface FormToken {
  token: string; kind: 'checklist' | 'corrective'; business_id: string; profile_id: string; site_id: string
  template_id: string | null; item_ids: string[] | null; response_id: string | null; expires_at: string; used_at: string | null
  /** WhatsApp team the checklist form was opened from. Absent/null: a corrective form, or a retired role-based form. */
  group_id?: string | null
}
export interface BotDeps extends CoreDb {
  /** Channel this bot instance serves; replies go out on it via `ui` + `send`. */
  channel: Channel
  ui: ChannelUI
  now(): Date
  send: SendFn
  newToken(): string
  findIdentity(externalId: string): Promise<Identity | null>
  touchIdentity(id: string, at: Date): Promise<void>
  revokeIdentity(id: string): Promise<void>
  ready(businessId: string): Promise<boolean>
  person(profileId: string): Promise<Person | null>
  items(templateId: string): Promise<TemplateItem[]>
  /** Published flow for (template, site); item_ids may be stale (editors re-create items on save) — compare items_hash. */
  flowFor(templateId: string, siteId: string): Promise<{ flow_id: string; item_ids: string[]; items_hash: string } | null>
  correctiveFlowId(): string
  saveToken(t: FormToken): Promise<void>
  takeToken(token: string, now: Date, profileId: string): Promise<FormToken | null>   // marks used only if owned by profileId; null if unknown/foreign/used/expired
  setCorrective(responseId: string, notes: string): Promise<{ templateName: string; itemName: string; value: string; unit: string | null; siteName: string; byName: string; businessId: string } | null>
  /** Alert every active owner/manager on each channel they are linked on (see alerts.ts alertManagers). */
  alertManagers(businessId: string, a: ManagerAlert): Promise<void>
  /**
   * Message-log row. Returns false only for an inbound row whose wa_message_id was already logged
   * (unique index uq_channel_inbound_msg → duplicate webhook delivery); true otherwise, including on other log errors.
   */
  log(e: { business_id: string | null; site_id: string | null; profile_id: string | null; direction: 'in' | 'out'; kind: string; template_name?: string; billable: boolean; ref_id?: string; wa_message_id?: string | null }): Promise<boolean>
  /** This person's WhatsApp-recorded answers still awaiting a corrective action (last 2 days), oldest first. */
  pendingCorrective(profileId: string): Promise<PendingCorrective[]>
  /** WhatsApp teams: membership, team checklists, takes, events (teams-db.ts). */
  teams: TeamDeps
}
export interface PendingCorrective { response_id: string; item: TemplateItem; value: string; site_id: string; template_id: string }

/** Bot copy for a channel: identical everywhere except how commands are spelled ('CHECKS' vs '/checks'). */
export function textsFor(ui: Pick<ChannelUI, 'channel' | 'commandWord'>) {
  const w = ui.commandWord
  return {
    unknown: 'Ask your manager to add you to a Blueroll team.',
    unavailable: TEAM_TEXT.unavailable,
    stopped: "You're disconnected from Blueroll. You won't get any more messages. Ask your manager to add you again to reconnect.",
    help: `Blueroll checks: tap Fill in on a reminder, or type ${w('checks')} to see what is due. Type ${w('stop')} to disconnect.`,
    fallback: `I can help with your checks — tap Fill in or type ${w('checks')}.`,
    nothingDue: 'Nothing is due right now 👍',
    appOnly: (name: string) => `${name} can only be completed in the Blueroll app.`,
    missing: (names: string[]) => `Some required answers were missing: ${names.join(', ')}. Please fill in the form again.`,
    formExpired: `This form has expired — type ${w('checks')} to get a new one.`,
    checklistChanged: 'This checklist was updated — here is the new form.',
    correctiveBody: (item: string) => `${item} is out of range. Tell us what you did.`,
    correctiveThanks: 'Thanks — your manager has been told.',
  }
}
/** WhatsApp copy (the plan's exact strings). */
export const TEXT = textsFor(whatsappUI())

const TOKEN_TTL_MS = 24 * 3600 * 1000
const MAX_PENDING_CORRECTIVE = 3

/** Save a one-off `checklist` form token for (person, site, template[, team]) covering `itemIds`; returns the token. */
export async function saveChecklistToken(d: Pick<BotDeps, 'newToken' | 'saveToken' | 'now'>,
  a: { business_id: string; profile_id: string; site_id: string; template_id: string; group_id?: string | null }, itemIds: string[]): Promise<string> {
  const token = d.newToken()
  await d.saveToken({ token, kind: 'checklist', business_id: a.business_id, profile_id: a.profile_id, site_id: a.site_id,
    template_id: a.template_id, item_ids: itemIds, response_id: null, expires_at: new Date(d.now().getTime() + TOKEN_TTL_MS).toISOString(),
    used_at: null, group_id: a.group_id ?? null })
  return token
}

/** Item ids the Telegram Mini App form covers, or null when the checklist can only be completed in the app (required photo / nothing fillable). */
export function telegramFormItemIds(items: TemplateItem[]): string[] | null {
  const fi = formItems(items)
  return fi.unsupportedRequired.length || !fi.supported.length ? null : fi.supported.map((i) => i.id)
}

type Ctx = { business_id: string | null; profile_id: string | null; site_id?: string | null }
async function out(d: BotDeps, ctx: Ctx, msg: OutboundMessage, kind: string) {
  const r = await d.send(msg)
  await d.log({ business_id: ctx.business_id, site_id: ctx.site_id ?? null, profile_id: ctx.profile_id, direction: 'out', kind, billable: false, wa_message_id: r.id })
}

/** Value with its unit for alerts ('9 °C'); values without a unit are returned as-is. */
export const withUnit = (value: string, unit: string | null | undefined) => (unit ? `${value} ${unit}` : value)

function valueText(item: TemplateItem, value: string): string {
  if (item.item_type === 'yes_no') return 'Answered: No'
  const u = item.unit ?? '°C'
  const lim = item.min_value != null && item.max_value != null ? `limit ${item.min_value}–${item.max_value} ${u}`
    : item.min_value != null ? `limit ${item.min_value} ${u} or above` : `limit ${item.max_value} ${u} or below`
  return `${value} ${u} (${lim})`
}

async function sendCorrectiveForm(d: BotDeps, from: string, person: Person, c: { site_id: string; template_id: string; response_id: string; item: TemplateItem; value: string }) {
  if (d.ui.channel !== 'whatsapp') return
  const flowId = d.correctiveFlowId()
  if (!flowId) {
    // Not configured yet (WA_CORRECTIVE_FLOW_ID): the answer stays corrective_status='needed' and managers were notified in-app.
    console.error('whatsapp: WA_CORRECTIVE_FLOW_ID is not set — corrective form not sent for response', c.response_id)
    return
  }
  const token = d.newToken()
  const msg = d.ui.corrective(from, { token, flowId, itemName: c.item.name, valueText: valueText(c.item, c.value) })
  if (!msg) return
  await d.saveToken({ token, kind: 'corrective', business_id: person.business_id, profile_id: person.profile_id, site_id: c.site_id,
    template_id: c.template_id, item_ids: null, response_id: c.response_id, expires_at: new Date(d.now().getTime() + TOKEN_TTL_MS).toISOString(), used_at: null })
  await out(d, { business_id: person.business_id, profile_id: person.profile_id, site_id: c.site_id }, msg, 'corrective_flow')
}

// ---- Teams -------------------------------------------------------------------------------------------------------

type Membership = { kind: 'ok'; team: Team; site: SiteInfo } | { kind: 'not_member'; team: Team } | { kind: 'gone' }

/** The person's standing in a team of their business (checked on every form open and submit, spec §5). */
async function membership(d: BotDeps, person: Person, groupId: string): Promise<Membership> {
  const team = await d.teams.teamById(groupId)
  if (!team || team.business_id !== person.business_id) return { kind: 'gone' }
  const m = await d.teams.memberFor(team.id, person.profile_id)
  if (!m || m.status !== 'active') return { kind: 'not_member', team }
  const site = await d.teams.site(team.site_id)
  return site ? { kind: 'ok', team, site } : { kind: 'gone' }
}

interface TeamView { templates: Template[]; completions: CompletionWho[]; state: TeamDayState; names: Map<string, string> }
async function teamView(d: BotDeps, team: Team, site: SiteInfo, now: Date): Promise<TeamView> {
  const templates = await d.teams.teamTemplates(team)
  const completions = templates.length ? await d.teams.completionsSince(team.business_id, completionsWindowStart(templates, [site.timezone], now)) : []
  const state = teamDayState({ templates, siteId: site.id, tz: site.timezone, now, completions })
  const names = await d.teams.firstNames([...new Set(state.done.map((x) => x.by).filter((x): x is string => !!x))])
  return { templates, completions, state, names }
}

/** One team's menu (shipped due-menu format, rows `tfill:<team>:<template>`); false when nothing is open there. */
async function sendTeamMenu(d: BotDeps, from: string, person: Person, team: Team, site: SiteInfo): Promise<boolean> {
  const now = d.now()
  const v = await teamView(d, team, site, now)
  if (!v.state.open.length) return false
  const menu = renderDueMenu({
    siteId: site.id, siteName: TEAM_TEXT.teamHeader(team.title, site.name), tz: site.timezone, now,
    open: v.state.open.map((x) => ({ templateId: x.template.id, name: x.template.name, deadlineUtc: x.deadline_utc })),
    done: v.state.done.map((x) => ({ name: x.template.name, completedAt: x.completedAt, by: (x.by && v.names.get(x.by)) || null })),
    rowId: (templateId) => `tfill:${team.id}:${templateId}`,
  })
  await out(d, { business_id: person.business_id, profile_id: person.profile_id, site_id: site.id }, d.ui.dueMenu(from, menu), 'reply')
  return true
}

/** `checks`: pending corrective forms first, then one menu per team (or only `onlyGroupId` when the person is in it). */
async function sendTeamMenus(d: BotDeps, from: string, person: Person, onlyGroupId: string | null) {
  const ctx = { business_id: person.business_id, profile_id: person.profile_id }
  const all = await d.teams.activeMemberships(person.profile_id)
  if (!all.length) return out(d, ctx, d.ui.text(from, TEAM_TEXT.notInTeam), 'reply')
  const mine = onlyGroupId && all.some((m) => m.group_id === onlyGroupId) ? all.filter((m) => m.group_id === onlyGroupId) : all
  const teams: { team: Team; site: SiteInfo }[] = []
  for (const m of mine) {
    const team = await d.teams.teamById(m.group_id)
    const site = team ? await d.teams.site(team.site_id) : null
    if (team && site) teams.push({ team, site })
  }
  const siteIds = new Set(teams.map((x) => x.site.id))
  const pending = (await d.pendingCorrective(person.profile_id)).filter((p) => siteIds.has(p.site_id))
  for (const p of pending.slice(0, MAX_PENDING_CORRECTIVE)) await sendCorrectiveForm(d, from, person, p)
  let any = false
  for (const x of teams) if (await sendTeamMenu(d, from, person, x.team, x.site)) any = true
  if (!any) await out(d, ctx, d.ui.text(from, TEXT.nothingDue), 'reply')
}

/** "Already done ✓ by <first name> <HH:MM>" and the fresh menu (spec §3 "Others' completions"). */
async function alreadyDone(d: BotDeps, from: string, person: Person, team: Team, site: SiteInfo, by: string | null, atIso: string) {
  await out(d, { business_id: person.business_id, profile_id: person.profile_id, site_id: site.id }, d.ui.text(from, TEAM_TEXT.alreadyDone(by, hhmm(atIso, site.timezone))), 'reply')
  await sendTeamMenu(d, from, person, team, site)
}

/** Flow for one checklist at the team's site (published Flow of the current shape); token bound to person + team. */
async function sendTeamForm(d: BotDeps, from: string, person: Person, t: Template, team: Team) {
  const X = textsFor(d.ui)
  const ctx = { business_id: person.business_id, profile_id: person.profile_id, site_id: team.site_id }
  const appOnly = () => out(d, ctx, d.ui.text(from, X.appOnly(t.name)), 'reply')
  const flow = await d.flowFor(t.id, team.site_id)
  if (!flow) return appOnly()
  // The flow's stored item_ids go stale whenever an editor saves (items are deleted and re-inserted). If the current
  // items still have the published form's shape, the token carries the CURRENT ids by position; otherwise the published
  // form no longer matches the checklist and we don't send it (the next sync republishes).
  const items = await d.items(t.id)
  const current = formItems(items).supported
  if (current.length !== flow.item_ids.length || (await itemsHash(t.name, items)) !== flow.items_hash) return appOnly()
  const token = await saveChecklistToken(d, { business_id: person.business_id, profile_id: person.profile_id, site_id: team.site_id, template_id: t.id, group_id: team.id }, current.map((i) => i.id))
  const msg = d.ui.form(from, { templateName: t.name, token, flowId: flow.flow_id })
  if (!msg) return appOnly()
  await out(d, ctx, msg, 'flow')
}

/** Button `tfill:<team>:<template>`: membership + mapping checked; a closed checklist answers "Already done". */
async function openTeamForm(d: BotDeps, from: string, person: Person, groupId: string, templateId: string) {
  const X = textsFor(d.ui)
  const ctx = { business_id: person.business_id, profile_id: person.profile_id }
  const ms = await membership(d, person, groupId)
  if (ms.kind === 'gone') return out(d, ctx, d.ui.text(from, X.formExpired), 'reply')
  if (ms.kind === 'not_member') return out(d, ctx, d.ui.text(from, TEAM_TEXT.noLongerIn(ms.team.title)), 'reply')
  const v = await teamView(d, ms.team, ms.site, d.now())
  const template = v.templates.find((t) => t.id === templateId)
  if (!template) return out(d, ctx, d.ui.text(from, X.formExpired), 'reply')
  if (!v.state.open.some((x) => x.template.id === templateId)) {
    const last = v.state.done.find((x) => x.template.id === templateId)
    if (!last) return out(d, ctx, d.ui.text(from, X.formExpired), 'reply')
    return alreadyDone(d, from, person, ms.team, ms.site, (last.by && v.names.get(last.by)) || null, last.completedAt)
  }
  return sendTeamForm(d, from, person, template, ms.team)
}

/** Flow submit with a team token (spec §5 steps 1–4). */
async function submitTeamForm(d: BotDeps, from: string, person: Person, tok: FormToken, response: Record<string, unknown>) {
  const X = textsFor(d.ui)
  const now = d.now()
  const ctx = { business_id: person.business_id, profile_id: person.profile_id, site_id: tok.site_id }
  const reply = (body: string) => out(d, ctx, d.ui.text(from, body), 'reply')
  // 1. Still an active member of the token's team, checklist still mapped, same site. (A token without a team was
  //    sent by the retired role-based flow.)
  if (!tok.group_id) return reply(X.formExpired)
  const ms = await membership(d, person, tok.group_id)
  if (ms.kind === 'gone') return reply(X.formExpired)
  if (ms.kind === 'not_member') return reply(TEAM_TEXT.noLongerIn(ms.team.title))
  const { team, site } = ms
  if (site.id !== tok.site_id) return reply(X.formExpired)
  const v = await teamView(d, team, site, now)
  const template = v.templates.find((t) => t.id === tok.template_id)
  if (!template) return reply(X.formExpired)
  // 2. Already closed — a completion from any source, or someone else's submit holds this period's take — is answered
  //    before the answers are validated, so nobody is asked to refill a checklist that is already done.
  const takenBy = async (owner: { profile_id: string | null; taken_at: string } | null) => {
    const name = owner?.profile_id ? (await d.teams.firstNames([owner.profile_id])).get(owner.profile_id) ?? null : null
    return alreadyDone(d, from, person, team, site, name, owner?.taken_at ?? now.toISOString())
  }
  const open = v.state.open.find((x) => x.template.id === template.id)
  if (!open) {
    const last = v.state.done.find((x) => x.template.id === template.id)
    return alreadyDone(d, from, person, team, site, (last?.by && v.names.get(last.by)) || null, last?.completedAt ?? now.toISOString())
  }
  const done = doneInPeriod(template, site.id, site.timezone, now, v.completions)
  const key = { group_id: team.id, template_id: template.id, site_id: site.id, period_key: takePeriodKey(template, open.period_key, done) }
  const held = await d.teams.takeOwner(key)
  if (held && held.profile_id !== person.profile_id) return takenBy(held)
  const items = await d.items(template.id)
  const ids = tok.item_ids ?? []
  // Items re-created since the form was sent (editor save) — answers can't be mapped safely: record nothing, resend.
  const known = new Set(items.map((i) => i.id))
  if (ids.some((x) => !known.has(x))) { await reply(X.checklistChanged); return sendTeamForm(d, from, person, template, team) }
  const parsed = parseFormAnswers(ids, items, response)
  if (parsed.missingRequired.length) { await reply(X.missing(parsed.missingRequired)); return sendTeamForm(d, from, person, template, team) }
  // The claim itself (atomic, across every team mapping it at this site): a concurrent submit may still win here.
  if (!(await d.teams.claimTake(key, person.profile_id, now))) return takenBy(await d.teams.takeOwner(key))
  // 3. Record (out-of-range → corrective form → manager alert, unchanged).
  let rec: Awaited<ReturnType<typeof recordCompletion>>
  try {
    rec = await recordCompletion(d, { person, siteId: site.id, template, items, answers: parsed.answers, source: 'whatsapp', now })
  } catch (err) {
    // Free the checklist so it can be filled in again — from a NEW form (checks / Fill in): this token is already used,
    // and Meta's retry of this submit is dropped as a duplicate inbound message, so this person gets no reply here.
    await d.teams.releaseTake(key, person.profile_id)
    throw err
  }
  for (const fl of rec.flagged) {
    await sendCorrectiveForm(d, from, person, { site_id: site.id, template_id: template.id, response_id: fl.responseId, item: fl.item, value: fl.value })
  }
  // 4. That closed the team's last open checklist today → 🎉 (once per team per day, open windows only).
  const before = todayOnly(v.state).open
  const after = todayOnly(teamDayState({ templates: v.templates, siteId: site.id, tz: site.timezone, now,
    completions: [...v.completions, { template_id: template.id, site_id: site.id, completed_at: now.toISOString(), completed_by: person.profile_id }] })).open
  if (before.some((x) => x.template.id === template.id) && !after.length) await celebrateTeam(d.teams, d.send, team, localDate(now, site.timezone), now)
}

// ---- Entry point -------------------------------------------------------------------------------------------------

export async function handleInbound(e: InboundEvent, d: BotDeps): Promise<void> {
  const X = textsFor(d.ui)
  const reply = (body: string) => d.ui.text(e.from, body)
  const now = d.now()
  const waId = e.id || null
  const id = await d.findIdentity(e.from)
  // Every inbound row is logged FIRST: uq_channel_inbound_msg turns a duplicate webhook delivery into a no-op
  // before anything is consumed, recorded or sent.
  if (!(await d.log({ business_id: id?.business_id ?? null, site_id: null, profile_id: id?.profile_id ?? null, direction: 'in', kind: e.kind, billable: false, wa_message_id: waId }))) return
  // Join comes from a number that is not linked yet (or linked to another business): before the identity checks.
  if (e.kind === 'button' && e.payload.startsWith('join:')) return handleJoin(d.teams, d.send, { from: e.from, memberId: e.payload.slice(5) })
  if (!id) return out(d, { business_id: null, profile_id: null }, reply(X.unknown), 'reply')
  await d.touchIdentity(id.id, now)
  const ctx = { business_id: id.business_id, profile_id: id.profile_id }
  // STOP / HELP work regardless of whether the business can use WhatsApp right now.
  if (e.kind === 'text') {
    const cmd = e.text.trim().toLowerCase()
    if (cmd === 'stop') { await d.revokeIdentity(id.id); return out(d, ctx, reply(X.stopped), 'reply') }
    if (cmd === 'help') return out(d, ctx, reply(X.help), 'reply')
  }
  if (!(await d.ready(id.business_id))) return out(d, ctx, reply(X.unavailable), 'reply')
  const person = await d.person(id.profile_id)
  if (!person) return out(d, ctx, reply(X.unknown), 'reply')

  if (e.kind === 'contact') return out(d, ctx, reply(X.fallback), 'reply')   // manager commands: Task 8
  if (e.kind === 'text') {
    if (e.text.trim().toLowerCase() === 'checks') return sendTeamMenus(d, e.from, person, null)
    return out(d, ctx, reply(X.fallback), 'reply')
  }
  if (e.kind === 'button') {
    // `fill:` = the button of a reminder from the retired role-based flow: show the team menus instead.
    if (e.payload === 'checks' || e.payload.startsWith('fill:')) return sendTeamMenus(d, e.from, person, null)
    const c = e.payload.match(/^checks:([0-9a-zA-Z-]+)$/)
    if (c) return sendTeamMenus(d, e.from, person, c[1])
    const f = e.payload.match(/^tfill:([0-9a-zA-Z-]+):([0-9a-zA-Z-]+)$/)
    if (f) return openTeamForm(d, e.from, person, f[1], f[2])
    return out(d, ctx, reply(X.fallback), 'reply')
  }

  // flow reply
  const tok = await d.takeToken(e.token, now, id.profile_id)
  if (!tok) return out(d, ctx, reply(X.formExpired), 'reply')
  if (tok.profile_id !== id.profile_id) return
  if (tok.kind === 'checklist') return submitTeamForm(d, e.from, person, tok, e.response)
  // corrective
  const action = CORRECTIVE_ACTIONS.find((a) => a.id === e.response.action)?.title ?? 'Other'
  const details = typeof e.response.details === 'string' && e.response.details.trim() ? `: ${e.response.details.trim()}` : ''
  const info = tok.response_id ? await d.setCorrective(tok.response_id, `${action}${details}`) : null
  if (info) {
    const site = await d.teams.site(tok.site_id)
    const time = hhmm(now.toISOString(), site?.timezone ?? 'Europe/London')
    await d.alertManagers(info.businessId, { siteName: info.siteName, itemName: info.itemName, value: withUnit(info.value, info.unit), time, byName: info.byName, action: `${action}${details}` })
  }
  await out(d, ctx, reply(X.correctiveThanks), 'reply')
}
