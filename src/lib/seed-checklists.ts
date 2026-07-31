import { supabase } from '@/lib/supabase'

const TEMPLATES = [
  {
    name: 'Fridge & Freezer Temperatures', description: 'Record fridge and freezer temperatures twice daily',
    frequency: 'daily', assigned_roles: ['owner','manager','chef','kitchen_staff'],
    sfbb_section: 'chilling', deadline_time: '10:00',
    items: [
      { name: 'Main fridge temperature', item_type: 'temperature', required: true, sort_order: 0, min_value: 1, max_value: 5, unit: '°C' },
      { name: 'Prep fridge temperature', item_type: 'temperature', required: true, sort_order: 1, min_value: 1, max_value: 5, unit: '°C' },
      { name: 'Walk-in fridge temperature', item_type: 'temperature', required: false, sort_order: 2, min_value: 1, max_value: 5, unit: '°C' },
      { name: 'Freezer temperature', item_type: 'temperature', required: true, sort_order: 3, min_value: -23, max_value: -18, unit: '°C' },
      { name: 'Food stored correctly and covered', item_type: 'yes_no', required: true, sort_order: 4 },
    ],
  },
  {
    name: 'Daily Opening Checks', description: 'Morning checks before service begins',
    frequency: 'daily', assigned_roles: ['owner','manager','chef','kitchen_staff'],
    sfbb_section: 'cleaning', deadline_time: '09:00',
    items: [
      { name: 'All surfaces clean and sanitised', item_type: 'yes_no', required: true, sort_order: 0 },
      { name: 'Handwash basin stocked (soap, paper towels)', item_type: 'yes_no', required: true, sort_order: 1 },
      { name: 'Sanitiser spray available and in-date', item_type: 'yes_no', required: true, sort_order: 2 },
      { name: 'No signs of pests', item_type: 'yes_no', required: true, sort_order: 3 },
      { name: 'Staff wearing clean uniform', item_type: 'yes_no', required: true, sort_order: 4 },
      { name: 'Issues or notes', item_type: 'text', required: false, sort_order: 5 },
    ],
  },
  {
    name: 'Delivery Acceptance', description: 'Check deliveries on arrival',
    frequency: 'daily', assigned_roles: ['owner','manager','chef','kitchen_staff'],
    sfbb_section: 'chilling',
    items: [
      { name: 'Chilled delivery temperature', item_type: 'temperature', required: true, sort_order: 0, min_value: 0, max_value: 5, unit: '°C' },
      { name: 'Frozen delivery temperature', item_type: 'temperature', required: false, sort_order: 1, min_value: -25, max_value: -18, unit: '°C' },
      { name: 'Packaging intact and undamaged', item_type: 'yes_no', required: true, sort_order: 2 },
      { name: 'Use-by dates acceptable', item_type: 'yes_no', required: true, sort_order: 3 },
      { name: 'Stored within 15 minutes', item_type: 'yes_no', required: true, sort_order: 4 },
    ],
  },
  {
    name: 'End of Day Closing', description: 'Closing checks at end of service',
    frequency: 'daily', assigned_roles: ['owner','manager','chef','kitchen_staff'],
    sfbb_section: 'cleaning', deadline_time: '23:00',
    items: [
      { name: 'All surfaces cleaned and sanitised', item_type: 'yes_no', required: true, sort_order: 0 },
      { name: 'Floors swept and mopped', item_type: 'yes_no', required: true, sort_order: 1 },
      { name: 'All food covered and labelled with date', item_type: 'yes_no', required: true, sort_order: 2 },
      { name: 'Bins emptied and replaced', item_type: 'yes_no', required: true, sort_order: 3 },
      { name: 'Closing fridge temperature', item_type: 'temperature', required: true, sort_order: 4, min_value: 1, max_value: 5, unit: '°C' },
    ],
  },
  {
    name: 'Weekly Deep Clean & Calibration', description: 'Weekly deep cleaning and equipment checks',
    frequency: 'weekly', assigned_roles: ['owner','manager','chef'],
    sfbb_section: 'cleaning',
    items: [
      { name: 'Probe calibration (ice water test)', item_type: 'temperature', required: true, sort_order: 0, min_value: -1, max_value: 1, unit: '°C' },
      { name: 'Fridge/freezer interior cleaned', item_type: 'yes_no', required: true, sort_order: 1 },
      { name: 'Extraction hood/canopy cleaned', item_type: 'yes_no', required: true, sort_order: 2 },
      { name: 'Drains checked and cleaned', item_type: 'yes_no', required: true, sort_order: 3 },
      { name: 'Notes or issues', item_type: 'text', required: false, sort_order: 4 },
    ],
  },
  {
    name: 'Cooking & Reheating Temperatures', description: 'Probe cooked and reheated food — core must reach 75°C',
    frequency: 'daily', assigned_roles: ['owner','manager','chef','kitchen_staff'],
    sfbb_section: 'cooking',
    items: [
      { name: 'Cooked food core temperature', item_type: 'temperature', required: true, sort_order: 0, min_value: 75, max_value: 100, unit: '°C' },
      { name: 'Reheated food core temperature', item_type: 'temperature', required: false, sort_order: 1, min_value: 75, max_value: 100, unit: '°C' },
      { name: 'Extra-care foods handled safely (rice, eggs, pulses, shellfish)', item_type: 'yes_no', required: true, sort_order: 2 },
      { name: 'Cooking notes', item_type: 'text', required: false, sort_order: 3 },
    ],
  },
  {
    name: 'Hot Holding Checks', description: 'Hot-held food must stay at 63°C or above',
    frequency: 'daily', assigned_roles: ['owner','manager','chef','kitchen_staff'],
    sfbb_section: 'cooking',
    items: [
      { name: 'Hot-held food temperature', item_type: 'temperature', required: true, sort_order: 0, min_value: 63, max_value: 100, unit: '°C' },
      { name: 'Food below 63°C used or discarded within 2 hours', item_type: 'yes_no', required: true, sort_order: 1 },
      { name: 'Hot display equipment preheated and working', item_type: 'yes_no', required: true, sort_order: 2 },
    ],
  },
  {
    name: 'Chilling Down Hot Food', description: 'Cool hot food within 90 minutes before refrigerating',
    frequency: 'daily', assigned_roles: ['owner','manager','chef','kitchen_staff'],
    sfbb_section: 'chilling',
    items: [
      { name: 'Hot food cooled and refrigerated within 90 minutes', item_type: 'yes_no', required: true, sort_order: 0 },
      { name: 'Temperature after chilling', item_type: 'temperature', required: false, sort_order: 1, min_value: 0, max_value: 8, unit: '°C' },
      { name: 'Chilled food covered, labelled and dated', item_type: 'yes_no', required: true, sort_order: 2 },
    ],
  },
  {
    name: 'Cross-contamination & Hygiene', description: 'Raw and ready-to-eat separation and staff hygiene checks',
    frequency: 'daily', assigned_roles: ['owner','manager','chef','kitchen_staff'],
    sfbb_section: 'cross_contamination',
    items: [
      { name: 'Separate boards and utensils for raw and ready-to-eat', item_type: 'yes_no', required: true, sort_order: 0 },
      { name: 'Raw food stored below ready-to-eat food', item_type: 'yes_no', required: true, sort_order: 1 },
      { name: 'Cloths clean or single-use', item_type: 'yes_no', required: true, sort_order: 2 },
      { name: 'All staff fit to work', item_type: 'yes_no', required: true, sort_order: 3 },
      { name: 'Allergen prep kept separate', item_type: 'yes_no', required: true, sort_order: 4 },
      { name: 'Hygiene notes', item_type: 'text', required: false, sort_order: 5 },
    ],
  },
  {
    name: '4-Weekly HACCP Review', description: 'Review and confirm HACCP Pack is up to date',
    frequency: 'four_weekly', assigned_roles: ['owner','manager'],
    sfbb_section: 'management',
    items: [
      { name: 'Cross-Contamination procedures up to date', item_type: 'yes_no', required: true, sort_order: 0 },
      { name: 'Cleaning procedures up to date', item_type: 'yes_no', required: true, sort_order: 1 },
      { name: 'Chilling procedures up to date', item_type: 'yes_no', required: true, sort_order: 2 },
      { name: 'Cooking procedures up to date', item_type: 'yes_no', required: true, sort_order: 3 },
      { name: 'Management procedures up to date', item_type: 'yes_no', required: true, sort_order: 4 },
      { name: 'Notes or changes made', item_type: 'text', required: false, sort_order: 5 },
    ],
  },
]

// Templates are site-scoped (multisite model): every site of the business
// gets its own copy of each default template, toggled off. Idempotent per
// site/name, so it's safe to call again after adding a site.
export async function seedDefaultChecklists(businessId: string) {
  const { data: sites } = await supabase
    .from('sites')
    .select('id')
    .eq('business_id', businessId)
  const siteIds: (string | null)[] = sites?.length ? sites.map((s) => s.id) : [null]

  for (const siteId of siteIds) {
    let q = supabase
      .from('checklist_templates')
      .select('name')
      .eq('business_id', businessId)
      .eq('is_default', true)
    q = siteId === null ? q.is('site_id', null) : q.eq('site_id', siteId)
    const { data: existing } = await q
    const have = new Set((existing ?? []).map((t) => t.name))

    for (const t of TEMPLATES) {
      if (have.has(t.name)) continue
      const { items, ...templateData } = t
      const { data: tmpl } = await supabase
        .from('checklist_templates')
        .insert({ ...templateData, business_id: businessId, site_id: siteId, is_default: true, active: false })
        .select('id')
        .single()

      if (tmpl) {
        await supabase.from('checklist_template_items').insert(
          items.map((item) => ({ ...item, template_id: tmpl.id }))
        )
      }
    }
  }
}
