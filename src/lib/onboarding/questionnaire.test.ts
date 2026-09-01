import { test, expect } from 'vitest'
import { buildBriefs } from './questionnaire'

test('kitchen fridges → one temperature-record brief naming each unit', () => {
  const briefs = buildBriefs({ areas: ['kitchen'], kitchen: {
    fridges: [{ name: 'Fridge 1', kind: 'fridge' }, { name: 'Chest Freezer', kind: 'freezer' }],
    probeCount: 0, sinkCount: 1, cooking: [],
    routines: { opening: false, closing: false, cleaning: false, allergen: false } } })
  expect(briefs).toHaveLength(1)
  expect(briefs[0].title).toBe('Fridge & Freezer Temperature Record')
  expect(briefs[0].frequency).toBe('daily')
  expect(briefs[0].prompt).toContain('Fridge 1')
  expect(briefs[0].prompt).toContain('Chest Freezer')
  expect(briefs[0].prompt).toContain('−18°C')
})

test('probes + routines add briefs; allergen is four_weekly', () => {
  const briefs = buildBriefs({ areas: ['kitchen'], kitchen: {
    fridges: [], probeCount: 2, sinkCount: 2, cooking: ['raw', 'cook_chill'],
    routines: { opening: true, closing: false, cleaning: false, allergen: true } } })
  const keys = briefs.map((b) => b.key)
  expect(keys).toContain('kitchen-probe-calibration')
  expect(keys).toContain('kitchen-opening')
  expect(keys).toContain('kitchen-cook-cool')
  expect(briefs.find((b) => b.key === 'kitchen-allergen')?.frequency).toBe('four_weekly')
})

test('foh cold displays + opening → those two briefs in order', () => {
  const briefs = buildBriefs({ areas: ['foh'], foh: {
    coldDisplayCount: 3, routines: { opening: true, closing: false, cleaning: false } } })
  expect(briefs.map((b) => b.key)).toEqual(['foh-cold-display', 'foh-opening'])
})

test('area not selected contributes nothing even if answers present', () => {
  const briefs = buildBriefs({ areas: ['foh'], kitchen: {
    fridges: [{ name: 'Fridge 1', kind: 'fridge' }], probeCount: 1, sinkCount: 1, cooking: [],
    routines: { opening: true, closing: true, cleaning: true, allergen: true } },
    foh: { coldDisplayCount: 0, routines: { opening: false, closing: false, cleaning: false } } })
  expect(briefs).toHaveLength(0)
})
