// Same rules as the web autoFlag / mobile _isFlagged — keep them in sync.
import type { TemplateItem } from './types.ts'

export function flagResponse(item: Pick<TemplateItem, 'item_type' | 'min_value' | 'max_value'>, value: string): boolean {
  if (item.item_type === 'yes_no' && value === 'no') return true
  if (item.item_type === 'temperature' && value !== '') {
    const n = parseFloat(value)
    if (isNaN(n)) return false
    if (item.min_value != null && n < item.min_value) return true
    if (item.max_value != null && n > item.max_value) return true
  }
  return false
}
