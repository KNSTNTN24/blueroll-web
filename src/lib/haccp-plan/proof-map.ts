import type { DayStatus, MethodProof, PlanBundle, TemplateProof } from './types'

const RANK: Record<DayStatus, number> = { none: 0, missed: 1, ok: 2, corrected: 3, flagged: 4 }
export function mergeDays(strips: DayStatus[][]): DayStatus[] {
  const out: DayStatus[] = Array.from({ length: 28 }, () => 'none')
  for (const s of strips) s.forEach((d, i) => { if (i < 28 && RANK[d] > RANK[out[i]]) out[i] = d })
  return out
}

type Rule = { keys?: string[]; sections?: string[]; name?: RegExp; title: string; deliveries?: boolean; all?: boolean }
const RULES: Record<string, Rule> = {
  chilled_storage: { keys: ['fridge_temps'], sections: ['temperature'], name: /fridge|freezer|chiller/i, title: 'Fridge & freezer temperature log' },
  freezing: { keys: ['fridge_temps'], sections: ['temperature'], name: /freezer/i, title: 'Freezer temperature log' },
  chilling_down: { keys: ['cooling'], name: /cool/i, title: 'Cooling records' },
  defrosting: { keys: ['defrosting'], name: /defrost/i, title: 'Defrosting records' },
  cooking_safely: { keys: ['cooking_temps'], name: /cook/i, title: 'Cooking temperature log' },
  hot_holding: { keys: ['hot_holding'], name: /hot.?hold/i, title: 'Hot-holding checks' },
  reheating: { keys: ['reheating'], name: /reheat/i, title: 'Reheating records' },
  cleaning_effectively: { keys: ['dishwasher', 'weekly_deep_clean'], sections: ['cleaning'], name: /clean|dishwasher/i, title: 'Cleaning sign-offs' },
  clear_clean: { keys: ['weekly_deep_clean'], sections: ['cleaning'], name: /clean/i, title: 'Cleaning sign-offs' },
  cleaning_schedule: { keys: ['dishwasher', 'weekly_deep_clean'], sections: ['cleaning'], name: /clean|dishwasher/i, title: 'Cleaning schedule sign-offs' },
  food_allergies: { keys: ['allergen_check'], name: /allergen/i, title: 'Allergen checks' },
  pest_control: { keys: ['pest_check_in_house', 'pest_contractor_visit'], name: /pest/i, title: 'Pest checks' },
  opening_closing: { keys: ['opening_checks', 'closing_checks'], name: /opening|closing/i, title: 'Opening & closing checks' },
  temperature_probes: { keys: ['probe_calibration'], sections: ['probes'], name: /probe|calibrat/i, title: 'Probe calibration' },
  suppliers: { deliveries: true, title: 'Delivery checks' },
  stock_control: { deliveries: true, title: 'Delivery checks' },
  daily_diary: { all: true, title: 'All daily records' },
}

const matches = (t: TemplateProof, r: Rule) =>
  !!r.all || (!!t.libraryKey && !!r.keys?.includes(t.libraryKey)) || (!!t.sfbbSection && !!r.sections?.includes(t.sfbbSection)) || (!!r.name && r.name.test(t.name))

export function proofForMethod(methodId: string, proof: PlanBundle['proof']): MethodProof | null {
  const r = RULES[methodId]
  if (!r) return null
  if (r.deliveries) {
    const d = proof.deliveries
    if (!d.count) return null
    return { title: r.title, days: d.days, sourceNames: ['Deliveries'], stats: [
      { value: String(d.count), label: 'Deliveries checked in 28 days', tone: 'default' },
      { value: String(d.outOfRange), label: 'Above safe temperature', tone: d.outOfRange ? 'amber' : 'default' },
      { value: d.count ? `${Math.round(((d.count - d.outOfRange) / d.count) * 100)}%` : '—', label: 'Accepted in range', tone: 'default' },
    ] }
  }
  const ts = proof.templates.filter((t) => matches(t, r))
  if (!ts.length) return null
  const completions = ts.reduce((n, t) => n + t.completions, 0)
  const flagged = ts.reduce((n, t) => n + t.flagged, 0)
  const corrected = ts.reduce((n, t) => n + t.corrected, 0)
  const initials = Array.from(new Set(ts.flatMap((t) => t.initials))).slice(0, 4)
  return {
    title: r.title, days: mergeDays(ts.map((t) => t.days)), sourceNames: ts.map((t) => t.name),
    stats: [
      { value: String(completions), label: 'Records in 28 days', tone: 'default' },
      { value: String(flagged), label: flagged ? `Out of range — ${corrected} corrected` : 'Out of range', tone: flagged ? 'amber' : 'default' },
      { value: initials.length ? initials.join(' · ') : '—', label: 'Completed by', tone: 'default' },
    ],
  }
}
