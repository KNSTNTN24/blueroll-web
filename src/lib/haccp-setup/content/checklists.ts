// src/lib/haccp-setup/content/checklists.ts
import type { Ctx, Equipment, LibChecklist, LibItem, Tier } from '../types'
import { evalCond } from '../conditions'
import { THRESHOLDS as T } from './thresholds'

const ALL_STAFF: Tier[] = ['owner', 'manager', 'chef', 'kitchen_staff', 'front_of_house']
const KITCHEN: Tier[] = ['owner', 'manager', 'chef', 'kitchen_staff']
const MANAGERS: Tier[] = ['owner', 'manager']

const yn = (name: string, required = true): LibItem => ({ name, item_type: 'yes_no', required })
const tick = (name: string): LibItem => ({ name, item_type: 'tick', required: true })
const note = (name = 'Corrective action taken (if any)'): LibItem => ({ name, item_type: 'text', required: false })
const temp = (name: string, min: number, max: number): LibItem =>
  ({ name, item_type: 'temperature', required: true, min_value: min, max_value: max, unit: '°C' })

function equipment(ctx: Ctx): Equipment[] {
  return Array.isArray(ctx.answers.equipment) ? (ctx.answers.equipment as Equipment[]) : []
}
const has = (ctx: Ctx, q: string, v: string) => evalCond({ q, has: v }, ctx.answers)

