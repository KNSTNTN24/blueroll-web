// src/lib/haccp-setup/content/haccp-mapping.ts
import type { Ctx, Equipment, FieldRule, PackValue } from '../types'
import { evalCond } from '../conditions'
import { THRESHOLDS as T } from './thresholds'

const a = (ctx: Ctx, q: string) => ctx.answers[q]
const yes = (ctx: Ctx, q: string) => a(ctx, q) === true
const has = (ctx: Ctx, q: string, v: string) => evalCond({ q, has: v }, ctx.answers)
const hasEq = (ctx: Ctx, kind: Equipment['kind']) => evalCond({ equipment: [kind] }, ctx.answers)
const when = (cond: boolean, v: PackValue): PackValue | undefined => (cond ? v : undefined)
const answered = (ctx: Ctx, q: string) => a(ctx, q) !== undefined

const UNIFORM: Record<string, string> = {
  business_launders: 'We provide uniforms and launder them. Staff put on clean clothing at the start of each shift.',
  staff_launder: 'We provide uniforms, which staff wash at home. Staff put on clean clothing at the start of each shift.',
  aprons_only: 'Staff wear clean clothes and a clean apron provided by us, changed when dirty.',
}
const CHANGING: Record<string, string> = {
  staff_room: 'Staff change in the staff room and keep outdoor clothes and bags in lockers, away from food areas.',
  changing_area: 'Staff change in a separate changing area and keep outdoor clothes and bags away from food areas.',
  none: 'Outdoor clothes and bags are kept in a designated place away from food and food preparation areas.',
}
const CLOTHS: Record<string, string> = {
  single_use: 'We use single-use cloths and paper towels, thrown away after each task.',
  reusable_90: 'Reusable cloths are washed at 90 °C after each day and replaced when worn.',
  both: 'We use single-use cloths for raw food areas and reusable cloths washed at 90 °C for other cleaning.',
}
const CHEMICALS: Record<string, string> = {
  separate_room: 'Cleaning chemicals are kept in a separate store, away from food, in their original labelled containers.',
  separate_cupboard: 'Cleaning chemicals are kept in a dedicated cupboard away from food, in their original labelled containers.',
}
const EXTRA_CARE: Record<string, string> = {
  eggs: 'Eggs: cooked until white and yolk are solid, or pasteurised egg is used for dishes served raw or lightly cooked.',
  rice: 'Rice: served straight after cooking, or cooled within 1 hour and kept in the fridge for no more than 1 day.',
  pulses: 'Pulses: dried red kidney beans soaked and boiled vigorously for at least 10 minutes.',
  shellfish: 'Shellfish: bought from reputable suppliers and cooked thoroughly, or prepared as the supplier directs.',
}

