// Initials item type (spec 2026-06-07 v-next, item 3): short uppercase
// alphanumeric tag identifying who filled a checklist on shared accounts.
export const INITIALS_STORAGE_KEY = 'blueroll_last_initials'

export function normalizeInitials(v: string): string {
  return v.trim().toUpperCase()
}

export function isValidInitials(v: string): boolean {
  return /^[A-Z0-9]{2,5}$/.test(normalizeInitials(v))
}
