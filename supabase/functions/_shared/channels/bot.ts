// supabase/functions/_shared/channels/bot.ts
// Channel conversation logic over injected dependencies (pure; unit-tested with fakes).
import type { InboundEvent, SendFn, OutboundMessage } from './types.ts'
import type { CompletionLite, Person, Template, TemplateItem } from '../checklists-core/types.ts'
import type { CoreDb } from '../checklists-core/record.ts'
import { recordCompletion } from '../checklists-core/record.ts'
import { availableChecklists, dueChecklists } from '../checklists-core/due.ts'
import { parseFormAnswers } from '../checklists-core/answers.ts'
import { buttonsMessage, flowMessage, templateMessage, textMessage } from './whatsapp.ts'
import { CORRECTIVE_ACTIONS } from './whatsapp-flows.ts'

export interface Identity { id: string; business_id: string; profile_id: string; external_id: string }
export interface SiteInfo { id: string; name: string; timezone: string }
export interface FormToken {
  token: string; kind: 'checklist' | 'corrective'; business_id: string; profile_id: string; site_id: string
  template_id: string | null; item_ids: string[] | null; response_id: string | null; expires_at: string; used_at: string | null
}
export interface BotDeps extends CoreDb {
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
  flowFor(templateId: string, siteId: string): Promise<{ flow_id: string; item_ids: string[] } | null>
  correctiveFlowId(): string
  saveToken(t: FormToken): Promise<void>
  takeToken(token: string, now: Date, profileId: string): Promise<FormToken | null>   // marks used only if owned by profileId; null if unknown/foreign/used/expired
  setCorrective(responseId: string, notes: string): Promise<{ templateName: string; itemName: string; value: string; siteName: string; byName: string; businessId: string } | null>
  managerExternalIds(businessId: string): Promise<string[]>
  log(e: { business_id: string | null; site_id: string | null; profile_id: string | null; direction: 'in' | 'out'; kind: string; template_name?: string; billable: boolean; ref_id?: string; wa_message_id?: string | null }): Promise<void>
  linkFailures(externalId: string, since: Date): Promise<number>
  recordLinkFailure(externalId: string, at: Date): Promise<void>
  /** This person's WhatsApp-recorded answers still awaiting a corrective action (last 2 days), oldest first. */
  pendingCorrective(profileId: string): Promise<PendingCorrective[]>
}
export interface PendingCorrective { response_id: string; item: TemplateItem; value: string; site_id: string; template_id: string }

export const TEXT = {
  linked: (name: string, site: string) => `Hi ${name} 👋 You're connected to ${site}. I'll remind you before your checks are due. Reply STOP anytime.`,
  linkExpired: 'This link has expired — ask your manager for a new QR code.',
  unknown: 'Ask your manager for a QR code to connect to Blueroll.',
  unavailable: "Blueroll checks aren't available for your team right now. Please use the Blueroll app.",
  stopped: "You're disconnected from Blueroll. You won't get any more messages. Ask your manager for a new QR code to reconnect.",
  help: 'Blueroll checks: tap Fill in on a reminder, or type CHECKS to see what is due. Type STOP to disconnect.',
  fallback: 'I can help with your checks — tap Fill in or type CHECKS.',
  nothingDue: 'Nothing is due right now 👍',
  dueList: (site: string) => `Checks due at ${site}:`,
  appOnly: (name: string) => `${name} can only be completed in the Blueroll app.`,
  missing: (names: string[]) => `Some required answers were missing: ${names.join(', ')}. Please fill in the form again.`,
  formExpired: 'This form has expired — type CHECKS to get a new one.',
  correctiveBody: (item: string) => `${item} is out of range. Tell us what you did.`,
  correctiveThanks: 'Thanks — your manager has been told.',
}

const TOKEN_TTL_MS = 24 * 3600 * 1000
const MAX_PENDING_CORRECTIVE = 3
// Brute-force guard on 6-digit LINK codes: at most 5 failed attempts per number per hour.
const MAX_LINK_FAILURES = 5
const LINK_FAILURE_WINDOW_MS = 3600 * 1000

async function out(d: BotDeps, ctx: { business_id: string | null; profile_id: string | null; site_id?: string | null }, msg: OutboundMessage, kind: string) {
  const r = await d.send(msg)
  await d.log({ business_id: ctx.business_id, site_id: ctx.site_id ?? null, profile_id: ctx.profile_id, direction: 'out', kind, billable: false, wa_message_id: r.id })
}

