import { describe, it, expect } from 'vitest'
import { CAPS, CAP_LABEL, CAP_GROUPS, PRESET_CAPS } from '@/lib/permissions'

describe('manage_reviews capability', () => {
  it('exists, is labelled and grouped', () => {
    expect(CAPS).toContain('manage_reviews')
    expect(CAP_LABEL.manage_reviews).toBe('Manage Google reviews')
    expect(CAP_GROUPS.flatMap((g) => g.caps)).toContain('manage_reviews')
  })
  it('ships with Owner and Manager presets only (mirrors seed_business_roles)', () => {
    expect(PRESET_CAPS.owner).toContain('manage_reviews')
    expect(PRESET_CAPS.manager).toContain('manage_reviews')
    expect(PRESET_CAPS.chef).not.toContain('manage_reviews')
    expect(PRESET_CAPS.kitchen_staff).not.toContain('manage_reviews')
    expect(PRESET_CAPS.front_of_house).not.toContain('manage_reviews')
  })
  it('every grouped capability is in CAPS exactly once', () => {
    const grouped = CAP_GROUPS.flatMap((g) => g.caps)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual([...CAPS].sort())
  })
})
