export type Area = 'kitchen' | 'foh'
export type FridgeKind = 'fridge' | 'freezer' | 'walk_in' | 'display'
export interface FridgeUnit { name: string; kind: FridgeKind }
export interface KitchenAnswers {
  fridges: FridgeUnit[]
  probeCount: number
  sinkCount: number
  cooking: Array<'raw' | 'cook_chill' | 'reheat'>
  routines: { opening: boolean; closing: boolean; cleaning: boolean; allergen: boolean }
}
export interface FohAnswers {
  coldDisplayCount: number
  routines: { opening: boolean; closing: boolean; cleaning: boolean }
}
export interface Answers { areas: Area[]; kitchen?: KitchenAnswers; foh?: FohAnswers }
export interface EngineBrief { key: string; title: string; frequency: 'daily' | 'weekly' | 'four_weekly'; prompt: string }

function targetFor(kind: FridgeKind): string {
  if (kind === 'freezer') return 'target −18°C or below'
  if (kind === 'display') return 'target 0–8°C'
  return 'target 0–5°C' // fridge, walk_in
}

export function buildBriefs(answers: Answers): EngineBrief[] {
  const briefs: EngineBrief[] = []
  const k = answers.kitchen
  if (answers.areas.includes('kitchen') && k) {
    if (k.fridges.length > 0) {
      const units = k.fridges.map((f) => `${f.name} (${targetFor(f.kind)})`).join('; ')
      briefs.push({ key: 'kitchen-fridge-temps', title: 'Fridge & Freezer Temperature Record', frequency: 'daily',
        prompt: `A daily Temperature Log. Create exactly one temperature item per unit, for both AM and PM (two items per unit), for these units: ${units}. Use each unit's exact name in the item. End with one text item for corrective action.` })
    }
    if (k.probeCount > 0) {
      briefs.push({ key: 'kitchen-probe-calibration', title: 'Probe Calibration Record', frequency: 'weekly',
        prompt: `A weekly probe thermometer calibration record for ${k.probeCount} probe thermometer(s). For each probe an ice-water test (0°C, tolerance ±3°C) and a boiling-water test (100°C, tolerance ±3°C) as temperature items. End with one text item for corrective action.` })
    }
    if (k.routines.opening) {
      briefs.push({ key: 'kitchen-opening', title: 'Kitchen Opening Checks', frequency: 'daily',
        prompt: `A daily kitchen Opening checklist: ${k.sinkCount} hand-wash basin(s) stocked (hot water, soap, paper towels), fridges/freezers within range, food in date and labelled, raw stored below ready-to-eat, probe sanitised. Use yes_no or tick items.` })
    }
    if (k.routines.closing) {
      briefs.push({ key: 'kitchen-closing', title: 'Kitchen Closing Checks', frequency: 'daily',
        prompt: `A daily kitchen Closing checklist: leftovers cooled and stored, fridges/freezers closed and within range, surfaces cleaned and sanitised, waste removed, equipment switched off. Do NOT include a cleaning schedule.` })
    }
    if (k.routines.cleaning) {
      briefs.push({ key: 'kitchen-cleaning', title: 'Kitchen Cleaning Schedule', frequency: 'daily',
        prompt: `A daily kitchen Cleaning schedule of tick items grouped by area (surfaces, floors, equipment, ${k.sinkCount} sink(s)). Cleaning/sanitising tasks only — no temperature items.` })
    }
    if (k.cooking.length > 0) {
      const stages: string[] = []
      if (k.cooking.includes('raw')) stages.push('cooking from raw (core ≥75°C or equivalent time/temperature)')
      if (k.cooking.includes('cook_chill')) stages.push('two-stage cooling (≤21°C within 2 hours, then ≤8°C within a further 4 hours)')
      if (k.cooking.includes('reheat')) stages.push('reheating (core ≥75°C, once only)')
      briefs.push({ key: 'kitchen-cook-cool', title: 'Cooking & Cooling Temperature', frequency: 'daily',
        prompt: `A daily Cooking & Cooling temperature record covering ${stages.join(', ')}. One temperature item per stage with the stated targets, plus a text item for the food/batch name and corrective action.` })
    }
    if (k.routines.allergen) {
      briefs.push({ key: 'kitchen-allergen', title: 'Allergen Control Record', frequency: 'four_weekly',
        prompt: `A four-weekly allergen control review with yes_no items: supplier allergen information current, storage and preparation separation in place, staff allergen training up to date, menu/allergen matrix accurate. End with a text corrective-action item and a manager sign-off using an initials item.` })
    }
  }
  const f = answers.foh
  if (answers.areas.includes('foh') && f) {
    if (f.coldDisplayCount > 0) {
      briefs.push({ key: 'foh-cold-display', title: 'Cold Display Temperature', frequency: 'daily',
        prompt: `A daily Temperature Log: one temperature item per chilled display unit for ${f.coldDisplayCount} unit(s) (target 0–8°C), for both AM and PM. End with one text corrective-action item.` })
    }
    if (f.routines.opening) {
      briefs.push({ key: 'foh-opening', title: 'Front of House Opening', frequency: 'daily',
        prompt: `A daily front-of-house Opening checklist: dining area clean, tables set, chilled display within range, hand sanitiser stocked, allergen menu available. Use tick/yes_no items.` })
    }
    if (f.routines.closing) {
      briefs.push({ key: 'foh-closing', title: 'Front of House Closing', frequency: 'daily',
        prompt: `A daily front-of-house Closing checklist: surfaces cleaned, condiments stored, display emptied and cleaned, floors cleaned, waste removed. Use tick items.` })
    }
    if (f.routines.cleaning) {
      briefs.push({ key: 'foh-cleaning', title: 'Front of House Cleaning Schedule', frequency: 'daily',
        prompt: `A daily front-of-house Cleaning schedule of tick items grouped by area (tables, floors, toilets, counters). Cleaning tasks only.` })
    }
  }
  return briefs
}
