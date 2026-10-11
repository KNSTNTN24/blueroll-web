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

/** The design canvas sample (St James’s Café, Borough) for the dev preview page. */
export function makeRichBundle(): PlanBundle {
  const days = (bad: Record<number, DayStatus> = {}, closed: number[] = [6, 13, 20, 27]): DayStatus[] =>
    Array.from({ length: 28 }, (_, i) => bad[i] ?? (closed.includes(i) ? 'none' : 'ok'))
  const dish = (name: string, declared: string[], mayContain: string[] = []) => ({
    id: name, name, category: null, active: true, allergen_source: 'manual' as const, recipe_id: null,
    declared_allergens: declared, may_contain: mayContain, dietary: [], attested_by_name: 'Priya Kaur',
    attested_at: '2026-10-06T10:00:00Z', site_ids: ['site-1'], site_categories: {},
  })
  const toggles: Record<string, boolean> = {}
  for (const id of ['ph_uniform', 'ph_hair', 'ph_jewellery', 'ph_nails', 'ph_illness', 'ph_cuts', 'cl_single_use', 'cl_colour_coded', 'cl_laundry',
    'sf_raw_separate', 'sf_colour_boards', 'sf_equipment', 'fa_aware', 'fa_matrix', 'fa_communication', 'cp_chemicals', 'cp_glass', 'cp_physical',
    'pc_contract', 'pc_proofing', 'hw_basin', 'hw_soap', 'hw_towels', 'hw_signs', 'hw_when', 'ce_2stage', 'ce_sanitiser', 'ce_contact', 'ce_surfaces',
    'cc_clear', 'cc_spills', 'cc_waste', 'cs_schedule', 'st_temp', 'st_records', 'st_rotation', 'st_labelled', 'cd_90min', 'cd_fridge', 'cd_portions',
    'df_fridge', 'df_not_refreeze', 'fz_temp', 'fz_labelled', 'fz_suitable', 'ck_75c', 'ck_probe', 'ck_visual', 'ec_eggs', 'ec_rice', 'rh_75c', 'rh_once',
    'rh_check', 'hh_63c', 'hh_check', 'hh_2hr', 'rte_separate', 'rte_utensils', 'rte_stored', 'oc_opening', 'oc_closing', 'oc_recorded', 'sc_fifo',
    'sc_dates', 'sc_reject', 'sc_delivery', 'tr_induction', 'tp_calibrated', 'tp_sanitised', 'tp_boil_ice', 'dd_kept']) toggles[id] = true
  return makeBundle({
    business: { name: 'St James’s Café', address: '12 Bankside', postCode: 'SE1 9JE', fsaRating: '5', lastReviewedAt: '2026-10-03T16:40:00Z' },
    site: { id: 'site-1', name: 'Borough', address: '12 Bankside, London', postcode: 'SE1 9JE', fsaRating: '5', timezone: 'Europe/London' },
    pack: {
      updatedAt: '2026-10-03T16:30:00Z',
      data: {
        toggles,
        texts: {
          ph_changing: 'Staff change in the back office; lockers for personal items. No outdoor clothing in the kitchen.',
          cc_method: 'Clear down after each task: scrape, wipe with hot soapy water, spray sanitiser, leave 30 seconds, wipe with blue roll.\nBins emptied when three-quarters full and at close.',
          fa_procedure: 'Allergy orders are flagged on the ticket and made with clean boards and utensils. Priya Kaur reviews the matrix after any menu or supplier change.',
          sup_approved: 'Only suppliers with an FSA-registered address and a delivery temperature log.',
        },
        files: { fa_matrix_file: JSON.stringify({ id: 'd1', title: 'Allergen menu (customer-facing).pdf' }), cs_file: JSON.stringify({ id: 'd2', title: 'Cleaning schedule 2026.pdf' }) },
        selects: { st_check_method: 'Digital thermometer' }, overrides: {}, sources: {},
      },
    },
    signoff: { signedByName: 'Emma Marsh', signedAt: '2026-10-03T16:42:00Z' },
    sources: {
      recipes: [
        { id: 'r1', name: 'Roast chicken', cooking_method: 'Oven', cooking_temp: 80, extra_care_flags: null, reheating_instructions: null, hot_holding_required: true,
          chilling_method: null, freezing_instructions: null, defrosting_instructions: null, haccp_methods: ['cooking_safely', 'hot_holding'],
          recipe_ingredients: [{ ingredient: { name: 'Chicken thigh', allergens: [] } }] },
        { id: 'r2', name: 'Mushroom soup', cooking_method: 'Hob', cooking_temp: 85, extra_care_flags: null, reheating_instructions: 'Hob to 75 °C, once', hot_holding_required: false,
          chilling_method: 'Shallow trays, blast chiller', freezing_instructions: null, defrosting_instructions: null, haccp_methods: ['cooking_safely', 'reheating', 'chilling_down'],
          recipe_ingredients: [{ ingredient: { name: 'Celery', allergens: ['celery'] } }, { ingredient: { name: 'Cream', allergens: ['milk'] } }] },
      ],
      dishes: [
        dish('Full English breakfast', ['gluten', 'eggs', 'milk', 'soybeans', 'sulphites']),
        dish('Chicken caesar salad', ['gluten', 'eggs', 'fish', 'milk', 'mustard']),
        dish('Tuna melt', ['gluten', 'eggs', 'fish', 'milk', 'mustard']),
        dish('Mushroom soup', ['celery', 'gluten', 'milk']),
        dish('Fish finger sandwich', ['gluten', 'eggs', 'fish', 'milk']),
        dish('Victoria sponge', ['gluten', 'eggs', 'milk']),
        dish('Chocolate brownie (GF)', ['eggs', 'milk', 'soybeans'], ['nuts']),
        dish('Flat white', ['milk']),
      ],
      suppliers: [
        { id: 's1', name: 'Fresh Direct Produce', contact_name: 'Dave', phone: '07700 900412', email: null, delivery_days: ['Mon', 'Thu'] },
        { id: 's2', name: 'Meadow Dairy', contact_name: null, phone: '07700 900318', email: null, delivery_days: ['Daily'] },
      ],
      templates: [
        { id: 't1', name: 'Fridge & Freezer Temperatures', frequency: 'daily', sfbb_section: 'temperature' },
        { id: 't3', name: 'Weekly Deep Clean', frequency: 'weekly', sfbb_section: 'cleaning' },
        { id: 't4', name: 'Dishwasher Rinse Temperature', frequency: 'daily', sfbb_section: 'cleaning' },
        { id: 't5', name: 'Freezer defrost and sanitise', frequency: 'monthly', sfbb_section: 'cleaning' },
      ],
      documents: [{ id: 'd3', title: 'Level 2 Food Hygiene — Priya Kaur', category: 'certificate' }, { id: 'd4', title: 'Rentokil contract 2026', category: 'contract' }],
      team: [{ full_name: 'Emma Marsh', role: 'owner' }, { full_name: 'Tom Achton', role: 'manager' }],
    },
    proof: {
      templates: [
        { templateId: 't1', name: 'Fridge & Freezer Temperatures', libraryKey: 'fridge_temps', sfbbSection: 'temperature', frequency: 'daily',
          days: days({ 9: 'corrected', 22: 'corrected' }), completions: 48, flagged: 2, corrected: 2, readings: 192, initials: ['TA', 'PK', 'SR'], lastCompletedAt: '2026-10-10T07:30:00Z' },
        { templateId: 't2', name: 'Cooking Temperatures', libraryKey: 'cooking_temps', sfbbSection: 'cooking', frequency: 'daily',
          days: days({ 15: 'corrected' }), completions: 142, flagged: 1, corrected: 1, readings: 142, initials: ['TA', 'SR'], lastCompletedAt: '2026-10-10T12:10:00Z' },
        { templateId: 't3', name: 'Weekly Deep Clean', libraryKey: 'weekly_deep_clean', sfbbSection: 'cleaning', frequency: 'weekly',
          days: Array.from({ length: 28 }, (_, i) => (i % 7 === 4 ? 'ok' : 'none') as DayStatus), completions: 4, flagged: 0, corrected: 0, readings: 0, initials: ['SR'], lastCompletedAt: '2026-10-07T20:00:00Z' },
        { templateId: 't6', name: 'Daily Opening Checks', libraryKey: 'opening_checks', sfbbSection: 'management', frequency: 'daily',
          days: days({ 18: 'missed' }), completions: 23, flagged: 0, corrected: 0, readings: 0, initials: ['TA', 'PK'], lastCompletedAt: '2026-10-10T07:00:00Z' },
      ],
      deliveries: { count: 40, outOfRange: 1, days: days({ 26: 'flagged' }) },
      corrective: [
        { at: '2026-10-08T15:40:00Z', template: 'Fridge & Freezer Temperatures', item: 'Prep fridge', value: '7.9', notes: 'Stock moved to Fridge 1, engineer booked; recheck 17:30 4.6 °C', status: 'done', by: 'Emma Marsh' },
        { at: '2026-09-27T12:20:00Z', template: 'Cooking Temperatures', item: 'Chicken caesar batch', value: '71', notes: 'Back in oven, re-probed 82 °C', status: 'done', by: 'Tom Achton' },
      ],
      lastReview: { at: '2026-10-03T16:40:00Z', by: 'Emma Marsh' },
    },
    people: { operator: 'Emma Marsh', siteManager: 'Tom Achton' },
  })
}
