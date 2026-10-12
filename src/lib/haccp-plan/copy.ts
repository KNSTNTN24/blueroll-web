import { HACCP_METHODS, type SectionId } from '@/lib/haccp-pack/methods'
import type { InfographicKey } from './types'

export const SECTION_ORDER: SectionId[] = ['cross', 'cleaning', 'chilling', 'cooking', 'management']
export const SECTION_NAME: Record<SectionId, string> = {
  cross: 'Cross-contamination', cleaning: 'Cleaning', chilling: 'Chilling', cooking: 'Cooking', management: 'Management',
}
export const OGL_ATTRIBUTION =
  'Safety points adapted from Safer Food, Better Business for Caterers (Food Standards Agency). Contains public sector information licensed under the Open Government Licence v3.0.'

type Copy = { safetyPoint: string; why: string; infographic: InfographicKey[] }
export const METHOD_COPY: Record<string, Copy> = {
  personal_hygiene: { safetyPoint: 'Everyone handling food keeps themselves and their clothing clean, and reports illness.', why: 'People carry harmful bacteria on hands, hair and clothes. Staff with sickness or diarrhoea can contaminate food even after they feel better.', infographic: [] },
  cloths: { safetyPoint: 'Cloths are used in a way that does not spread bacteria.', why: 'Dirty cloths are one of the main ways bacteria spread around a kitchen.', infographic: [] },
  separating_foods: { safetyPoint: 'Raw and ready-to-eat foods are kept apart at every stage.', why: 'Bacteria from raw meat, poultry, fish, eggs and unwashed vegetables can spread to food that will not be cooked again.', infographic: [] },
  food_allergies: { safetyPoint: 'We know which of the 14 allergens are in every dish.', why: 'A trace can cause a severe reaction. The law requires accurate allergen information for all food we sell.', infographic: ['allergenMatrix'] },
  contamination_prevention: { safetyPoint: 'Food is protected from physical and chemical contamination.', why: 'Glass, metal, packaging and cleaning chemicals in food can injure or poison customers.', infographic: [] },
  pest_control: { safetyPoint: 'The premises are kept free of pests.', why: 'Mice, rats, flies and cockroaches spread bacteria and contaminate food and surfaces.', infographic: [] },
  handwashing: { safetyPoint: 'Staff wash their hands properly and at the right times.', why: 'Clean hands stop bacteria spreading from raw food, bins, toilets and phones to ready-to-eat food.', infographic: [] },
  cleaning_effectively: { safetyPoint: 'Surfaces and equipment are cleaned, then disinfected.', why: 'Dirt and grease stop disinfectant from working. Clean first, then disinfect — two separate stages.', infographic: ['twoStageClean'] },
  clear_clean: { safetyPoint: 'Work areas are cleared and cleaned as we go.', why: 'Clutter and spills hide dirt and let bacteria build up during service.', infographic: [] },
  cleaning_schedule: { safetyPoint: 'Every area and piece of equipment is on a cleaning schedule.', why: 'A schedule makes sure nothing is missed, including jobs done weekly or monthly.', infographic: ['cleaningFrequency'] },
  chilled_storage: { safetyPoint: 'Chilled food is kept at 8 °C or below; we aim for 0–5 °C.', why: 'Harmful bacteria multiply fastest between 8 °C and 63 °C. Cold food stays safe until its use-by date.', infographic: ['tempScale'] },
  chilling_down: { safetyPoint: 'Cooked food that is not served straight away is cooled quickly, then refrigerated.', why: 'Food left warm lets bacteria and their toxins build up. Cooling within 90 minutes keeps it safe.', infographic: [] },
  defrosting: { safetyPoint: 'Frozen food is defrosted safely, or cooked from frozen where the instructions allow.', why: 'Food still frozen in the middle may not cook through, and defrosting at room temperature lets bacteria grow on the outside.', infographic: [] },
  freezing: { safetyPoint: 'Frozen food is kept at −18 °C or below and frozen before its use-by date.', why: 'Freezing stops bacteria growing but does not kill them, so food must be frozen while still safe.', infographic: [] },
  cooking_safely: { safetyPoint: 'Food is cooked until it is steaming hot all the way through.', why: 'Thorough cooking kills harmful bacteria. Hotter for less time works too — each line below is equally safe.', infographic: ['cookCombos', 'panToPass'] },
  extra_care: { safetyPoint: 'Foods with extra risks are prepared with extra care.', why: 'Rice, eggs, pulses, shellfish and some meats carry particular hazards, such as toxins that survive reheating.', infographic: [] },
  reheating: { safetyPoint: 'Food is reheated until steaming hot, and only once.', why: 'Reheating must kill any bacteria that grew while the food was stored.', infographic: [] },
  menu_checks: { safetyPoint: 'Every dish on the menu has a checked way of being cooked safely.', why: 'Knowing how each dish is cooked and checked means new staff and new dishes follow the same safe method.', infographic: [] },
  hot_holding: { safetyPoint: 'Hot food held for service stays at 63 °C or above.', why: 'Below 63 °C bacteria can grow. Food held below 63 °C must be used within 2 hours, once.', infographic: ['panToPass'] },
  ready_to_eat: { safetyPoint: 'Ready-to-eat food is protected from raw food and handled hygienically.', why: 'Ready-to-eat food will not be cooked again, so any bacteria that reach it will reach the customer.', infographic: [] },
  opening_closing: { safetyPoint: 'The kitchen is checked before opening and after closing every day.', why: 'Daily checks catch problems — a warm fridge, an empty soap dispenser — before they affect food.', infographic: [] },
  suppliers: { safetyPoint: 'Food is bought only from reputable suppliers.', why: 'Safe food starts with ingredients that arrive cold, intact and in date.', infographic: [] },
  stock_control: { safetyPoint: 'Stock is checked on delivery and rotated so nothing goes past its date.', why: 'Out-of-date or damaged stock is a hazard, and a sign that control has slipped.', infographic: [] },
  training: { safetyPoint: 'Staff are trained and supervised for the work they do.', why: 'People can only follow safe methods they have been shown and understand.', infographic: [] },
  temperature_probes: { safetyPoint: 'Probe thermometers are clean, working and accurate.', why: 'Every temperature record depends on the probe. A faulty probe makes every record wrong.', infographic: [] },
  daily_diary: { safetyPoint: 'Checks are recorded every day the business is open.', why: 'Daily records show the system is working — this is what the inspector asks to see first.', infographic: [] },
}

/** "3.1" — section number in SECTION_ORDER, then the method's position within that section (HACCP_METHODS order). */
export function methodRef(methodId: string): string {
  const m = HACCP_METHODS.find((x) => x.id === methodId)
  if (!m) return ''
  const si = SECTION_ORDER.indexOf(m.section)
  const mi = HACCP_METHODS.filter((x) => x.section === m.section).findIndex((x) => x.id === methodId)
  return `${si + 1}.${mi + 1}`
}
