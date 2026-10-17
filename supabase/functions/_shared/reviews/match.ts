// supabase/functions/_shared/reviews/match.ts
// Spec §2 "Restaurants ↔ sites": suggest a Blueroll site for a Google location — postcode first, then name.
import type { SiteLite } from './types.ts'

export const normPostcode = (s: string) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const normName = (s: string) => (s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()

function byName(title: string, sites: SiteLite[]): SiteLite[] {
  const t = ` ${normName(title)} `
  return sites.filter((s) => { const n = normName(s.name); return n !== '' && t.includes(` ${n} `) })
}

/** One clear match or null (the manager picks). */
export function suggestSite(loc: { postcode: string; title: string }, sites: SiteLite[]): string | null {
  const pc = normPostcode(loc.postcode)
  const samePc = pc ? sites.filter((s) => normPostcode(s.postcode) === pc) : []
  if (samePc.length === 1) return samePc[0].id
  const named = byName(loc.title, samePc.length > 1 ? samePc : sites)
  return named.length === 1 ? named[0].id : null
}
