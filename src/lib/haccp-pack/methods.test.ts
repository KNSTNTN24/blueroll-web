import { describe, it, expect } from 'vitest'
import { HACCP_METHODS, findField } from './methods'

describe('HACCP_METHODS', () => {
  it('has 26 methods across the 5 SFBB sections', () => {
    expect(HACCP_METHODS).toHaveLength(26)
    expect(new Set(HACCP_METHODS.map((m) => m.section))).toEqual(
      new Set(['cross', 'cleaning', 'chilling', 'cooking', 'management']),
    )
  })
  it('field ids are globally unique', () => {
    const ids = HACCP_METHODS.flatMap((m) => m.fields.map((f) => f.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('findField returns the field with its method id', () => {
    expect(findField('hw_basin')).toMatchObject({ id: 'hw_basin', type: 'toggle', methodId: 'handwashing' })
    expect(findField('nope')).toBeUndefined()
  })
})