function valueText(item: TemplateItem, value: string): string {
  if (item.item_type === 'yes_no') return 'Answered: No'
  const u = item.unit ?? '°C'
  const lim = item.min_value != null && item.max_value != null ? `limit ${item.min_value}–${item.max_value} ${u}`
    : item.min_value != null ? `limit ${item.min_value} ${u} or above` : `limit ${item.max_value} ${u} or below`
  return `${value} ${u} (${lim})`
}

export async function sendManagerAlert(d: BotDeps, businessId: string, a: { siteName: string; itemName: string; value: string; time: string; byName: string; action: string }) {
  for (const to of await d.managerExternalIds(businessId)) {
    const r = await d.send(templateMessage(to, 'manager_alert', [a.siteName, a.itemName, a.value, a.time, a.byName, a.action], []))
    await d.log({ business_id: businessId, site_id: null, profile_id: null, direction: 'out', kind: 'alert', template_name: 'manager_alert', billable: true, wa_message_id: r.id })
  }
}

async function sendCorrectiveForm(d: BotDeps, from: string, person: Person, c: { site_id: string; template_id: string; response_id: string; item: TemplateItem; value: string }) {
  const token = d.newToken()
  await d.saveToken({ token, kind: 'corrective', business_id: person.business_id, profile_id: person.profile_id, site_id: c.site_id,
    template_id: c.template_id, item_ids: null, response_id: c.response_id, expires_at: new Date(d.now().getTime() + TOKEN_TTL_MS).toISOString(), used_at: null })
  await out(d, { business_id: person.business_id, profile_id: person.profile_id, site_id: c.site_id }, flowMessage(from, {
    flowId: d.correctiveFlowId(), token, cta: 'Add action', body: TEXT.correctiveBody(c.item.name), screen: 'CORRECTIVE',
    data: { item_name: c.item.name, value_text: valueText(c.item, c.value) },
  }), 'corrective_flow')
}

async function sendChecklistForm(d: BotDeps, from: string, person: Person, templateId: string, siteId: string) {
  const ctx = { business_id: person.business_id, profile_id: person.profile_id, site_id: siteId }
  const sites = await d.sitesFor(person.profile_id)
  const t = (await d.templates(person.business_id)).find((x) => x.id === templateId)
  if (!t || !sites.some((s) => s.id === siteId) || !availableChecklists([t], person, siteId).length) return out(d, ctx, textMessage(from, TEXT.formExpired), 'reply')
  const flow = await d.flowFor(templateId, siteId)
  if (!flow) return out(d, ctx, textMessage(from, TEXT.appOnly(t.name)), 'reply')
  const token = d.newToken()
  await d.saveToken({ token, kind: 'checklist', business_id: person.business_id, profile_id: person.profile_id, site_id: siteId,
    template_id: templateId, item_ids: flow.item_ids, response_id: null, expires_at: new Date(d.now().getTime() + TOKEN_TTL_MS).toISOString(), used_at: null })
  await out(d, ctx, flowMessage(from, { flowId: flow.flow_id, token, cta: 'Fill in', body: t.name, screen: 'CHECKLIST' }), 'flow')
}

async function sendDueList(d: BotDeps, from: string, person: Person) {
  const ctx = { business_id: person.business_id, profile_id: person.profile_id }
  const now = d.now()
  const [sites, templates, completions] = await Promise.all([
    d.sitesFor(person.profile_id), d.templates(person.business_id), d.completionsSince(person.business_id, new Date(now.getTime() - 32 * 86400_000)),
  ])
  // Out-of-range answers still waiting for an action: re-offer the corrective form first (only for sites the person still has).
  const pending = (await d.pendingCorrective(person.profile_id)).filter((p) => sites.some((s) => s.id === p.site_id))
  for (const p of pending.slice(0, MAX_PENDING_CORRECTIVE)) await sendCorrectiveForm(d, from, person, p)
  let any = false
  for (const s of sites) {
    const due = dueChecklists({ templates, person, siteId: s.id, tz: s.timezone, now, completions })
    if (!due.length) continue
    any = true
    await out(d, { ...ctx, site_id: s.id }, buttonsMessage(from, TEXT.dueList(s.name), due.slice(0, 3).map((x) => ({ id: `fill:${x.template.id}:${s.id}`, title: x.template.name }))), 'reply')
  }
  if (!any) await out(d, ctx, textMessage(from, TEXT.nothingDue), 'reply')
}

