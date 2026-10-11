import { describe, it, expect } from 'vitest'
import { GROUP_LINK_STEPS, mappingDiff, checklistLabel, LINK_CODE_TTL_SEC } from '../groups'

describe('telegram groups helpers', () => {
  it('link steps carry the /link command with the code', () => {
    const steps = GROUP_LINK_STEPS('482913')
    expect(steps).toContain('Send this message in the group: /link 482913')
    expect(steps[1]).toBe('Add @BluerollChecksBot to the group.')
    expect(LINK_CODE_TTL_SEC).toBe(900)
  })
  it('mappingDiff adds and removes only what changed', () => {
    expect(mappingDiff(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] })
    expect(mappingDiff(['a'], ['a'])).toEqual({ add: [], remove: [] })
    expect(mappingDiff([], ['a', 'a'])).toEqual({ add: ['a'], remove: [] })
  })
  it('checklistLabel names the site for site-specific checklists', () => {
    const sites = new Map([['s1', 'Wharf Side']])
    expect(checklistLabel({ id: 't', name: 'Fridge temps', site_id: null }, sites)).toBe('Fridge temps')
    expect(checklistLabel({ id: 't', name: 'Fridge temps', site_id: 's1' }, sites)).toBe('Fridge temps · Wharf Side')
    expect(checklistLabel({ id: 't', name: 'Fridge temps', site_id: 'gone' }, sites)).toBe('Fridge temps · other site')
  })
})