export const CHECKLIST_LIBRARY: LibChecklist[] = [
  { key: 'opening_checks', name: 'Opening Checks', description: 'Checks before service starts',
    sfbb_section: 'management', frequency: 'daily', deadline_time: '10:00', assigned_roles: ALL_STAFF,
    includeIf: { always: true }, reason: 'Every SFBB diary starts with daily opening checks.',
    items: (ctx) => [
      yn('Fridges and freezers working at the right temperature'),
      yn('Work surfaces and equipment clean'),
      yn('Handwash basin stocked with soap and paper towels'),
      yn('No signs of pests'),
      yn('Staff fit for work and in clean clothing'),
      ...(equipment(ctx).some((e) => e.kind === 'probe') ? [yn('Probe thermometer working and clean')] : []),
      ...(has(ctx, 'processes', 'delivery_out') ? [yn('Delivery bags clean and insulated')] : []),
      note('Issues found'),
    ] },
  { key: 'closing_checks', name: 'Closing Checks', description: 'Checks at the end of the day',
    sfbb_section: 'management', frequency: 'daily', deadline_time: '23:00', assigned_roles: ALL_STAFF,
    includeIf: { always: true }, reason: 'Every SFBB diary ends with daily closing checks.',
    items: () => [
      yn('Food covered, labelled and put away'),
      yn('Out-of-date food thrown away'),
      yn('Surfaces, equipment and floors cleaned'),
      yn('Waste removed and bins cleaned'),
      yn('Dirty cloths removed for washing or thrown away'),
      note('Issues found'),
    ] },
  { key: 'fridge_temps', name: 'Fridge & Freezer Temperatures', description: 'Daily temperature log for each unit',
    sfbb_section: 'temperature', frequency: 'daily', deadline_time: '11:00', assigned_roles: ALL_STAFF,
    includeIf: { equipment: ['fridge', 'freezer', 'display_chiller'] },
    reason: 'You listed fridges or freezers — each needs a daily temperature record.',
    items: (ctx) => [
      ...equipment(ctx)
        .filter((e) => e.kind === 'fridge' || e.kind === 'display_chiller' || e.kind === 'freezer')
        .map((e) => e.kind === 'freezer'
          ? temp(`${e.label} temperature`, T.freezer.min, T.freezer.max)
          : temp(`${e.label} temperature`, T.fridge.min, T.fridge.max)),
      yn('Food stored correctly and covered'),
    ] },
  { key: 'delivery_check', name: 'Delivery Check', description: 'Check each delivery on arrival',
    sfbb_section: 'chilling', frequency: 'daily', assigned_roles: KITCHEN,
    includeIf: { q: 'processes', has: 'deliveries_in' }, reason: 'You receive food deliveries.',
    items: () => [
      temp('Chilled delivery temperature', -2, T.deliveryChilledMax),
      { ...temp('Frozen delivery temperature', -30, T.deliveryFrozenMax), required: false },
      yn('Packaging intact and clean'),
      yn('Use-by dates acceptable'),
      yn('Put away within 15 minutes'),
      note('Rejected items and reason'),
    ] },
  { key: 'cooking_temps', name: 'Cooking Temperatures', description: 'Probe the core of cooked food',
    sfbb_section: 'cooking', frequency: 'daily', assigned_roles: KITCHEN,
    includeIf: { q: 'processes', has: 'cook_hot' }, reason: 'You cook food from raw.',
    items: () => [temp('Core temperature of cooked dish', T.cookCoreMin, T.hotFoodUpper), note('Dish name and corrective action')] },
  { key: 'hot_holding', name: 'Hot Holding', description: 'Check hot-held food every 2 hours',
    sfbb_section: 'cooking', frequency: 'daily', assigned_roles: KITCHEN,
    includeIf: { q: 'processes', has: 'hot_hold' }, reason: 'You keep food hot for service.',
    items: () => [temp('Hot-held food temperature', T.hotHoldMin, T.hotFoodUpper), note('Food discarded or reheated')] },
  { key: 'cooling', name: 'Cooling Record', description: 'Cooked food below 8 °C within 90 minutes',
    sfbb_section: 'chilling', frequency: 'daily', assigned_roles: KITCHEN,
    includeIf: { q: 'processes', has: 'cool_cooked' }, reason: 'You cool cooked food to use later.',
    items: () => [temp('Temperature 90 minutes after cooking', -5, T.coolingMaxAfter90Min), yn('Covered, labelled and in the fridge'), note()] },
  { key: 'reheating', name: 'Reheating Record', description: 'Reheated food reaches a safe core temperature',
    sfbb_section: 'cooking', frequency: 'daily', assigned_roles: KITCHEN,
    includeIf: { q: 'processes', has: 'reheat' }, reason: 'You reheat food.',
    items: (ctx) => [temp('Core temperature after reheating', ctx.scotland ? T.reheatMinScotland : T.reheatMin, T.hotFoodUpper),
      yn('Reheated only once'), note()] },
  { key: 'defrosting', name: 'Defrosting Record', description: 'Safe defrosting',
    sfbb_section: 'chilling', frequency: 'daily', assigned_roles: KITCHEN,
    includeIf: { q: 'processes', has: 'defrost' }, reason: 'You defrost frozen food.',
    items: () => [yn('Defrosted in the fridge or by a safe method'), yn('Fully defrosted before cooking'), yn('Not refrozen'), note()] },
  { key: 'probe_calibration', name: 'Probe Calibration', description: 'Check probe accuracy in iced and boiling water',
    sfbb_section: 'probes', frequency: 'monthly', assigned_roles: MANAGERS.concat(['chef']),
    includeIf: { equipment: ['probe'] }, reason: 'You have a probe thermometer.',
    items: () => [temp('Iced water reading', T.probeIce.min, T.probeIce.max),
      temp('Boiling water reading', T.probeBoiling.min, T.probeBoiling.max), note('Action if out of range')] },
  { key: 'dishwasher', name: 'Dishwasher Rinse Temperature', description: 'Final rinse at 82 °C or above',
    sfbb_section: 'cleaning', frequency: 'daily', assigned_roles: KITCHEN,
    includeIf: { equipment: ['dishwasher'] }, reason: 'You have a dishwasher.',
    items: () => [temp('Final rinse temperature', T.dishwasherRinseMin, 95), note()] },
  { key: 'weekly_deep_clean', name: 'Weekly Deep Clean', description: 'Weekly cleaning of areas not cleaned daily',
    sfbb_section: 'cleaning', frequency: 'weekly', assigned_roles: KITCHEN,
    includeIf: { always: true }, reason: 'SFBB Cleaning schedule.',
    items: () => [tick('Fridge and freezer interiors cleaned'), tick('Extraction canopy and filters cleaned'),
      tick('Behind and under equipment cleaned'), tick('Drains and floor edges cleaned'), tick('Shelving and storage areas cleaned'), note('Issues found')] },
  { key: 'allergen_check', name: 'Allergen Check', description: 'Allergen information is complete and current',
    sfbb_section: 'cross', frequency: 'weekly', assigned_roles: MANAGERS.concat(['chef']),
    includeIf: { always: true }, reason: 'All food businesses must give accurate allergen information.',
    items: () => [yn('Allergen chart matches the current menu'), yn('New or changed dishes checked for allergens'),
      yn('Ingredient substitutions checked for allergens'), yn('Staff know where allergen information is'), note()] },
  { key: 'pest_check_in_house', name: 'Pest Check', description: 'Weekly check for signs of pests',
    sfbb_section: 'cross', frequency: 'weekly', assigned_roles: KITCHEN,
    includeIf: { q: 'pest_control', eq: 'in_house' }, reason: 'You do your own pest checks.',
    items: () => [yn('No droppings, gnaw marks or nests'), yn('No flies or insects in food areas'),
      yn('Doors, windows and fly screens in good repair'), yn('Food stored off the floor and covered'), note('Action taken')] },
  { key: 'pest_contractor_visit', name: 'Pest Contractor Visit', description: 'Record of pest contractor visits',
    sfbb_section: 'cross', frequency: 'monthly', assigned_roles: MANAGERS,
    includeIf: { q: 'pest_control', eq: 'contractor' }, reason: 'You use a pest control contractor.',
    items: () => [yn('Contractor visit took place'), yn('Visit report filed'), yn('Recommendations actioned'), note('Findings')] },
  { key: 'bakery_display', name: 'Bakery Display', description: 'Display and labelling checks',
    sfbb_section: 'chilling', frequency: 'daily', assigned_roles: ALL_STAFF,
    includeIf: { any: [{ q: 'venue_type', eq: 'bakery' }, { q: 'processes', has: 'bake' }] },
    reason: 'You bake and display products on site.',
    items: () => [yn('Cream and custard products kept chilled'), yn('Products labelled with allergens'),
      yn('Display clean and covered'), yn('Unsold products recorded or discarded'), note()] },
  { key: 'haccp_review', name: '4-Weekly HACCP Review', description: 'Review that the HACCP pack is followed and up to date',
    sfbb_section: 'management', frequency: 'four_weekly', assigned_roles: MANAGERS,
    includeIf: { always: true }, reason: 'SFBB requires a review every 4 weeks.',
    items: () => [yn('Checklists completed every day'), yn('Problems in the last 4 weeks dealt with'),
      yn('New dishes, suppliers or equipment added to the pack'), yn('Staff training up to date'),
      yn('HACCP pack still matches how we work'), note('Changes made')] },
]

// Default checklists every business gets at onboarding (src/lib/seed-checklists.ts, library_key NULL).
// A library checklist with one of these names already present is offered but not pre-selected.
export const SIMILAR_DEFAULTS: Record<string, string[]> = {
  fridge_temps: ['Fridge & Freezer Temperatures'],
  opening_checks: ['Daily Opening Checks'],
  closing_checks: ['End of Day Closing'],
  delivery_check: ['Delivery Acceptance'],
  weekly_deep_clean: ['Weekly Deep Clean & Calibration'],
  haccp_review: ['4-Weekly HACCP Review'],
}
