import type { Answer, TemplateItem } from './types.ts'
import { flagResponse } from './flagging.ts'

export const fieldName = (i: number) => `f${i}`

export function formItems(items: TemplateItem[]) {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order)
  return {
    supported: sorted.filter((i) => i.item_type !== 'photo' && i.item_type !== 'initials'),
    unsupportedRequired: sorted.filter((i) => i.item_type === 'photo' && i.required),
  }
}

function normalise(item: TemplateItem, raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  switch (item.item_type) {
    case 'tick': return raw === true || raw === 'true' ? 'true' : null
    case 'yes_no': return raw === 'yes' || raw === 'no' ? raw : null
    case 'temperature': {
      const s = String(raw).trim().replace(',', '.')
      return s === '' ? null : s
    }
    case 'text': {
      const s = String(raw).trim()
      return s === '' ? null : s
    }
    default: return null
  }
}

export function parseFormAnswers(itemIds: string[], items: TemplateItem[], response: Record<string, unknown>) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const answers: Answer[] = []
  itemIds.forEach((id, idx) => {
    const item = byId.get(id)
    if (!item) return
    const value = normalise(item, response[fieldName(idx)])
    if (value === null) return
    answers.push({ item_id: id, value, flagged: flagResponse(item, value) })
  })
  const answered = new Set(answers.map((a) => a.item_id))
  const missingRequired = formItems(items).supported
    .filter((i) => i.required && itemIds.includes(i.id) && !answered.has(i.id)).map((i) => i.name)
  return { answers, missingRequired }
}
