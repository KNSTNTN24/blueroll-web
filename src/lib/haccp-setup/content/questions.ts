// src/lib/haccp-setup/content/questions.ts
import type { Question } from '../types'

export const QUESTIONNAIRE_VERSION = 1

const HOT: Question['showIf'] = { any: [{ q: 'processes', has: 'cook_hot' }, { q: 'processes', has: 'reheat' }, { q: 'processes', has: 'hot_hold' }] }
const HAS_PROBE: Question['showIf'] = { equipment: ['probe'] }

export const QUESTIONS: Question[] = [
  // ── Profile ──
  { id: 'venue_type', section: 'management', text: 'What kind of business is this site?',
    why: 'We use it to pre-fill typical answers. You can change any of them.',
    answer: { kind: 'single', options: [
      { value: 'restaurant', label: 'Restaurant or café with a kitchen' },
      { value: 'coffee_shop', label: 'Coffee shop (little or no hot food)' },
      { value: 'takeaway', label: 'Takeaway or delivery kitchen' },
      { value: 'bakery', label: 'Bakery or patisserie' },
    ] } },
  { id: 'processes', section: 'cooking', text: 'Which of these do you do here? Tick all that apply.',
    why: 'Each process has its own SFBB safe method and checks. We only ask about what you actually do.',
    answer: { kind: 'multi', options: [
      { value: 'cook_hot', label: 'Cook food from raw' },
      { value: 'cool_cooked', label: 'Cool cooked food to use later' },
      { value: 'reheat', label: 'Reheat food' },
      { value: 'hot_hold', label: 'Keep food hot for service (bain-marie, hot cabinet)' },
      { value: 'defrost', label: 'Defrost frozen food' },
      { value: 'rte_prep', label: 'Prepare ready-to-eat food (salads, sandwiches, desserts)' },
      { value: 'bake', label: 'Bake bread, cakes or pastries on site' },
      { value: 'deliveries_in', label: 'Receive food deliveries from suppliers' },
      { value: 'delivery_out', label: 'Deliver to customers or use delivery apps' },
    ] },
    defaultsByType: {
      restaurant: ['cook_hot', 'cool_cooked', 'reheat', 'hot_hold', 'defrost', 'rte_prep', 'deliveries_in'],
      coffee_shop: ['rte_prep', 'deliveries_in'],
      takeaway: ['cook_hot', 'reheat', 'hot_hold', 'defrost', 'deliveries_in', 'delivery_out'],
      bakery: ['bake', 'rte_prep', 'deliveries_in', 'defrost'],
    } },
  { id: 'extra_care', section: 'cooking', text: 'Do you serve any of these "extra care" foods?',
    why: 'SFBB has specific safe methods for these foods. We will add them to your HACCP pack.',
    showIf: { any: [{ q: 'processes', has: 'cook_hot' }, { q: 'processes', has: 'rte_prep' }] },
    answer: { kind: 'multi', options: [
      { value: 'eggs', label: 'Eggs (incl. runny or raw-egg dishes)' },
      { value: 'rice', label: 'Rice' },
      { value: 'pulses', label: 'Pulses (e.g. red kidney beans)' },
      { value: 'shellfish', label: 'Shellfish' },
    ] } },

  // ── Equipment ──
  { id: 'equipment', section: 'chilling', text: 'List your fridges, freezers, display chillers, probe thermometers and dishwashers.',
    why: 'Each fridge and freezer gets its own temperature line in your daily log.',
    answer: { kind: 'equipment_list' } },

  // ── Cross-contamination & personal hygiene ──
  { id: 'separation', section: 'cross', text: 'How do you keep raw meat, fish and eggs away from ready-to-eat food?',
    why: 'Separating raw and ready-to-eat food is the single biggest control against E. coli (SFBB Cross-contamination).',
    answer: { kind: 'single', options: [
      { value: 'separate_fridges', label: 'Separate fridges for raw and ready-to-eat' },
      { value: 'raw_below', label: 'Same fridge, raw always on the bottom shelf' },
      { value: 'no_raw', label: "We don't handle raw meat, fish or eggs" },
    ] },
    defaultsByType: { coffee_shop: 'no_raw', bakery: 'raw_below', restaurant: 'raw_below', takeaway: 'raw_below' } },
  { id: 'colour_boards', section: 'cross', text: 'Do you use separate (colour-coded) boards and utensils for raw and ready-to-eat food?',
    why: 'Shared boards and knives move bacteria from raw to ready-to-eat food.',
    showIf: { not: { q: 'separation', eq: 'no_raw' } }, answer: { kind: 'yes_no' } },
  { id: 'hygiene_rules', section: 'cross',
    text: 'Do staff follow these rules: hair tied back, no jewellery except a plain band, short clean nails, cuts covered with a blue plaster, hands washed before handling food?',
    why: 'These are the SFBB personal hygiene basics an inspector will ask about.', answer: { kind: 'yes_no' } },
  { id: 'illness_policy', section: 'cross',
    text: 'Do staff tell a manager when they are ill, and stay off work until 48 hours after vomiting or diarrhoea stops?',
    why: 'The 48-hour rule is an SFBB requirement for food handlers.', answer: { kind: 'yes_no' } },
  { id: 'uniform', section: 'cross', text: 'How do staff get clean work clothes?',
    why: 'SFBB asks you to describe how protective clothing is provided and kept clean.',
    answer: { kind: 'single', options: [
      { value: 'business_launders', label: 'We provide uniforms and launder them' },
      { value: 'staff_launder', label: 'We provide uniforms, staff wash them' },
      { value: 'aprons_only', label: 'Staff wear their own clothes with a clean apron' },
    ] } },
  { id: 'changing', section: 'cross', text: 'Where do staff change and keep their belongings?',
    why: 'Outdoor clothes and bags must be kept away from food areas.',
    answer: { kind: 'single', options: [
      { value: 'staff_room', label: 'Staff room with lockers' },
      { value: 'changing_area', label: 'A separate changing area or cupboard' },
      { value: 'none', label: 'No separate area' },
    ] } },
  { id: 'allergen_matrix', section: 'cross', text: 'Do you keep an up-to-date allergen chart for every dish?',
    why: 'You must be able to tell customers which of the 14 allergens are in every dish.', answer: { kind: 'yes_no' } },
  { id: 'allergen_ask', section: 'cross', text: 'Do staff ask customers about allergies and tell them where allergen information is?',
    why: 'Communicating allergens to customers is a legal requirement.', answer: { kind: 'yes_no' } },
  { id: 'allergen_training', section: 'cross', text: 'Have all food handlers been trained on the 14 allergens?',
    why: 'Untrained staff are the most common cause of allergen incidents.', answer: { kind: 'yes_no' } },
  { id: 'cloths', section: 'cross', text: 'What cloths do you use for cleaning?',
    why: 'Dirty cloths spread bacteria; SFBB requires single-use cloths or a hot wash.',
    answer: { kind: 'single', options: [
      { value: 'single_use', label: 'Single-use cloths or paper towels' },
      { value: 'reusable_90', label: 'Reusable cloths washed at 90 °C' },
      { value: 'both', label: 'Both' },
    ] } },
  { id: 'chemicals', section: 'cross', text: 'Where are cleaning chemicals stored?',
    why: 'Chemicals must never be stored with or above food.',
    answer: { kind: 'single', options: [
      { value: 'separate_room', label: 'A separate room or store' },
      { value: 'separate_cupboard', label: 'A dedicated cupboard away from food' },
      { value: 'mixed', label: 'Near food at the moment' },
    ] } },
  { id: 'glass_policy', section: 'cross', text: 'Do you have rules to stop glass, staples, packaging or other objects getting into food?',
    why: 'Physical contamination is part of SFBB Cross-contamination.', answer: { kind: 'yes_no' } },
  { id: 'pest_control', section: 'cross', text: 'Who handles pest control?',
    why: 'You need to show regular checks — by a contractor or by your own team.',
    answer: { kind: 'single', options: [
      { value: 'contractor', label: 'A pest control contractor' },
      { value: 'in_house', label: 'We check ourselves' },
    ] } },
  { id: 'pest_proofing', section: 'cross', text: 'Are doors, windows and gaps proofed against pests (fly screens, door brushes, sealed holes)?',
    why: 'Proofing is the first line of pest prevention in SFBB.', answer: { kind: 'yes_no' } },

  // ── Cleaning ──
  { id: 'handwash_basin', section: 'cleaning', text: 'Do you have a basin used only for handwashing, with hot water, soap and paper towels?',
    why: 'A dedicated handwash basin is a legal requirement in food areas.', answer: { kind: 'yes_no' } },
  { id: 'sanitiser', section: 'cleaning', text: 'Does your sanitiser meet BS EN 1276 or BS EN 13697, and do you leave it for the contact time on the label?',
    why: 'Only these standards prove a sanitiser kills E. coli; the contact time is what makes it work.',
    answer: { kind: 'yes_no' } },
  { id: 'clean_as_go', section: 'cleaning', text: 'Do staff clear and clean as they go — surfaces cleaned between tasks, spills cleaned at once, waste removed regularly?',
    why: 'SFBB "Clear and clean as you go" method.', answer: { kind: 'yes_no' } },
  { id: 'cleaning_schedule', section: 'cleaning', text: 'Do you have a written cleaning schedule?',
    why: 'Inspectors ask to see what is cleaned, how often and by whom.', answer: { kind: 'yes_no' } },

  // ── Chilling ──
  { id: 'labels', section: 'chilling', text: 'Do you label food with the date it was prepared or opened?',
    why: 'Labels make sure food is used within its safe life.', answer: { kind: 'yes_no' } },
  { id: 'fifo', section: 'chilling', text: 'Do you rotate stock (first in, first out) and throw away food past its use-by date?',
    why: 'SFBB Stock control.', answer: { kind: 'yes_no' } },
  { id: 'delivery_checks', section: 'chilling', text: 'Do you check the temperature, packaging and dates of every delivery?',
    why: 'Chilled deliveries above 5 °C or frozen above −15 °C should be rejected.',
    showIf: { q: 'processes', has: 'deliveries_in' }, answer: { kind: 'yes_no' } },
  { id: 'cooling_method', section: 'chilling', text: 'How do you cool cooked food?',
    why: 'Food must be cooled to below 8 °C within 90 minutes.',
    showIf: { q: 'processes', has: 'cool_cooked' },
    answer: { kind: 'single', options: [
      { value: 'blast_chiller', label: 'Blast chiller' },
      { value: 'portions', label: 'Divide into small portions or shallow trays, then fridge' },
      { value: 'ice_bath', label: 'Ice bath or cold water, then fridge' },
    ] } },
  { id: 'defrost_method', section: 'chilling', text: 'How do you defrost food?',
    why: 'Each method has its own SFBB safe method.',
    showIf: { q: 'processes', has: 'defrost' },
    answer: { kind: 'multi', options: [
      { value: 'fridge', label: 'In the fridge' },
      { value: 'microwave', label: 'In the microwave, then cooked at once' },
      { value: 'cold_water', label: 'Under cold running water' },
    ] } },
  { id: 'freeze_own', section: 'chilling', text: 'Do you freeze food yourselves?',
    why: 'Freezing your own food needs labelling and a safe method.', answer: { kind: 'yes_no' } },

  // ── Cooking ──
  { id: 'reheat_once', section: 'cooking', text: 'Is food reheated only once and checked with a probe?',
    why: 'Reheating more than once increases the risk; the core must reach 75 °C (82 °C in Scotland).',
    showIf: { q: 'processes', has: 'reheat' }, answer: { kind: 'yes_no' } },
  { id: 'probe_calibration', section: 'cooking', text: 'Do you check your probe thermometer in iced water and boiling water at least monthly?',
    why: 'A probe that reads wrong makes every temperature record wrong.',
    showIf: HAS_PROBE, answer: { kind: 'yes_no' } },
  { id: 'new_dishes', section: 'cooking', text: 'Before a new dish goes on the menu, do you check how it is cooked and update the allergen information?',
    why: 'SFBB Menu checks.', showIf: HOT, answer: { kind: 'yes_no' } },

  // ── Management ──
  { id: 'opening_closing', section: 'management', text: 'Will you complete opening and closing checks every day?',
    why: 'Opening and closing checks are the core of the SFBB diary. Blueroll will create them for you.', answer: { kind: 'yes_no' } },
  { id: 'approved_suppliers', section: 'management', text: 'Do you only buy food from reputable, registered suppliers?',
    why: 'You must be able to trace where your food comes from.', answer: { kind: 'yes_no' } },
  { id: 'induction', section: 'management', text: 'Does every new member of staff get food safety training before handling food?',
    why: 'SFBB Training: inspectors ask how new staff are trained.', answer: { kind: 'yes_no' } },
  { id: 'diary', section: 'management', text: 'Will you use Blueroll as your daily food safety diary?',
    why: 'Completed checklists in Blueroll are your SFBB daily diary records.', answer: { kind: 'yes_no' } },
]
