// supabase/functions/_shared/channels/form-api.ts
// Telegram Mini App form API for GROUP checklists (spec §5, §6). Pure over FormApiDeps (unit-tested with fakes);
// channel-form/index.ts wires it to Supabase + the Bot API.
//
// Order for both handlers: initData signature (401) → token shape/kind (410 expired) → group still linked (410 moved)
// → Telegram membership of that group (403 not_member / 503 retry_later) → token used (410 used + winner's first name)
// / expired (410) → team can use Telegram (403 unavailable) → checklist still mapped + site valid (410 moved) → item ids
// unchanged (410 changed). POST validates answers BEFORE taking the token; the atomic take decides "first submit wins".
import type { Person, Template, TemplateItem } from '../checklists-core/types.ts'
import { fieldName, formItems, parseFormAnswers } from '../checklists-core/answers.ts'
import { recordCompletion } from '../checklists-core/record.ts'
import { CORRECTIVE_ACTIONS } from './whatsapp-flows.ts'
import { withUnit, type SiteInfo } from './bot.ts'
import { memberStatus, type TgApi, type TgUser } from './telegram.ts'
import { notifyManagers, type ChannelGroup, type GroupDeps, type GroupFormToken } from './groups-db.ts'
import { refreshGroupSite } from './tg-live.ts'
import { alertGroups } from './alerts.ts'
import type { ManagerAlert } from './ui.ts'
import { telegramDisplayName } from './members.ts'

export interface FormApiDeps {
  g: GroupDeps
  api: TgApi
  verifyInitData(initData: string): Promise<TgUser | null>
  /** WhatsApp-linked owners/managers (alerts.ts alertManagers). Telegram alerts go to groups. */
  alertManagers(businessId: string, a: ManagerAlert): Promise<void>
}

export const consentText = (business: string) => `Your name will be recorded with checks in ${business}'s food safety records.`

type Res = { status: number; body: unknown }
const res = (status: number, body: unknown): Res => ({ status, body })
const UNAUTHORIZED = res(401, { error: 'unauthorized' })
const NOT_MEMBER = res(403, { error: 'not_member' })
const UNAVAILABLE = res(403, { error: 'unavailable' })
const EXPIRED = res(410, { error: 'expired' })
const MOVED = res(410, { error: 'moved' })
const CHANGED = res(410, { error: 'changed' })
const RETRY_LATER = res(503, { error: 'retry_later' })
const used = (by: string | null) => res(410, { error: 'used', by })
const DETAILS_MAX = 300
const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const own = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined
const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200)

type Ctx = { user: TgUser; tok: GroupFormToken; group: ChannelGroup; site: SiteInfo; template: Template; items: TemplateItem[] }

/** Shared checks for GET and POST. Never consumes the token. */
async function authorize(d: FormApiDeps, token: string, initData: string): Promise<Res | Ctx> {
  const user = initData ? await d.verifyInitData(initData) : null
  if (!user) return UNAUTHORIZED
  const tok = TOKEN_RE.test(token) ? await d.g.peekGroupToken(token) : null
  if (!tok) return EXPIRED
  const group = await d.g.groupById(tok.group_id)
  if (!group || group.business_id !== tok.business_id) return MOVED
  // Spec §5: checked on every open and submit — someone removed from the group can't submit from an open form.
  const m = memberStatus(await d.api('getChatMember', { chat_id: group.chat_id, user_id: Number(user.userId) }))
  if (m === 'not_member') return NOT_MEMBER
  if (m === 'unknown') return RETRY_LATER
  if (tok.used_at) return used(tok.used_by_name)
  if (new Date(tok.expires_at).getTime() <= d.g.now().getTime()) return EXPIRED
  if (!(await d.g.ready(group.business_id))) return UNAVAILABLE
  const [templates, sites] = await Promise.all([d.g.mappedTemplates(group.id), d.g.sites(group.business_id)])
  const template = templates.find((t) => t.id === tok.template_id && t.business_id === group.business_id && (t.site_id === null || t.site_id === tok.site_id))
  const site = sites.find((s) => s.id === tok.site_id)
  if (!template || !site) return MOVED
  const items = await d.g.items(template.id)
  const known = new Set(items.map((i) => i.id))
  // Editors delete + re-insert items on save: stale ids can't be mapped safely → the page asks to reopen the list.
  if (!tok.item_ids.length || tok.item_ids.some((x) => !known.has(x))) return CHANGED
  return { user, tok, group, site, template, items }
}

export async function handleFormGet(d: FormApiDeps, token: string, initData: string): Promise<Res> {
  const a = await authorize(d, token, initData)
  if ('status' in a) return a
  const supported = new Map(formItems(a.items).supported.map((i) => [i.id, i]))
  const items = a.tok.item_ids.map((id) => supported.get(id)).filter((i): i is TemplateItem => !!i)
    .map((i) => ({ id: i.id, name: i.name, type: i.item_type, required: i.required, min: i.min_value, max: i.max_value, unit: i.unit }))
  const known = await d.g.telegramIdentity(a.group.business_id, a.user.userId)
  const consent = known ? null : consentText(await d.g.businessName(a.group.business_id))
  return res(200, { templateName: a.template.name, siteName: a.site.name, items, correctiveActions: CORRECTIVE_ACTIONS, consent })
}

