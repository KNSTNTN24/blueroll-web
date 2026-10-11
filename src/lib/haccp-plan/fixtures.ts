import type { DayStatus, PlanBundle } from './types'

// Test and preview bundles. Not used by production code paths.

type Partial1<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object | null ? Partial<NonNullable<T[K]>> | null : T[K] }

const none = (): DayStatus[] => Array.from({ length: 28 }, () => 'none' as DayStatus)

export function makeBundle(over: Partial1<PlanBundle> = {}): PlanBundle {
  const base: PlanBundle = {
    generatedAt: '2026-10-11T09:00:00Z',
    periodStart: '2026-09-13',
    periodEnd: '2026-10-10',
    business: { id: 'biz-1', name: 'St James’s Café', address: null, postCode: null, fsaRating: null, autoFill: true, lastReviewedAt: null },
    site: { id: 'site-1', name: 'Borough', address: null, postcode: null, fsaRating: null, timezone: 'Europe/London' },
    pack: { data: { toggles: {}, texts: {}, files: {}, selects: {}, overrides: {}, sources: {} }, updatedAt: null },
    signoff: null,
    sources: { recipes: [], dishes: [], suppliers: [], templates: [], documents: [], team: [] },
    proof: { templates: [], deliveries: { count: 0, outOfRange: 0, days: none() }, corrective: [], lastReview: null },
    people: { operator: null, siteManager: null },
    share: null,
    viewer: null,
  }
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    const cur = (base as unknown as Record<string, unknown>)[k]
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? { ...cur, ...v } : v
  }
  return out as unknown as PlanBundle
}
