// Pure helpers for the Telegram Mini App checklist form (/tg/form). Mirrors the server's normalise/flag rules
// (supabase/functions/_shared/checklists-core/answers.ts + flagging.ts) so the page only enables Submit when the
// server would accept the answers.
import { flagResponse } from './flagging'

export type ItemType = 'temperature' | 'yes_no' | 'tick' | 'text'
export interface FormItem { id: string; name: string; type: ItemType; required: boolean; min: number | null; max: number | null; unit: string | null }
export interface CorrectiveAction { id: string; title: string }
export interface FormData { templateName: string; siteName: string; items: FormItem[]; correctiveActions: CorrectiveAction[] }
export type AnswerValue = string | boolean
export type Answers = Record<string, AnswerValue | undefined>
export type Corrective = Record<string, { action: string; details: string } | undefined>

const TEMP_RE = /^-?\d{1,3}(\.\d{1,2})?$/

/** Same as the server: trim, comma → dot, up to 3 integer and 2 decimal digits, optional minus. Unicode minus (U+2212)
 *  and en dash (iOS keyboards / autocorrect) are read as '-' so the value we send is plain ASCII. */
export function normaliseTemp(raw: string): string | null {
  const s = raw.trim().replace(/,/g, '.').replace(/[\u2212\u2013]/g, '-')
  return TEMP_RE.test(s) ? s : null
}

function answered(item: FormItem, v: AnswerValue | undefined): boolean {
  switch (item.type) {
    case 'tick': return v === true
    case 'yes_no': return v === 'yes' || v === 'no'
    case 'temperature': return typeof v === 'string' && normaliseTemp(v) !== null
    case 'text': return typeof v === 'string' && v.trim() !== ''
  }
}

export function isFlagged(item: FormItem, v: AnswerValue | undefined): boolean {
  if (item.type === 'temperature') {
    const s = typeof v === 'string' ? normaliseTemp(v) : null
    return s !== null && flagResponse({ item_type: 'temperature', min_value: item.min, max_value: item.max }, s)
  }
  if (item.type === 'yes_no') return typeof v === 'string' && flagResponse({ item_type: 'yes_no', min_value: null, max_value: null }, v)
  return false
}

export function validateForm(items: FormItem[], answers: Answers, corrective: Corrective) {
  const missing: string[] = []
  const invalid: string[] = []
  const flagged: string[] = []
  const needsAction: string[] = []
  for (const i of items) {
    const v = answers[i.id]
    if (i.type === 'temperature' && typeof v === 'string' && v.trim() !== '' && normaliseTemp(v) === null) invalid.push(i.id)
    else if (i.required && !answered(i, v)) missing.push(i.id)
    if (isFlagged(i, v)) {
      flagged.push(i.id)
      if (!corrective[i.id]?.action) needsAction.push(i.id)
    }
  }
  return { missing, invalid, flagged, needsAction, valid: !missing.length && !invalid.length && !needsAction.length }
}

/** POST body for channel-form: answers keyed by item id; corrective only for flagged items. */
export function buildPayload(token: string, items: FormItem[], answers: Answers, corrective: Corrective) {
  const out: Record<string, string | boolean> = {}
  const corr: Record<string, { action: string; details: string }> = {}
  for (const i of items) {
    const v = answers[i.id]
    if (!answered(i, v)) continue
    if (i.type === 'tick') out[i.id] = true
    else if (i.type === 'temperature') out[i.id] = normaliseTemp(v as string)!
    else if (i.type === 'text') out[i.id] = (v as string).trim()
    else out[i.id] = v as string
    const c = corrective[i.id]
    if (isFlagged(i, v) && c?.action) corr[i.id] = { action: c.action, details: c.details.trim() }
  }
  return { t: token, answers: out, corrective: corr }
}

/** Mini App page copy. */
export const FORM_MSG = {
  outside: 'Open this form from Telegram.',
  expired: 'This form has expired — send /checks for a new one.',
  changed: 'This checklist was updated — send /checks for a new form.',
  used: 'Already submitted ✓',
  forbidden: "You don't have access to this form.",
  unauthorized: "Couldn't verify your Telegram session. Close and open the form again from Telegram.",
  generic: 'Something went wrong. Please try again.',
  retry: "Couldn't save your answers. Please press Submit again.",
}

/** Page message for a non-OK channel-form response. */
export function statusMessage(status: number, error: unknown): string {
  if (status === 401) return FORM_MSG.unauthorized
  if (status === 403) return FORM_MSG.forbidden
  if (status === 410) return error === 'changed' ? FORM_MSG.changed : error === 'used' ? FORM_MSG.used : FORM_MSG.expired
  return FORM_MSG.generic
}