async function personFor(d: FormApiDeps, a: Ctx): Promise<{ person: Person; created: boolean }> {
  const ident = await d.g.telegramIdentity(a.group.business_id, a.user.userId)
  const existing = ident ? await d.g.person(ident.profile_id) : null
  if (existing) return { person: existing, created: false }
  const c = await d.g.createTelegramPerson({
    businessId: a.group.business_id, siteId: a.site.id, tgUserId: a.user.userId,
    displayName: telegramDisplayName(a.user.firstName, a.user.lastName),
  })
  const person = await d.g.person(c.profile_id)
  if (!person) throw new Error('group member profile missing after create')
  return { person, created: c.created }
}

export async function handleFormPost(d: FormApiDeps, body: unknown, initData: string): Promise<Res> {
  const bad = res(400, { error: 'bad_request' })
  const answersIn = isObj(body) ? (body.answers ?? {}) : null
  const correctiveIn = isObj(body) ? (body.corrective ?? {}) : null
  if (!isObj(body) || typeof body.t !== 'string' || !body.t || !isObj(answersIn) || !isObj(correctiveIn)) {
    // Still require a valid initData first so an anonymous caller learns nothing beyond 401.
    return (initData && (await d.verifyInitData(initData))) ? bad : UNAUTHORIZED
  }
  const a = await authorize(d, body.t, initData)
  if ('status' in a) return a

  // Answers keyed by item id → f<i> by the token's item order, so validation is identical to the WhatsApp Flow path.
  const response: Record<string, unknown> = {}
  a.tok.item_ids.forEach((id, i) => { response[fieldName(i)] = own(answersIn, id) })
  const parsed = parseFormAnswers(a.tok.item_ids, a.items, response)
  if (parsed.missingRequired.length) return res(400, { error: 'missing', items: parsed.missingRequired })

  const byId = new Map(a.items.map((i) => [i.id, i]))
  const notes: Record<string, string> = {}
  const lacking: string[] = []
  for (const x of parsed.answers.filter((p) => p.flagged)) {
    const c = own(correctiveIn, x.item_id)
    const action = isObj(c) && typeof c.action === 'string' ? CORRECTIVE_ACTIONS.find((k) => k.id === c.action) : undefined
    if (!action) { lacking.push(byId.get(x.item_id)!.name); continue }
    const details = isObj(c) && typeof c.details === 'string' ? c.details.trim().slice(0, DETAILS_MAX).trim() : ''
    notes[x.item_id] = details ? `${action.title}: ${details}` : action.title
  }
  if (lacking.length) return res(400, { error: 'corrective_required', items: lacking })

  const now = d.g.now()
  const byName = [...(a.user.firstName.trim() || 'someone')].slice(0, 64).join('')
  const taken = await d.g.takeGroupToken(a.tok.token, now, byName)
  if (!taken) {
    // Someone else's submit won between our peek and take.
    const again = await d.g.peekGroupToken(a.tok.token)
    return again?.used_at ? used(again.used_by_name) : EXPIRED
  }

  let person: Person
  let created: boolean
  let rec: Awaited<ReturnType<typeof recordCompletion>>
  try {
    ({ person, created } = await personFor(d, a))
    rec = await recordCompletion(d.g, { person, siteId: a.site.id, template: a.template, items: a.items, answers: parsed.answers, source: 'telegram', now, correctiveNotes: notes })
  } catch (err) {
    console.error('group form record failed', errMsg(err))
    // Give the token back so the same form can be resubmitted.
    try { await d.g.releaseGroupToken(taken.token, taken.used_at ?? now.toISOString()) }
    catch (e2) { console.error('group form token release failed', errMsg(e2)) }
    return res(500, { error: 'retry' })
  }

  // Everything below is best effort: the record is already saved.
  const safe = async (what: string, f: () => Promise<unknown>) => { try { await f() } catch (err) { console.error(`group form ${what} failed`, errMsg(err)) } }
  if (created) {
    await safe('new-person note', () => notifyManagers(d.g, a.group.business_id, {
      title: 'New person in Telegram checks',
      message: `${person.full_name} filled in ${a.template.name} from the Telegram group “${a.group.title || 'Telegram'}” for the first time.`,
      link: '/team',
    }))
  }
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: a.site.timezone || 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  for (const f of rec.flagged) {
    const alert: ManagerAlert = {
      siteName: a.site.name, itemName: f.item.name, time, byName: person.full_name, action: f.notes ?? '',
      value: withUnit(f.value, f.item.unit ?? (f.item.item_type === 'temperature' ? '°C' : null)),
    }
    await safe('manager alert', () => d.alertManagers(a.group.business_id, alert))
    await safe('group alert', () => alertGroups(d.g, d.api, a.group.business_id, a.group.id, alert))
  }
  await safe('list refresh', () => refreshGroupSite(d.g, d.api, a.group.id, a.site.id, now))
  return res(200, { ok: true })
}
