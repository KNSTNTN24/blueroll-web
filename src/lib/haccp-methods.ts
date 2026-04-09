// ── HACCP control methods applicable to recipes ──
// Method IDs match HACCP_METHODS in (dashboard)/haccp-pack/page.tsx
// so the HACCP Pack can filter recipes per method without any mapping.

export type HaccpMethodSection = 'Chilling' | 'Cooking'

export interface HaccpRecipeMethod {
  id: string
  label: string
  section: HaccpMethodSection
  description: string
}

export const HACCP_RECIPE_METHODS: readonly HaccpRecipeMethod[] = [
  // ── Chilling ──
  {
    id: 'chilled_storage',
    label: 'Chilled Storage',
    section: 'Chilling',
    description: '0–5°C, FIFO, date labelling',
  },
  {
    id: 'chilling_down',
    label: 'Chilling Down Hot Food',
    section: 'Chilling',
    description: 'Cool to <8°C within 90 min, split into portions',
  },
  {
    id: 'defrosting',
    label: 'Defrosting',
    section: 'Chilling',
    description: 'In fridge (preferred) or microwave + immediate cook, no refreezing',
  },
  {
    id: 'freezing',
    label: 'Freezing',
    section: 'Chilling',
    description: '−18°C, labelled with freeze date',
  },

  // ── Cooking ──
  {
    id: 'cooking_safely',
    label: 'Cooking Safely',
    section: 'Cooking',
    description: '75°C core for 2 seconds, probe + visual checks',
  },
  {
    id: 'extra_care',
    label: 'Extra Care Foods',
    section: 'Cooking',
    description: 'Special rules: eggs, rice, pulses, shellfish',
  },
  {
    id: 'reheating',
    label: 'Reheating',
    section: 'Cooking',
    description: '75°C core (82°C Scotland), once only, probe-checked',
  },
  {
    id: 'hot_holding',
    label: 'Hot Holding',
    section: 'Cooking',
    description: '≥63°C, max 2 hours',
  },
  {
    id: 'ready_to_eat',
    label: 'Ready-to-Eat',
    section: 'Cooking',
    description: 'Separate from raw, dedicated utensils, stored above raw',
  },
] as const

export const HACCP_RECIPE_METHOD_IDS = HACCP_RECIPE_METHODS.map((m) => m.id)

export function getMethodLabel(id: string): string {
  return HACCP_RECIPE_METHODS.find((m) => m.id === id)?.label ?? id
}

export function groupMethodsBySection(): Record<HaccpMethodSection, HaccpRecipeMethod[]> {
  return HACCP_RECIPE_METHODS.reduce(
    (acc, m) => {
      ;(acc[m.section] ??= []).push(m)
      return acc
    },
    {} as Record<HaccpMethodSection, HaccpRecipeMethod[]>,
  )
}