export const FIELD_RULES: FieldRule[] = [
  // Personal hygiene
  ...['ph_hair', 'ph_jewellery', 'ph_nails', 'ph_cuts'].map((fieldId) => ({ fieldId, value: (c: Ctx) => when(yes(c, 'hygiene_rules'), true) })),
  { fieldId: 'ph_illness', value: (c) => when(yes(c, 'illness_policy'), true) },
  { fieldId: 'ph_uniform', value: (c) => when(answered(c, 'uniform'), true) },
  { fieldId: 'ph_clothing', value: (c) => UNIFORM[a(c, 'uniform') as string] },
  { fieldId: 'ph_changing', value: (c) => CHANGING[a(c, 'changing') as string] },
  // Cloths
  { fieldId: 'cl_single_use', value: (c) => when(a(c, 'cloths') === 'single_use' || a(c, 'cloths') === 'both', true) },
  { fieldId: 'cl_laundry', value: (c) => when(a(c, 'cloths') === 'reusable_90' || a(c, 'cloths') === 'both', true) },
  { fieldId: 'cl_method', value: (c) => CLOTHS[a(c, 'cloths') as string] },
  // Separating foods / ready-to-eat
  { fieldId: 'sf_raw_separate', value: (c) => when(a(c, 'separation') === 'separate_fridges' || a(c, 'separation') === 'raw_below', true) },
  { fieldId: 'rte_separate', value: (c) => when(a(c, 'separation') === 'separate_fridges' || a(c, 'separation') === 'raw_below', true) },
  { fieldId: 'rte_stored', value: (c) => when(a(c, 'separation') === 'raw_below', true) },
  { fieldId: 'sf_colour_boards', value: (c) => when(yes(c, 'colour_boards'), true) },
  { fieldId: 'sf_equipment', value: (c) => when(yes(c, 'colour_boards'), true) },
  { fieldId: 'rte_utensils', value: (c) => when(yes(c, 'colour_boards'), true) },
  { fieldId: 'sf_storage', value: (c) => ({
      separate_fridges: 'Raw meat, fish and eggs are stored in a separate fridge from ready-to-eat food.',
      raw_below: 'Raw meat, fish and eggs are stored covered on the bottom shelf, below ready-to-eat food.',
      no_raw: 'We do not handle raw meat, fish or eggs. Ready-to-eat food is stored covered.',
    } as Record<string, string>)[a(c, 'separation') as string] },
  // Allergens
  { fieldId: 'fa_matrix', value: (c) => when(yes(c, 'allergen_matrix'), true) },
  { fieldId: 'fa_communication', value: (c) => when(yes(c, 'allergen_ask'), true) },
  { fieldId: 'fa_aware', value: (c) => when(yes(c, 'allergen_training'), true) },
  { fieldId: 'fa_procedure', value: (c) => when(yes(c, 'allergen_matrix') || yes(c, 'allergen_ask'),
      'We keep allergen information for every dish in Blueroll and update it whenever a recipe or ingredient changes. ' +
      'Staff ask customers about allergies and check the allergen chart before serving. Allergen orders are prepared with clean equipment and kept separate.') },
  // Contamination prevention
  { fieldId: 'cp_chemicals', value: (c) => when(a(c, 'chemicals') === 'separate_room' || a(c, 'chemicals') === 'separate_cupboard', true) },
  { fieldId: 'cp_chemicals_desc', value: (c) => CHEMICALS[a(c, 'chemicals') as string] },
  { fieldId: 'cp_glass', value: (c) => when(yes(c, 'glass_policy'), true) },
  { fieldId: 'cp_physical', value: (c) => when(yes(c, 'glass_policy'), true) },
  { fieldId: 'cp_describe', value: (c) => when(yes(c, 'glass_policy'),
      'No glass is used above open food; breakages are cleaned up and nearby food thrown away. Packaging, staples and string are removed before food enters the kitchen.') },
  // Pest control
  { fieldId: 'pc_contract', value: (c) => when(a(c, 'pest_control') === 'contractor', true) },
  { fieldId: 'pc_proofing', value: (c) => when(yes(c, 'pest_proofing'), true) },
  { fieldId: 'pc_measures', value: (c) => a(c, 'pest_control') === 'contractor'
      ? 'A pest control contractor visits regularly and reports are kept. Staff check daily for signs of pests and report them to the manager at once.'
      : a(c, 'pest_control') === 'in_house'
        ? 'We check weekly for signs of pests and record it in Blueroll. Any sign of pests is reported to the manager and a contractor is called.'
        : undefined },
  // Handwashing & cleaning
  ...['hw_basin', 'hw_soap', 'hw_towels'].map((fieldId) => ({ fieldId, value: (c: Ctx) => when(yes(c, 'handwash_basin'), true) })),
  { fieldId: 'hw_when', value: (c) => when(yes(c, 'hygiene_rules'), true) },
  { fieldId: 'ce_sanitiser', value: (c) => when(yes(c, 'sanitiser'), true) },
  { fieldId: 'ce_contact', value: (c) => when(yes(c, 'sanitiser'), true) },
  ...['ce_surfaces', 'cc_clear', 'cc_spills', 'cc_waste'].map((fieldId) => ({ fieldId, value: (c: Ctx) => when(yes(c, 'clean_as_go'), true) })),
  { fieldId: 'cc_method', value: (c) => when(yes(c, 'clean_as_go'),
      'Staff clear and clean surfaces and equipment straight after each task, clean spills at once and remove waste regularly through the shift.') },
  { fieldId: 'cs_schedule', value: (c) => when(yes(c, 'cleaning_schedule'), true) },
  // Chilling
  { fieldId: 'st_labelled', value: (c) => when(yes(c, 'labels'), true) },
  { fieldId: 'st_rotation', value: (c) => when(yes(c, 'fifo'), true) },
  { fieldId: 'sc_fifo', value: (c) => when(yes(c, 'fifo'), true) },
  { fieldId: 'sc_reject', value: (c) => when(yes(c, 'fifo'), true) },
  { fieldId: 'sc_dates', value: (c) => when(yes(c, 'delivery_checks'), true) },
  { fieldId: 'sc_delivery', value: (c) => when(yes(c, 'delivery_checks'), true) },
  { fieldId: 'cd_fridge', value: (c) => when(answered(c, 'cooling_method'), true) },
  { fieldId: 'cd_portions', value: (c) => when(a(c, 'cooling_method') === 'portions', true) },
  { fieldId: 'df_fridge', value: (c) => when(has(c, 'defrost_method', 'fridge'), true) },
  { fieldId: 'df_microwave', value: (c) => when(has(c, 'defrost_method', 'microwave'), true) },
  { fieldId: 'fz_labelled', value: (c) => when(yes(c, 'freeze_own') && yes(c, 'labels'), true) },
  // Cooking
  { fieldId: 'ck_probe', value: (c) => when(has(c, 'processes', 'cook_hot') && hasEq(c, 'probe'), true) },
  { fieldId: 'hh_check', value: (c) => when(has(c, 'processes', 'hot_hold') && hasEq(c, 'probe'), true) },
  { fieldId: 'rh_once', value: (c) => when(yes(c, 'reheat_once'), true) },
  { fieldId: 'rh_check', value: (c) => when(yes(c, 'reheat_once') && hasEq(c, 'probe'), true) },
  { fieldId: 'rh_procedure', value: (c) => when(has(c, 'processes', 'reheat'),
      `Food is reheated until steaming hot all the way through and the core reaches ${c.scotland ? T.reheatMinScotland : T.reheatMin} °C`
      + (hasEq(c, 'probe') ? ', checked with a probe' : '') + '.'
      + (yes(c, 'reheat_once') ? ' Food is reheated only once.' : '')) },
  ...(['eggs', 'rice', 'pulses', 'shellfish'] as const).map((v) => ({
    fieldId: ({ eggs: 'ec_eggs', rice: 'ec_rice', pulses: 'ec_pulses', shellfish: 'ec_shellfish' })[v],
    value: (c: Ctx) => when(has(c, 'extra_care', v), true),
  })),
  { fieldId: 'ec_procedure', value: (c) => {
      const sel = (Array.isArray(a(c, 'extra_care')) ? a(c, 'extra_care') : []) as string[]
      return sel.length ? sel.map((v) => EXTRA_CARE[v]).filter(Boolean).join(' ') : undefined
    } },
  { fieldId: 'mc_new_dishes', value: (c) => when(yes(c, 'new_dishes'),
      'Before a new dish goes on the menu the chef checks how it is cooked and probed, and the allergen information is added to Blueroll.') },
  // Management
  ...['oc_opening', 'oc_closing', 'oc_recorded'].map((fieldId) => ({ fieldId, value: (c: Ctx) => when(yes(c, 'opening_closing'), true) })),
  { fieldId: 'sup_approved', value: (c) => when(yes(c, 'approved_suppliers'),
      'We only buy from reputable suppliers who are registered with their local authority, and we check deliveries on arrival.') },
  { fieldId: 'tr_induction', value: (c) => when(yes(c, 'induction'), true) },
  { fieldId: 'tp_calibrated', value: (c) => when(yes(c, 'probe_calibration'), true) },
  { fieldId: 'tp_boil_ice', value: (c) => when(yes(c, 'probe_calibration'), true) },
  { fieldId: 'dd_kept', value: (c) => when(yes(c, 'diary'), true) },
]
