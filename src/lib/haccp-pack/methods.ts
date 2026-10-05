export type FieldType = 'toggle' | 'text' | 'file' | 'select'
export type SectionId = 'cross' | 'cleaning' | 'chilling' | 'cooking' | 'management'

export interface HaccpField {
  id: string
  label: string
  type: FieldType
  options?: string[] // for select
  autoSource?: string // description of auto-fill source
}

export interface HaccpMethod {
  id: string
  name: string
  section: SectionId
  fields: HaccpField[]
}

export const HACCP_METHODS: HaccpMethod[] = [
  // ── Cross-Contamination (6 methods) ──
  {
    id: 'personal_hygiene', name: 'Personal Hygiene', section: 'cross',
    fields: [
      { id: 'ph_uniform', label: 'Staff wear clean uniform / protective clothing', type: 'toggle' },
      { id: 'ph_hair', label: 'Hair tied back and covered where required', type: 'toggle' },
      { id: 'ph_jewellery', label: 'No jewellery except plain wedding band', type: 'toggle' },
      { id: 'ph_nails', label: 'Nails are short, clean and free of polish', type: 'toggle' },
      { id: 'ph_illness', label: 'Staff report illness / sickness / diarrhoea to manager', type: 'toggle' },
      { id: 'ph_cuts', label: 'Cuts and sores covered with blue waterproof plaster', type: 'toggle' },
      { id: 'ph_changing', label: 'Describe your staff changing and locker arrangements', type: 'text' },
      { id: 'ph_clothing', label: 'Describe how uniforms / protective clothing are provided', type: 'text' },
    ],
  },
  {
    id: 'cloths', name: 'Cloths', section: 'cross',
    fields: [
      { id: 'cl_single_use', label: 'Single-use cloths or paper towels for cleaning', type: 'toggle' },
      { id: 'cl_colour_coded', label: 'Colour-coded cloths in use (red, blue, green, yellow)', type: 'toggle' },
      { id: 'cl_laundry', label: 'Reusable cloths washed at 90\u00b0C or above', type: 'toggle' },
      { id: 'cl_stored', label: 'Cloths stored in sanitiser solution between uses', type: 'toggle' },
      { id: 'cl_method', label: 'Describe your cloth management system', type: 'text' },
    ],
  },
  {
    id: 'separating_foods', name: 'Separating Foods', section: 'cross',
    fields: [
      { id: 'sf_raw_separate', label: 'Raw and ready-to-eat foods stored separately', type: 'toggle' },
      { id: 'sf_colour_boards', label: 'Colour-coded chopping boards used', type: 'toggle' },
      { id: 'sf_equipment', label: 'Separate utensils for raw and cooked foods', type: 'toggle' },
      { id: 'sf_raw_products', label: 'List raw products handled (meat, poultry, fish, etc.)', type: 'text', autoSource: 'Recipes: raw meat/fish/poultry ingredients' },
      { id: 'sf_delivery_schedule', label: 'Delivery schedule for raw products', type: 'text', autoSource: 'Suppliers: delivery_days' },
      { id: 'sf_storage', label: 'Describe how raw and RTE foods are separated in storage', type: 'text' },
    ],
  },
  {
    id: 'food_allergies', name: 'Food Allergies', section: 'cross',
    fields: [
      { id: 'fa_aware', label: 'All staff trained on 14 EU allergens', type: 'toggle' },
      { id: 'fa_matrix', label: 'Allergen matrix / chart available and up to date', type: 'toggle' },
      { id: 'fa_communication', label: 'System for customers to declare allergies', type: 'toggle' },
      { id: 'fa_allergens_list', label: 'List allergens present in your menu items', type: 'text', autoSource: 'Menu: allergens per dish, with attestation' },
      { id: 'fa_procedure', label: 'Describe your allergen management procedure', type: 'text' },
      { id: 'fa_matrix_file', label: 'Upload allergen matrix document', type: 'file' },
    ],
  },
  {
    id: 'contamination_prevention', name: 'Contamination Prevention', section: 'cross',
    fields: [
      { id: 'cp_chemicals', label: 'Chemicals stored separately from food', type: 'toggle' },
      { id: 'cp_glass', label: 'Glass and brittle items policy in place', type: 'toggle' },
      { id: 'cp_physical', label: 'Steps taken to prevent physical contamination', type: 'toggle' },
      { id: 'cp_describe', label: 'Describe physical contamination prevention measures', type: 'text' },
      { id: 'cp_chemicals_desc', label: 'Describe chemical storage arrangements', type: 'text' },
    ],
  },
  {
    id: 'pest_control', name: 'Pest Control', section: 'cross',
    fields: [
      { id: 'pc_contract', label: 'Pest control contract in place', type: 'toggle' },
      { id: 'pc_proofing', label: 'Building proofed against pest entry', type: 'toggle' },
      { id: 'pc_company', label: 'Pest control company and visit frequency', type: 'text', autoSource: 'Documents: pest control contract' },
      { id: 'pc_measures', label: 'Describe pest prevention measures in place', type: 'text' },
      { id: 'pc_contract_file', label: 'Upload pest control contract', type: 'file', autoSource: 'Documents: category=contract' },
    ],
  },

  // ── Cleaning (4 methods) ──
  {
    id: 'handwashing', name: 'Handwashing', section: 'cleaning',
    fields: [
      { id: 'hw_basin', label: 'Dedicated handwash basin available', type: 'toggle' },
      { id: 'hw_soap', label: 'Antibacterial soap provided', type: 'toggle' },
      { id: 'hw_towels', label: 'Disposable paper towels or air dryer available', type: 'toggle' },
      { id: 'hw_signs', label: 'Handwashing signs displayed', type: 'toggle' },
      { id: 'hw_when', label: 'Staff know when to wash hands (before handling food, after breaks, etc.)', type: 'toggle' },
    ],
  },
  {
    id: 'cleaning_effectively', name: 'Cleaning Effectively', section: 'cleaning',
    fields: [
      { id: 'ce_2stage', label: 'Two-stage clean-and-sanitise method used', type: 'toggle' },
      { id: 'ce_sanitiser', label: 'Correct sanitiser concentration used', type: 'toggle' },
      { id: 'ce_contact', label: 'Contact time for sanitiser followed', type: 'toggle' },
      { id: 'ce_surfaces', label: 'All food contact surfaces cleaned between tasks', type: 'toggle' },
    ],
  },
  {
    id: 'clear_clean', name: 'Clear & Clean As You Go', section: 'cleaning',
    fields: [
      { id: 'cc_clear', label: 'Work surfaces cleared immediately after use', type: 'toggle' },
      { id: 'cc_spills', label: 'Spills cleaned up immediately', type: 'toggle' },
      { id: 'cc_waste', label: 'Waste disposed of regularly', type: 'toggle' },
      { id: 'cc_method', label: 'Describe your clean-as-you-go procedure', type: 'text' },
    ],
  },
  {
    id: 'cleaning_schedule', name: 'Cleaning Schedule', section: 'cleaning',
    fields: [
      { id: 'cs_schedule', label: 'Cleaning schedule in place and followed', type: 'toggle' },
      { id: 'cs_file', label: 'Upload cleaning schedule document', type: 'file', autoSource: 'Checklists: cleaning template + Documents: category=policy' },
    ],
  },

  // ── Chilling (4 methods) ──
  {
    id: 'chilled_storage', name: 'Chilled Storage', section: 'chilling',
    fields: [
      { id: 'st_temp', label: 'Fridge temperature checked daily (0\u20135\u00b0C)', type: 'toggle' },
      { id: 'st_records', label: 'Temperature records maintained', type: 'toggle' },
      { id: 'st_rotation', label: 'Stock rotation (FIFO) followed', type: 'toggle' },
      { id: 'st_labelled', label: 'All items labelled with date of preparation/opening', type: 'toggle' },
      { id: 'st_method', label: 'Describe temperature monitoring method', type: 'text', autoSource: 'Checklists: temperature checking template' },
      { id: 'st_check_method', label: 'How fridges are checked', type: 'select', options: ['Digital thermometer', 'Fridge display', 'Dial thermometer', 'Data logger'], autoSource: 'Checklists: temperature probe type' },
    ],
  },
  {
    id: 'chilling_down', name: 'Chilling Down Hot Food', section: 'chilling',
    fields: [
      { id: 'cd_90min', label: 'Hot food cooled to room temp within 90 minutes', type: 'toggle' },
      { id: 'cd_fridge', label: 'Then refrigerated immediately', type: 'toggle' },
      { id: 'cd_portions', label: 'Large batches divided into smaller portions', type: 'toggle' },
      { id: 'cd_method', label: 'Describe chilling methods used for hot food', type: 'text', autoSource: 'Recipes: chilling_method' },
    ],
  },
  {
    id: 'defrosting', name: 'Defrosting', section: 'chilling',
    fields: [
      { id: 'df_fridge', label: 'Food defrosted in fridge (preferred method)', type: 'toggle' },
      { id: 'df_microwave', label: 'Microwave defrost used for immediate cooking', type: 'toggle' },
      { id: 'df_not_refreeze', label: 'Defrosted food not refrozen', type: 'toggle' },
      { id: 'df_method', label: 'Describe defrosting procedures for different products', type: 'text', autoSource: 'Recipes: defrosting_instructions' },
      { id: 'df_products', label: 'List products that require defrosting', type: 'text', autoSource: 'Recipes: defrosting_instructions' },
    ],
  },
  {
    id: 'freezing', name: 'Freezing', section: 'chilling',
    fields: [
      { id: 'fz_temp', label: 'Freezer operating at -18\u00b0C or below', type: 'toggle' },
      { id: 'fz_labelled', label: 'Frozen items labelled with date of freezing', type: 'toggle' },
      { id: 'fz_suitable', label: 'Only suitable food items frozen', type: 'toggle' },
      { id: 'fz_method', label: 'Describe freezing procedures', type: 'text', autoSource: 'Recipes: freezing_instructions' },
    ],
  },

  // ── Cooking (6 methods) ──
  {
    id: 'cooking_safely', name: 'Cooking Safely', section: 'cooking',
    fields: [
      { id: 'ck_75c', label: 'Food cooked to 75\u00b0C core temperature', type: 'toggle' },
      { id: 'ck_probe', label: 'Probe thermometer used to check cooking temperatures', type: 'toggle' },
      { id: 'ck_visual', label: 'Visual checks: piping hot, steam, no pink (where applicable)', type: 'toggle' },
      { id: 'ck_dishes', label: 'List main dishes and cooking methods', type: 'text', autoSource: 'Recipes: cooking_method + cooking_temp' },
    ],
  },
  {
    id: 'extra_care', name: 'Extra Care Foods', section: 'cooking',
    fields: [
      { id: 'ec_eggs', label: 'Eggs: cooked until yolk and white are solid (or pasteurised)', type: 'toggle' },
      { id: 'ec_rice', label: 'Rice: served immediately or cooled within 1 hour', type: 'toggle' },
      { id: 'ec_pulses', label: 'Pulses: soaked and boiled properly', type: 'toggle' },
      { id: 'ec_shellfish', label: 'Shellfish: from reputable supplier, cooked thoroughly', type: 'toggle' },
      { id: 'ec_items', label: 'List extra care food items on your menu', type: 'text', autoSource: 'Recipes: extra_care_flags' },
      { id: 'ec_procedure', label: 'Describe extra care handling procedures', type: 'text' },
    ],
  },
  {
    id: 'reheating', name: 'Reheating', section: 'cooking',
    fields: [
      { id: 'rh_75c', label: 'Food reheated to 75\u00b0C core temperature', type: 'toggle' },
      { id: 'rh_once', label: 'Food only reheated once', type: 'toggle' },
      { id: 'rh_check', label: 'Temperature checked with probe thermometer', type: 'toggle' },
      { id: 'rh_items', label: 'List items that are reheated and how', type: 'text', autoSource: 'Recipes: reheating_instructions' },
      { id: 'rh_procedure', label: 'Describe your reheating procedure', type: 'text' },
    ],
  },
  {
    id: 'menu_checks', name: 'Menu Checks', section: 'cooking',
    fields: [
      { id: 'mc_items', label: 'List key menu items and their cooking verification methods', type: 'text', autoSource: 'Recipes: cooking method + verification' },
      { id: 'mc_new_dishes', label: 'Describe process for introducing new dishes to the menu', type: 'text' },
    ],
  },
  {
    id: 'hot_holding', name: 'Hot Holding', section: 'cooking',
    fields: [
      { id: 'hh_63c', label: 'Hot food held at 63\u00b0C or above', type: 'toggle' },
      { id: 'hh_check', label: 'Temperature of hot-held food checked regularly', type: 'toggle' },
      { id: 'hh_2hr', label: 'Food not held hot for more than 2 hours', type: 'toggle' },
      { id: 'hh_items', label: 'List items that are hot-held and equipment used', type: 'text', autoSource: 'Recipes: hot_holding_required' },
    ],
  },
  {
    id: 'ready_to_eat', name: 'Ready-to-Eat', section: 'cooking',
    fields: [
      { id: 'rte_separate', label: 'Ready-to-eat food kept separate from raw', type: 'toggle' },
      { id: 'rte_utensils', label: 'Separate utensils used for RTE food', type: 'toggle' },
      { id: 'rte_stored', label: 'RTE food stored above raw in fridge', type: 'toggle' },
      { id: 'rte_items', label: 'List ready-to-eat products', type: 'text', autoSource: 'Recipes: ready-to-eat ingredients' },
    ],
  },

  // ── Management (6 methods) ──
  {
    id: 'opening_closing', name: 'Opening & Closing Checks', section: 'management',
    fields: [
      { id: 'oc_opening', label: 'Opening checks completed daily', type: 'toggle' },
      { id: 'oc_closing', label: 'Closing checks completed daily', type: 'toggle' },
      { id: 'oc_recorded', label: 'Checks recorded and signed off', type: 'toggle' },
      { id: 'oc_file', label: 'Upload opening / closing checklist', type: 'file', autoSource: 'Checklists: opening/closing templates' },
    ],
  },
  {
    id: 'suppliers', name: 'Suppliers', section: 'management',
    fields: [
      { id: 'sup_list', label: 'List your food suppliers and contact details', type: 'text', autoSource: 'Suppliers: name + contact' },
      { id: 'sup_approved', label: 'Describe how you ensure suppliers are reputable', type: 'text' },
      { id: 'sup_file', label: 'Upload supplier list or approved supplier document', type: 'file', autoSource: 'Suppliers table' },
    ],
  },
  {
    id: 'stock_control', name: 'Stock Control', section: 'management',
    fields: [
      { id: 'sc_fifo', label: 'First In, First Out (FIFO) stock rotation used', type: 'toggle' },
      { id: 'sc_dates', label: 'Use-by and best-before dates checked on delivery', type: 'toggle' },
      { id: 'sc_reject', label: 'Out-of-date stock removed and disposed of', type: 'toggle' },
      { id: 'sc_delivery', label: 'Delivery checks carried out (temperature, condition)', type: 'toggle' },
    ],
  },
  {
    id: 'training', name: 'Training', section: 'management',
    fields: [
      { id: 'tr_induction', label: 'All new staff receive food safety induction', type: 'toggle' },
      { id: 'tr_responsible', label: 'Named person responsible for food safety training', type: 'text', autoSource: 'Team: profiles with manager/owner role' },
      { id: 'tr_records', label: 'Describe training records and certificates held', type: 'text', autoSource: 'Documents: category=training' },
      { id: 'tr_file', label: 'Upload training records / certificates', type: 'file', autoSource: 'Documents: category=training' },
    ],
  },
  {
    id: 'temperature_probes', name: 'Temperature Probes', section: 'management',
    fields: [
      { id: 'tp_calibrated', label: 'Probe thermometer calibrated regularly', type: 'toggle' },
      { id: 'tp_sanitised', label: 'Probe cleaned and sanitised between uses', type: 'toggle' },
      { id: 'tp_boil_ice', label: 'Boiling water and ice used to check accuracy', type: 'toggle' },
      { id: 'tp_method', label: 'Describe probe calibration procedure and frequency', type: 'text', autoSource: 'Checklists: probe calibration template' },
    ],
  },
  {
    id: 'daily_diary', name: 'Daily Diary', section: 'management',
    fields: [
      { id: 'dd_kept', label: 'Daily diary maintained', type: 'toggle' },
      { id: 'dd_file', label: 'Upload daily diary template or sample', type: 'file', autoSource: 'Checklists: daily diary template' },
    ],
  },
]

export function findField(id: string): (HaccpField & { methodId: string }) | undefined {
  for (const m of HACCP_METHODS) {
    const f = m.fields.find((x) => x.id === id)
    if (f) return { ...f, methodId: m.id }
  }
  return undefined
}
