import { describe, it, expect } from 'vitest'
import { toApplyPayload, defaultSelection, itemAddId } from '../apply'
import type { Draft, ExistingState } from '../types'

const draft: Draft = {
  checklists: [
    { key: 'a', name: 'A', description: '', sfbb_section: 'cleaning', frequency: 'daily', deadline_time: null, assigned_roles: ['owner'], items: [], reason: '' },
    { key: 'b', name: 'B', description: '', sfbb_section: 'cleaning', frequency: 'daily', deadline_time: null, assigned_roles: ['owner'], items: [], reason: '' },
    { key: 'c', name: 'C', description: '', sfbb_section: 'cleaning', frequency: 'daily', deadline_time: null, assigned_roles: ['owner'], items: [], reason: '', similarTo: 'Old C' },
  ],
  existing: [],
  itemAdds: [{ templateId: 't1', key: 'fridge_temps', templateName: 'F', item: { name: 'Prep temperature', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C' } }],
  fields: [
    { fieldId: 'hw_basin', methodId: 'handwashing', label: '', type: 'toggle', value: true, status: 'new' },
    { fieldId: 'cl_method', methodId: 'cloths', label: '', type: 'text', value: 'x', status: 'kept', current: 'y' },
  ],
  notes: [],
}
const existing: ExistingState = { templates: [], pack: null, packUpdatedAt: '2026-10-01T10:00:00.123456+00:00' }

describe('toApplyPayload', () => {
  // Changed deliberately (final review #3, #8): checklists similar to an existing default and item additions
  // to existing checklists start UNCHECKED; the owner opts in.
  it('default selection takes checklists without a similar existing one and every NEW field; item adds start unchecked', () => {
    expect(defaultSelection(draft)).toEqual({ checklistKeys: ['a', 'b'], itemAddIds: [], fieldIds: ['hw_basin'] })
  })
  it('respects unticked items and carries the pack version', () => {
    const p = toApplyPayload(draft, { checklistKeys: ['b'], itemAddIds: [], fieldIds: ['hw_basin'] }, existing)
    expect(p.checklists.map((c) => c.key)).toEqual(['b'])
    expect(p.item_adds).toEqual([])
    expect(p.pack?.toggles.hw_basin).toBe(true)
    expect(p.pack?.sources).toEqual({ hw_basin: 'questionnaire' })
    expect(p.pack_expected_updated_at).toBe('2026-10-01T10:00:00.123456+00:00')
    expect(p.summary).toEqual({ checklists: ['b'], item_adds: 0, fields: ['hw_basin'] })
  })
  it('sends pack null when no field is selected (pack untouched)', () => {
    expect(toApplyPayload(draft, { checklistKeys: [], itemAddIds: [], fieldIds: [] }, existing).pack).toBeNull()
  })
  it('a checklist ticked despite a similar existing one is sent without the UI-only similarTo', () => {
    const p = toApplyPayload(draft, { checklistKeys: ['c'], itemAddIds: [], fieldIds: [] }, existing)
    expect(p.checklists.map((c) => c.key)).toEqual(['c'])
    expect('similarTo' in p.checklists[0]).toBe(false)
  })
  it('itemAddId is stable', () => expect(itemAddId(draft.itemAdds[0])).toBe('t1:Prep temperature'))
})
