// src/lib/haccp-setup/draft-checklists.ts
import type { Ctx, DraftChecklist, DraftItemAdd, ExistingTemplate } from './types'
import { CHECKLIST_LIBRARY } from './content/checklists'
import { evalCond } from './conditions'

export function buildChecklistDraft(ctx: Ctx, existing: ExistingTemplate[]) {
  const byKey = new Map(existing.map((t) => [t.library_key, t]))
  const checklists: DraftChecklist[] = []
  const already: { key: string; name: string }[] = []
  const itemAdds: DraftItemAdd[] = []

  for (const lib of CHECKLIST_LIBRARY) {
    if (!evalCond(lib.includeIf, ctx.answers)) continue
    const items = lib.items(ctx)
    const ex = byKey.get(lib.key)
    if (ex) {
      already.push({ key: lib.key, name: ex.name })
      const names = new Set(ex.itemNames)
      for (const item of items) {
        if (!names.has(item.name)) itemAdds.push({ templateId: ex.id, key: lib.key, templateName: ex.name, item })
      }
      continue
    }
    checklists.push({
      key: lib.key, name: lib.name, description: lib.description, sfbb_section: lib.sfbb_section,
      frequency: lib.frequency, deadline_time: lib.deadline_time ?? null, assigned_roles: lib.assigned_roles,
      items, reason: lib.reason,
    })
  }
  return { checklists, existing: already, itemAdds }
}
