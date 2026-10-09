// supabase/functions/_shared/channels/bot.ts
// Channel conversation logic over injected dependencies (pure; unit-tested with fakes).
import type { InboundEvent, SendFn, OutboundMessage } from './types.ts'
import type { CompletionLite, Person, Template, TemplateItem } from '../checklists-core/types.ts'
import type { CoreDb } from '../checklists-core/record.ts'
import { recordCompletion } from '../checklists-core/record.ts'
import { availableChecklists, completionsWindowStart, dueChecklists } from '../checklists-core/due.ts'
import { formItems, parseFormAnswers } from '../checklists-core/answers.ts'
import { CORRECTIVE_ACTIONS, itemsHash } from './whatsapp-flows.ts'
import { whatsappUI, type Channel, type ChannelUI, type ManagerAlert } from './ui.ts'

export interface Identity { id: string; business_id: string; profile_id: string; external_id: string }
export interface SiteInfo { id: string; name: string; timezone: string }
export interface FormToken {
  token: string; kind: 'checklist' | 'corrective'; business_id: string; profile_id: string; site_id: string
  template_id: string | null; item_ids: string[] | null; response_id: string | null; expires_at: string; used_at: string | null
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
  consumeLinkCode(code: string, externalId: string, now: Date): Promise<{ ok: true; identity: Identity; siteName: string; name: string } | { ok: false }>
  ready(businessId: string): Promise<boolean>
  person(profileId: string): Promise<Person | null>
  sitesFor(profileId: string): Promise<SiteInfo[]>
  templates(businessId: string): Promise<Template[]>
  items(templateId: string): Promise<TemplateItem[]>
  completionsSince(businessId: string, since: Date): Promise<CompletionLite[]>
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
  linkFailures(externalId: string, since: Date): Promise<number>
  recordLinkFailure(externalId: string, at: Date): Promise<void>
  /** This person's WhatsApp-recorded answers still awaiting a corrective action (last 2 days), oldest first. */
  pendingCorrective(profileId: string): Promise<PendingCorrective[]>
}
export interface PendingCorrective { response_id: string; item: TemplateItem; value: string; site_id: string; template_id: string }

