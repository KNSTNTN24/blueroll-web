import type { Draft, DraftChecklist, DraftItemAdd, ExistingState, PackData } from './types'
import { mergePack } from './draft-pack'

export interface Selection { checklistKeys: string[]; itemAddIds: string[]; fieldIds: string[] }
export interface ApplyPayload {
  pack_expected_updated_at: string | null
  checklists: DraftChecklist[]
  item_adds: { template_id: string; item: DraftItemAdd['item'] }[]
  pack: PackData | null
  summary: { checklists: string[]; item_adds: number; fields: string[] }
}

export const itemAddId = (a: DraftItemAdd) => `${a.templateId}:${a.item.name}`

export function defaultSelection(d: Draft): Selection {
  return {
    // Checklists that duplicate an existing default, and additions to existing checklists, are opt-in.
    checklistKeys: d.checklists.filter((c) => !c.similarTo).map((c) => c.key),
    itemAddIds: [],
    fieldIds: d.fields.filter((f) => f.status === 'new').map((f) => f.fieldId),
  }
}

export function toApplyPayload(draft: Draft, sel: Selection, existing: ExistingState): ApplyPayload {
  const checklists = draft.checklists.filter((c) => sel.checklistKeys.includes(c.key))
    .map((c) => { const out = { ...c }; delete out.similarTo; return out })
  const adds = draft.itemAdds.filter((a) => sel.itemAddIds.includes(itemAddId(a)))
  const fields = draft.fields.filter((f) => f.status === 'new' && sel.fieldIds.includes(f.fieldId))
  return {
    pack_expected_updated_at: existing.packUpdatedAt,
    checklists,
    item_adds: adds.map((a) => ({ template_id: a.templateId, item: a.item })),
    pack: fields.length ? mergePack(existing.pack, fields) : null,
    summary: { checklists: checklists.map((c) => c.key), item_adds: adds.length, fields: fields.map((f) => f.fieldId) },
  }
}
