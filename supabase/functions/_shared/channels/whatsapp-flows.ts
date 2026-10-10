// Static WhatsApp Flows generated from checklist items. Field names f0..fN index into the item-id list kept on the form token.
// Limits follow developers.facebook.com/docs/whatsapp/flows/reference/components: TextInput/TextArea label ≤20,
// RadioButtonsGroup label/option title ≤30, helper-text ≤80, ≤50 components and ≤5 OptIn per screen, one Footer.
import type { TemplateItem } from '../checklists-core/types.ts'
import { fieldName, formItems } from '../checklists-core/answers.ts'

export const FLOW_JSON_VERSION = '7.3'   // Meta's recommended Flow JSON version (changelog, 2026-10)
export const MAX_FORM_ITEMS = 40
// Bump when the generated Flow JSON changes shape, so stored flows are rebuilt.
export const FLOW_BUILDER_VERSION = 1

const INPUT_LABEL_MAX = 20
const CHOICE_LABEL_MAX = 30
const HELPER_MAX = 80

const fit = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// Hash of the form SHAPE (position, name, type, required, limits, unit + template name and versions); a change means
// the published Flow must be rebuilt. Item ids are deliberately left out: the web and mobile editors delete and
// re-insert every item on save, so ids churn without the form changing (the bot puts the current ids on the token).
export async function itemsHash(templateName: string, items: TemplateItem[], builderVersion: number = FLOW_BUILDER_VERSION): Promise<string> {
  const shape = formItems(items).supported.map((i) => [i.name, i.item_type, i.required, i.min_value, i.max_value, i.unit])
  const payload = JSON.stringify({ v: FLOW_JSON_VERSION, b: builderVersion, name: templateName, items: shape })
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function rangeHint(i: TemplateItem): string | undefined {
  const u = i.unit ?? '°C'
  if (i.min_value != null && i.max_value != null) return `${i.min_value}–${i.max_value} ${u}`
  if (i.min_value != null) return `${i.min_value} ${u} or above`
  if (i.max_value != null) return `${i.max_value} ${u} or below`
  return undefined
}

// Text inputs have a 20-char label: when the name is cut, the full name goes into helper-text (≤80).
function textLabels(i: TemplateItem, extra?: string): { label: string; 'helper-text'?: string } {
  const label = fit(i.name, INPUT_LABEL_MAX)
  const parts = [label !== i.name ? i.name : undefined, extra].filter(Boolean) as string[]
  return parts.length ? { label, 'helper-text': fit(parts.join(' · '), HELPER_MAX) } : { label }
}

function component(i: TemplateItem, name: string): Record<string, unknown> {
  switch (i.item_type) {
    case 'temperature': return { type: 'TextInput', name, ...textLabels(i, rangeHint(i)), 'input-type': 'number', required: i.required }
    case 'yes_no': return { type: 'RadioButtonsGroup', name, label: fit(i.name, CHOICE_LABEL_MAX), required: i.required, 'data-source': [{ id: 'yes', title: 'Yes' }, { id: 'no', title: 'No' }] }
    // OptIn is capped at 5 per screen and submits a boolean; a single-option radio has no cap and
    // submits the string 'true', which checklists-core/answers.ts accepts for tick items.
    case 'tick': return { type: 'RadioButtonsGroup', name, label: fit(i.name, CHOICE_LABEL_MAX), required: i.required, 'data-source': [{ id: 'true', title: 'Done' }] }
    default: return { type: 'TextArea', name, ...textLabels(i), required: i.required }
  }
}

export function buildChecklistFlow(templateName: string, items: TemplateItem[]): { json: Record<string, unknown>; itemIds: string[] } | null {
  const { supported: list, unsupportedRequired } = formItems(items)
  if (unsupportedRequired.length > 0) return null
  if (list.length === 0 || list.length > MAX_FORM_ITEMS) return null
  const names = list.map((_, idx) => fieldName(idx))
  const json = {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: 'CHECKLIST', title: fit(templateName, 30), terminal: true, success: true,
      layout: { type: 'SingleColumnLayout', children: [{
        type: 'Form', name: 'form', children: [
          ...list.map((i, idx) => component(i, names[idx])),
          { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: Object.fromEntries(names.map((n) => [n, `\${form.${n}}`])) } },
        ],
      }] },
    }],
  }
  return { json, itemIds: list.map((i) => i.id) }
}

// Titles ≤30 chars (RadioButtonsGroup option limit).
export const CORRECTIVE_ACTIONS: { id: string; title: string }[] = [
  { id: 'moved', title: 'Moved food to another fridge' },
  { id: 'thermostat', title: 'Adjusted thermostat, recheck' },
  { id: 'discarded', title: 'Discarded food' },
  { id: 'engineer', title: 'Called engineer' },
  { id: 'other', title: 'Other' },
]

export const CORRECTIVE_FLOW_JSON: Record<string, unknown> = {
  version: FLOW_JSON_VERSION,
  screens: [{
    id: 'CORRECTIVE', title: 'Corrective action', terminal: true, success: true,
    data: { item_name: { type: 'string', __example__: 'Walk-in fridge' }, value_text: { type: 'string', __example__: '9 °C (limit 0–5 °C)' } },
    layout: { type: 'SingleColumnLayout', children: [
      { type: 'TextSubheading', text: '${data.item_name}' },
      // Meta rejects mixing a ${data.x} reference with static text in one property.
      { type: 'TextBody', text: '${data.value_text}' },
      { type: 'TextBody', text: 'What did you do?' },
      { type: 'Form', name: 'form', children: [
        { type: 'RadioButtonsGroup', name: 'action', label: 'Action taken', required: true, 'data-source': CORRECTIVE_ACTIONS },
        { type: 'TextArea', name: 'details', label: 'Details', required: false },
        { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: { action: '${form.action}', details: '${form.details}' } } },
      ] },
    ] },
  }],
}
