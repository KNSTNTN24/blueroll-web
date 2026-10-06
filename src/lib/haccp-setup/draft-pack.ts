// src/lib/haccp-setup/draft-pack.ts
import { findField } from '@/lib/haccp-pack/methods'
import type { Ctx, DraftField, FieldStatus, PackData, PackValue } from './types'
import { FIELD_RULES } from './content/haccp-mapping'

export const EMPTY_PACK: PackData = { toggles: {}, texts: {}, files: {}, selects: {}, overrides: {}, sources: {} }

function currentValue(type: 'toggle' | 'text' | 'select', id: string, pack: PackData): PackValue | undefined {
  if (type === 'toggle') return pack.toggles[id]
  const v = type === 'text' ? pack.texts[id] : pack.selects[id]
  return v === '' ? undefined : v
}

export function classifyField(fieldId: string, type: 'toggle' | 'text' | 'select', proposed: PackValue, pack: PackData | null):
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
    else out.selects[f.fieldId] = f.value as string
    out.sources![f.fieldId] = 'questionnaire'
  }
  return out
}