/** Bot copy for a channel: identical everywhere except how commands are spelled ('CHECKS' vs '/checks'). */
export function textsFor(ui: Pick<ChannelUI, 'channel' | 'commandWord'>) {
  const w = ui.commandWord
  return {
    linked: (name: string, site: string) => `Hi ${name} 👋 You're connected to ${site}. I'll remind you before your checks are due. ${ui.channel === 'telegram' ? 'Send' : 'Reply'} ${w('stop')} anytime.`,
    linkExpired: 'This link has expired — ask your manager for a new QR code.',
    unknown: 'Ask your manager for a QR code to connect to Blueroll.',
    unavailable: "Blueroll checks aren't available for your team right now. Please use the Blueroll app.",
    stopped: "You're disconnected from Blueroll. You won't get any more messages. Ask your manager for a new QR code to reconnect.",
    help: `Blueroll checks: tap Fill in on a reminder, or type ${w('checks')} to see what is due. Type ${w('stop')} to disconnect.`,
    fallback: `I can help with your checks — tap Fill in or type ${w('checks')}.`,
    nothingDue: 'Nothing is due right now 👍',
    dueList: (site: string) => `Checks due at ${site}:`,
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
/** WhatsApp customer-service window: a business-initiated template is free within 24h of the person's last inbound message. */
export const SERVICE_WINDOW_MS = 24 * 3600 * 1000
export const isBillable = (lastInboundAt: string | null | undefined, now: Date) =>
  !lastInboundAt || now.getTime() - new Date(lastInboundAt).getTime() >= SERVICE_WINDOW_MS
const MAX_PENDING_CORRECTIVE = 3
// Brute-force guard on 6-digit LINK codes: at most 5 failed attempts per number per hour.
const MAX_LINK_FAILURES = 5
const LINK_FAILURE_WINDOW_MS = 3600 * 1000

async function out(d: BotDeps, ctx: { business_id: string | null; profile_id: string | null; site_id?: string | null }, msg: OutboundMessage, kind: string) {
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
  // Telegram captures the corrective action inside the Mini App form — no separate corrective message there.
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

async function sendChecklistForm(d: BotDeps, from: string, person: Person, templateId: string, siteId: string) {
  const ctx = { business_id: person.business_id, profile_id: person.profile_id, site_id: siteId }
  const X = textsFor(d.ui)
  const sites = await d.sitesFor(person.profile_id)
  const t = (await d.templates(person.business_id)).find((x) => x.id === templateId)
  if (!t || !sites.some((s) => s.id === siteId) || !availableChecklists([t], person, siteId).length) return out(d, ctx, d.ui.text(from, X.formExpired), 'reply')
  const saveChecklistToken = async (itemIds: string[]) => {
    const token = d.newToken()
    await d.saveToken({ token, kind: 'checklist', business_id: person.business_id, profile_id: person.profile_id, site_id: siteId,
      template_id: templateId, item_ids: itemIds, response_id: null, expires_at: new Date(d.now().getTime() + TOKEN_TTL_MS).toISOString(), used_at: null })
    return token
  }
  if (d.ui.channel === 'telegram') {
    // The Mini App renders the current items directly — no published Flow to match against.
    const fi = formItems(await d.items(templateId))
    if (fi.unsupportedRequired.length || !fi.supported.length) return out(d, ctx, d.ui.text(from, X.appOnly(t.name)), 'reply')
    const token = await saveChecklistToken(fi.supported.map((i) => i.id))
    const msg = d.ui.form(from, { templateName: t.name, token })
    return msg ? out(d, ctx, msg, 'form') : out(d, ctx, d.ui.text(from, X.appOnly(t.name)), 'reply')
  }
  const flow = await d.flowFor(templateId, siteId)
  if (!flow) return out(d, ctx, d.ui.text(from, X.appOnly(t.name)), 'reply')
  // The flow's stored item_ids go stale whenever an editor saves (items are deleted and re-inserted). If the current
  // items still have the published form's shape, the token carries the CURRENT ids by position; otherwise the published
  // form no longer matches the checklist and we don't send it (the next sync republishes).
  const items = await d.items(templateId)
  const current = formItems(items).supported
  if (current.length !== flow.item_ids.length || (await itemsHash(t.name, items)) !== flow.items_hash) {
    return out(d, ctx, d.ui.text(from, X.appOnly(t.name)), 'reply')
  }
  const token = await saveChecklistToken(current.map((i) => i.id))
  const msg = d.ui.form(from, { templateName: t.name, token, flowId: flow.flow_id })
  if (!msg) return out(d, ctx, d.ui.text(from, X.appOnly(t.name)), 'reply')
  await out(d, ctx, msg, 'flow')
}

async function sendDueList(d: BotDeps, from: string, person: Person) {
  const ctx = { business_id: person.business_id, profile_id: person.profile_id }
  const now = d.now()
  const [sites, templates] = await Promise.all([d.sitesFor(person.profile_id), d.templates(person.business_id)])
  const completions = await d.completionsSince(person.business_id, completionsWindowStart(templates, sites.map((s) => s.timezone), now))
  // Out-of-range answers still waiting for an action: re-offer the corrective form first (only for sites the person still has).
  const pending = (await d.pendingCorrective(person.profile_id)).filter((p) => sites.some((s) => s.id === p.site_id))
  for (const p of pending.slice(0, MAX_PENDING_CORRECTIVE)) await sendCorrectiveForm(d, from, person, p)
  let any = false
  for (const s of sites) {
    const due = dueChecklists({ templates, person, siteId: s.id, tz: s.timezone, now, completions })
    if (!due.length) continue
    any = true
    await out(d, { ...ctx, site_id: s.id }, d.ui.choices(from, TEXT.dueList(s.name), due.slice(0, 3).map((x) => ({ id: `fill:${x.template.id}:${s.id}`, title: x.template.name }))), 'reply')
  }
  if (!any) await out(d, ctx, d.ui.text(from, TEXT.nothingDue), 'reply')
}

export async function handleInbound(e: InboundEvent, deps: BotDeps): Promise<void> {
  // Telegram: the first reply to a button press also answers its callback query (stops the client's spinner).
  let callbackId = e.kind === 'button' && deps.ui.channel === 'telegram' ? e.callbackId : undefined
  const d: BotDeps = !callbackId ? deps : {
    ...deps,
    send: (msg) => {
      const m = callbackId ? { ...msg, callback_query_id: callbackId } : msg
      callbackId = undefined
      return deps.send(m)
    },
  }
  const X = textsFor(d.ui)
  const reply = (body: string) => d.ui.text(e.from, body)
  const now = d.now()
  const waId = e.id || null
  // Every inbound row is logged FIRST: uq_channel_inbound_msg turns a duplicate webhook delivery into a no-op
  // before anything is consumed, recorded or sent.
  const claim = (business_id: string | null, profile_id: string | null, kind: string) =>
    d.log({ business_id, site_id: null, profile_id, direction: 'in', kind, billable: false, wa_message_id: waId })
  const m = e.kind === 'text' ? e.text.match(/^\s*link\s*(\d{6})\s*$/i) : null
  if (m) {
    if (!(await claim(null, null, 'link'))) return
    if (await d.linkFailures(e.from, new Date(now.getTime() - LINK_FAILURE_WINDOW_MS)) >= MAX_LINK_FAILURES) {
      return out(d, { business_id: null, profile_id: null }, reply(X.linkExpired), 'link')
    }
    const r = await d.consumeLinkCode(m[1], e.from, now)
    if (!r.ok) await d.recordLinkFailure(e.from, now)
    return out(d, { business_id: r.ok ? r.identity.business_id : null, profile_id: r.ok ? r.identity.profile_id : null },
      reply(r.ok ? X.linked(r.name, r.siteName) : X.linkExpired), 'link')
  }
  const id = await d.findIdentity(e.from)
  if (!(await claim(id?.business_id ?? null, id?.profile_id ?? null, e.kind))) return
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

  if (e.kind === 'text') {
    const cmd = e.text.trim().toLowerCase()
    if (cmd === 'checks') return sendDueList(d, e.from, person)
    return out(d, ctx, reply(X.fallback), 'reply')
  }

  if (e.kind === 'button') {
    if (e.payload === 'checks') return sendDueList(d, e.from, person)
    const f = e.payload.match(/^fill:([0-9a-zA-Z-]+):([0-9a-zA-Z-]+)$/)
    if (f) return sendChecklistForm(d, e.from, person, f[1], f[2])
    return out(d, ctx, reply(X.fallback), 'reply')
  }

  // flow reply
  const tok = await d.takeToken(e.token, now, id.profile_id)
  if (!tok) return out(d, ctx, reply(X.formExpired), 'reply')
  if (tok.profile_id !== id.profile_id) return
  const sites = await d.sitesFor(person.profile_id)
  const site = sites.find((s) => s.id === tok.site_id)
  if (tok.kind === 'checklist') {
    // Re-check authorization at submit: template still active/assigned at this site, site still the person's.
    const template = (await d.templates(person.business_id)).find((t) => t.id === tok.template_id)
    if (!template || !site || !availableChecklists([template], person, tok.site_id).length) {
      return out(d, ctx, reply(X.formExpired), 'reply')
    }
    const items = await d.items(template.id)
    const ids = tok.item_ids ?? []
    const parsed = parseFormAnswers(ids, items, e.response)
    // Items re-created since the form was sent (editor save) — answers can't be mapped safely: record nothing, resend.
    const known = new Set(items.map((i) => i.id))
    // (A blank submit is NOT a change: an all-optional form may legitimately come back empty.)
    if (ids.some((x) => !known.has(x))) {
      await out(d, ctx, reply(X.checklistChanged), 'reply')
      return sendChecklistForm(d, e.from, person, template.id, tok.site_id)
    }
    if (parsed.missingRequired.length) {
      await out(d, ctx, reply(X.missing(parsed.missingRequired)), 'reply')
      return sendChecklistForm(d, e.from, person, template.id, tok.site_id)
    }
    const rec = await recordCompletion(d, { person, siteId: tok.site_id, template, items, answers: parsed.answers, source: d.channel, now })
    for (const fl of rec.flagged) {
      await sendCorrectiveForm(d, e.from, person, { site_id: tok.site_id, template_id: template.id, response_id: fl.responseId, item: fl.item, value: fl.value })
    }
    return
  }
  // corrective
  const action = CORRECTIVE_ACTIONS.find((a) => a.id === e.response.action)?.title ?? 'Other'
  const details = typeof e.response.details === 'string' && e.response.details.trim() ? `: ${e.response.details.trim()}` : ''
  const info = tok.response_id ? await d.setCorrective(tok.response_id, `${action}${details}`) : null
  if (info) {
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: site?.timezone ?? 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
    await d.alertManagers(info.businessId, { siteName: info.siteName, itemName: info.itemName, value: withUnit(info.value, info.unit), time: hhmm, byName: info.byName, action: `${action}${details}` })
  }
  await out(d, ctx, reply(X.correctiveThanks), 'reply')
}
