import type { Equipment } from './types'

const MAX_LABEL = 60
const norm = (s: string) => s.trim().toLowerCase()

/** Returns `existing` followed by `added`, with added labels trimmed and made unique
 *  (case-insensitive) by appending " (2)", " (3)"… — the label is the key for fridge log lines. */
export function dedupeEquipment(existing: Equipment[], added: Equipment[]): Equipment[] {
  const taken = new Set(existing.map((e) => norm(e.label)))
  const out = [...existing]
  for (const e of added) {
    const base = e.label.trim().slice(0, MAX_LABEL)
    if (!base) continue
    let label = base
    for (let n = 2; taken.has(norm(label)); n++) {
      const suffix = ` (${n})`
      label = `${base.slice(0, MAX_LABEL - suffix.length).trimEnd()}${suffix}`
    }
    taken.add(norm(label))
    out.push({ ...e, label })
  }
  return out
}