export async function handleInbound(e: InboundEvent, d: BotDeps): Promise<void> {
  const now = d.now()
  if (e.kind === 'text') {
    const m = e.text.match(/^\s*link\s*(\d{6})\s*$/i)
    if (m) {
      if (await d.linkFailures(e.from, new Date(now.getTime() - LINK_FAILURE_WINDOW_MS)) >= MAX_LINK_FAILURES) {
        await d.log({ business_id: null, site_id: null, profile_id: null, direction: 'in', kind: 'link', billable: false, wa_message_id: e.id })
        return out(d, { business_id: null, profile_id: null }, textMessage(e.from, TEXT.linkExpired), 'link')
      }
      const r = await d.consumeLinkCode(m[1], e.from, now)
      if (!r.ok) await d.recordLinkFailure(e.from, now)
      await d.log({ business_id: r.ok ? r.identity.business_id : null, site_id: null, profile_id: r.ok ? r.identity.profile_id : null, direction: 'in', kind: 'link', billable: false, wa_message_id: e.id })
      return out(d, { business_id: r.ok ? r.identity.business_id : null, profile_id: r.ok ? r.identity.profile_id : null },
        textMessage(e.from, r.ok ? TEXT.linked(r.name, r.siteName) : TEXT.linkExpired), 'link')
    }
  }
  const id = await d.findIdentity(e.from)
  if (!id) {
    await d.log({ business_id: null, site_id: null, profile_id: null, direction: 'in', kind: e.kind, billable: false, wa_message_id: e.id })
    return out(d, { business_id: null, profile_id: null }, textMessage(e.from, TEXT.unknown), 'reply')
  }
  await d.touchIdentity(id.id, now)
  await d.log({ business_id: id.business_id, site_id: null, profile_id: id.profile_id, direction: 'in', kind: e.kind, billable: false, wa_message_id: e.id })
  const ctx = { business_id: id.business_id, profile_id: id.profile_id }
  if (!(await d.ready(id.business_id))) return out(d, ctx, textMessage(e.from, TEXT.unavailable), 'reply')
  const person = await d.person(id.profile_id)
  if (!person) return out(d, ctx, textMessage(e.from, TEXT.unknown), 'reply')

  if (e.kind === 'text') {
    const cmd = e.text.trim().toLowerCase()
    if (cmd === 'stop') { await d.revokeIdentity(id.id); return out(d, ctx, textMessage(e.from, TEXT.stopped), 'reply') }
    if (cmd === 'help') return out(d, ctx, textMessage(e.from, TEXT.help), 'reply')
    if (cmd === 'checks') return sendDueList(d, e.from, person)
    return out(d, ctx, textMessage(e.from, TEXT.fallback), 'reply')
  }

  if (e.kind === 'button') {
    if (e.payload === 'checks') return sendDueList(d, e.from, person)
    const f = e.payload.match(/^fill:([0-9a-zA-Z-]+):([0-9a-zA-Z-]+)$/)
    if (f) return sendChecklistForm(d, e.from, person, f[1], f[2])
    return out(d, ctx, textMessage(e.from, TEXT.fallback), 'reply')
  }

  // flow reply
  const tok = await d.takeToken(e.token, now, id.profile_id)
  if (!tok) return out(d, ctx, textMessage(e.from, TEXT.formExpired), 'reply')
  if (tok.profile_id !== id.profile_id) return
  const sites = await d.sitesFor(person.profile_id)
  const site = sites.find((s) => s.id === tok.site_id)
  if (tok.kind === 'checklist') {
    // Re-check authorization at submit: template still active/assigned at this site, site still the person's.
    const template = (await d.templates(person.business_id)).find((t) => t.id === tok.template_id)
    if (!template || !site || !availableChecklists([template], person, tok.site_id).length) {
      return out(d, ctx, textMessage(e.from, TEXT.formExpired), 'reply')
    }
    const items = await d.items(template.id)
    const parsed = parseFormAnswers(tok.item_ids ?? [], items, e.response)
    if (parsed.missingRequired.length) {
      await out(d, ctx, textMessage(e.from, TEXT.missing(parsed.missingRequired)), 'reply')
      return sendChecklistForm(d, e.from, person, template.id, tok.site_id)
    }
    const rec = await recordCompletion(d, { person, siteId: tok.site_id, template, items, answers: parsed.answers, source: 'whatsapp', now })
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
    await sendManagerAlert(d, info.businessId, { siteName: info.siteName, itemName: info.itemName, value: info.value, time: hhmm, byName: info.byName, action: `${action}${details}` })
  }
  await out(d, ctx, textMessage(e.from, TEXT.correctiveThanks), 'reply')
}
