import { describe, it, expect } from 'vitest'
import { dedupeEquipment } from '../equipment-labels'

describe('dedupeEquipment', () => {
  it('keeps unique labels untouched', () => {
    expect(dedupeEquipment([], [{ kind: 'fridge', label: 'Walk-in' }, { kind: 'freezer', label: 'Chest' }]))
      .toEqual([{ kind: 'fridge', label: 'Walk-in' }, { kind: 'freezer', label: 'Chest' }])
  })
  it('suffixes duplicates case-insensitively against existing and within the batch', () => {
    const out = dedupeEquipment([{ kind: 'fridge', label: 'Fridge' }],
      [{ kind: 'fridge', label: 'fridge' }, { kind: 'fridge', label: 'FRIDGE' }, { kind: 'probe', label: 'Probe' }])
    expect(out.map((e) => e.label)).toEqual(['Fridge', 'fridge (2)', 'FRIDGE (3)', 'Probe'])
  })
  it('skips suffixes already taken', () => {
    const out = dedupeEquipment([{ kind: 'fridge', label: 'Fridge' }, { kind: 'fridge', label: 'Fridge (2)' }], [{ kind: 'fridge', label: 'Fridge' }])
    expect(out[2].label).toBe('Fridge (3)')
  })
  it('trims labels and keeps them within 60 chars including the suffix', () => {
    const long = 'x'.repeat(60)
    const out = dedupeEquipment([{ kind: 'other', label: long }], [{ kind: 'other', label: `  ${long}  ` }])
    expect(out[1].label).toHaveLength(60)
    expect(out[1].label.endsWith(' (2)')).toBe(true)
  })
})
