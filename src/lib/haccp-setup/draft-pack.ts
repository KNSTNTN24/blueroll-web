// src/lib/haccp-setup/draft-pack.ts
import { findField } from '@/lib/haccp-pack/methods'
import type { Ctx, DraftField, FieldStatus, PackData, PackValue } from './types'
import { FIELD_RULES } from './content/haccp-mapping'
import { QUESTIONS } from './content/questions'
import { ownWordsValues } from './own-words'

export const EMPTY_PACK: PackData = { toggles: {}, texts: {}, files: {}, selects: {}, overrides: {}, sources: {} }

type DraftType = DraftField['type']

function currentValue(type: DraftType, id: string, pack: PackData): PackValue | undefined {
  if (type === 'toggle') return pack.toggles[id]
  const v = type === 'text' ? pack.texts[id] : type === 'file' ? pack.files[id] : pack.selects[id]
  return v === '' ? undefined : v
}

export function classifyField(fieldId: string, type: DraftType, proposed: PackValue, pack: PackData | null):
  { status: FieldStatus; current?: PackValue } {
  if (!pack) return { status: 'new' }
  if (pack.overrides?.[fieldId]) return { status: 'manual', current: currentValue(type, fieldId, pack) }
  const current = currentValue(type, fieldId, pack)
  if (current === undefined) return { status: 'new' }
  if (current === proposed) return { status: 'kept', current }
  if (pack.sources?.[fieldId] === 'questionnaire') return { status: 'new', current }
  return { status: 'kept', current }
}

export function buildPackDraft(ctx: Ctx, pack: PackData | null): DraftField[] {
  const out: DraftField[] = []
  for (const rule of FIELD_RULES) {
    const value = rule.value(ctx)
    if (value === undefined || value === false || value === '') continue
    const f = findField(rule.fieldId)
    if (!f || f.type === 'file') continue
    const type = f.type
    const { status, current } = classifyField(rule.fieldId, type, value, pack)
    out.push({ fieldId: rule.fieldId, methodId: f.methodId, label: f.label, type, value, status, ...(current !== undefined ? { current } : {}) })
  }
  // Own-words answers: the plan text and the points the owner ticked, unless another rule already set them.
  const seen = new Set(out.map((f) => f.fieldId))
  for (const q of QUESTIONS) {
    for (const { fieldId, value } of ownWordsValues(q, ctx.answers)) {
      const f = findField(fieldId)
      if (!f || f.type === 'file' || seen.has(fieldId)) continue
      seen.add(fieldId)
      const { status, current } = classifyField(fieldId, f.type, value, pack)
      out.push({ fieldId, methodId: f.methodId, label: f.label, type: f.type, value, status, ...(current !== undefined ? { current } : {}) })
    }
  }
  // Documents attached in setup go into the pack's file fields.
  const docs = ctx.answers.documents
  if (docs && typeof docs === 'object' && !Array.isArray(docs)) {
    for (const [fieldId, ref] of Object.entries(docs as Record<string, string>)) {
      const f = findField(fieldId)
      if (!f || f.type !== 'file' || typeof ref !== 'string' || !ref) continue
      const { status, current } = classifyField(fieldId, 'file', ref, pack)
      out.push({ fieldId, methodId: f.methodId, label: f.label, type: 'file', value: ref, status, ...(current !== undefined ? { current } : {}) })
    }
  }
  return out
}

export function mergePack(pack: PackData | null, fields: DraftField[]): PackData {
  const base = pack ?? EMPTY_PACK
  const out: PackData = {
    toggles: { ...base.toggles }, texts: { ...base.texts }, files: { ...base.files },
    selects: { ...base.selects }, overrides: { ...base.overrides }, sources: { ...(base.sources ?? {}) },
  }
  for (const f of fields) {
    if (f.status !== 'new') continue
    if (f.type === 'toggle') out.toggles[f.fieldId] = f.value as boolean
    else if (f.type === 'text') out.texts[f.fieldId] = f.value as string
    else if (f.type === 'file') out.files[f.fieldId] = f.value as string
    else out.selects[f.fieldId] = f.value as string
    out.sources![f.fieldId] = 'questionnaire'
  }
  return out
}
