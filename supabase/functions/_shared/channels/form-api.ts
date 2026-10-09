// supabase/functions/_shared/channels/form-api.ts
// Telegram Mini App form API (GET form / POST answers + inline corrective actions). Pure over FormApiDeps (unit-tested
// with fakes); channel-form/index.ts wires it to Supabase.
//
// Security order for both handlers: initData signature (401) → linked Telegram identity (403) → token ownership (403,
// before any token detail is used or revealed) → token live/kind (410) → business ready + person active (403) →
// assignment re-check (410) → item ids unchanged (410 'changed'). POST validates everything BEFORE taking the token,
// so a 400 leaves it usable; takeToken (atomic, owner-scoped) runs only right before recording → replays get 410.
import type { Answer, Person, Template, TemplateItem } from '../checklists-core/types.ts'
import { fieldName, formItems, parseFormAnswers } from '../checklists-core/answers.ts'
import { availableChecklists } from '../checklists-core/due.ts'
import { CORRECTIVE_ACTIONS } from './whatsapp-flows.ts'
import { withUnit, type FormToken, type SiteInfo } from './bot.ts'

export interface FormApiDeps {
  now(): Date
  verifyInitData(initData: string): Promise<{ userId: string } | null>
  identityByExternal(channel: 'telegram', externalId: string): Promise<{ profile_id: string; business_id: string } | null>
  /** Read-only lookup by token (any state); validity is checked here so ownership can be checked first. */
  peekToken(token: string): Promise<FormToken | null>
  takeToken(token: string, now: Date, profileId: string): Promise<FormToken | null>
  ready(businessId: string): Promise<boolean>
  person(profileId: string): Promise<Person | null>
  sitesFor(profileId: string): Promise<SiteInfo[]>
  templates(businessId: string): Promise<Template[]>
  items(templateId: string): Promise<TemplateItem[]>
  /** `corrective` maps flagged item id → notes; those responses are stored with corrective_status 'done'. */
  recordCompletionWithCorrective(a: { person: Person; siteId: string; template: Template; items: TemplateItem[]; answers: Answer[]; corrective: Record<string, string> }): Promise<{ completionId: string; flagged: { item: TemplateItem; value: string; notes: string }[] }>
  alert(businessId: string, a: { siteName: string; itemName: string; value: string; time: string; byName: string; action: string }): Promise<void>
}

type Res = { status: number; body: unknown }
const res = (status: number, body: unknown): Res => ({ status, body })
const UNAUTHORIZED = res(401, { error: 'unauthorized' })
const FORBIDDEN = res(403, { error: 'forbidden' })
const EXPIRED = res(410, { error: 'expired' })
const CHANGED = res(410, { error: 'changed' })
const DETAILS_MAX = 300

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const own = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined

type Ctx = { tok: FormToken; person: Person; site: SiteInfo; template: Template; items: TemplateItem[]; itemIds: string[] }

/** Shared checks for GET and POST. Never consumes the token. */
async function authorize(d: FormApiDeps, token: string, initData: string): Promise<Res | Ctx> {
  const v = initData ? await d.verifyInitData(initData) : null
  if (!v) return UNAUTHORIZED
  const ident = await d.identityByExternal('telegram', v.userId)
  if (!ident) return FORBIDDEN
  const tok = /^[A-Za-z0-9_-]{1,128}$/.test(token) ? await d.peekToken(token) : null
  if (tok && tok.profile_id !== ident.profile_id) return FORBIDDEN   // not the owner: nothing about the token is used
  const now = d.now()
  if (!tok || tok.used_at || new Date(tok.expires_at).getTime() <= now.getTime() || tok.kind !== 'checklist' || !tok.template_id) return EXPIRED
  if (!(await d.ready(tok.business_id))) return FORBIDDEN
  const person = await d.person(tok.profile_id)
  if (!person || person.business_id !== tok.business_id) return FORBIDDEN
  const [sites, templates] = await Promise.all([d.sitesFor(person.profile_id), d.templates(person.business_id)])
  const site = sites.find((s) => s.id === tok.site_id)
  const template = templates.find((t) => t.id === tok.template_id)
  if (!site || !template || !availableChecklists([template], person, tok.site_id).length) return EXPIRED
  const items = await d.items(template.id)
  const itemIds = tok.item_ids ?? []
  const known = new Set(items.map((i) => i.id))
  // Editors delete + re-insert items on save: stale ids can't be mapped safely → the page asks for a fresh /checks.
  if (!itemIds.length || itemIds.some((x) => !known.has(x))) return CHANGED
  return { tok, person, site, template, items, itemIds }
}

export async function handleFormGet(d: FormApiDeps, token: string, initData: string): Promise<Res> {
  const a = await authorize(d, token, initData)
  if ('status' in a) return a
  const supported = new Map(formItems(a.items).supported.map((i) => [i.id, i]))
  const items = a.itemIds.map((id) => supported.get(id)).filter((i): i is TemplateItem => !!i)
    .map((i) => ({ id: i.id, name: i.name, type: i.item_type, required: i.required, min: i.min_value, max: i.max_value, unit: i.unit }))
  return res(200, { templateName: a.template.name, siteName: a.site.name, items, correctiveActions: CORRECTIVE_ACTIONS })
}

export async function handleFormPost(d: FormApiDeps, body: unknown, initData: string): Promise<Res> {
  const bad = res(400, { error: 'bad_request' })
  if (!isObj(body) || typeof body.t !== 'string' || !body.t) {
    // Still require a valid initData first so an anonymous caller learns nothing beyond 401.
    return (initData && (await d.verifyInitData(initData))) ? bad : UNAUTHORIZED
  }
  const answersIn = body.answers ?? {}
  const correctiveIn = body.corrective ?? {}
  if (!isObj(answersIn) || !isObj(correctiveIn)) {
    return (initData && (await d.verifyInitData(initData))) ? bad : UNAUTHORIZED
  }
  const a = await authorize(d, body.t, initData)
  if ('status' in a) return a

  // Answers keyed by item id → f<i> by the token's item order, so validation is identical to the WhatsApp Flow path.
  const response: Record<string, unknown> = {}
  a.itemIds.forEach((id, i) => { response[fieldName(i)] = own(answersIn, id) })
  const parsed = parseFormAnswers(a.itemIds, a.items, response)
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

  const now = d.now()
  const taken = await d.takeToken(a.tok.token, now, a.person.profile_id)
  if (!taken) return EXPIRED   // replay / concurrent submit: nothing recorded twice

  const rec = await d.recordCompletionWithCorrective({ person: a.person, siteId: a.tok.site_id, template: a.template, items: a.items, answers: parsed.answers, corrective: notes })
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: a.site.timezone || 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  for (const f of rec.flagged) {
    try {
      await d.alert(a.person.business_id, {
        siteName: a.site.name, itemName: f.item.name, time, byName: a.person.full_name, action: f.notes,
        value: withUnit(f.value, f.item.unit ?? (f.item.item_type === 'temperature' ? '°C' : null)),
      })
    } catch (err) {
      console.error('form alert failed', String((err as Error)?.message ?? err).slice(0, 200))   // recorded already; don't fail the submit
    }
  }
  return res(200, { ok: true })
}
