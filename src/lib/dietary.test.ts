import { describe, expect, test } from 'vitest'
import { computeDietary, effectiveDietary, DIETARY_FLAGS } from './dietary'

describe('computeDietary', () => {
  test('no allergens -> all four', () => {
    expect(computeDietary([])).toEqual(['Vegan', 'Vegetarian', 'Gluten-Free', 'Dairy-Free'])
  })
  test('milk excludes Vegan and Dairy-Free', () => {
    expect(computeDietary(['milk'])).toEqual(['Vegetarian', 'Gluten-Free'])
  })
  test('fish excludes Vegan and Vegetarian', () => {
    expect(computeDietary(['fish'])).toEqual(['Gluten-Free', 'Dairy-Free'])
  })
  test('gluten excludes Gluten-Free only', () => {
    expect(computeDietary(['gluten'])).toEqual(['Vegan', 'Vegetarian', 'Dairy-Free'])
  })
})

describe('effectiveDietary (override ?? computed)', () => {
  const noOverrides = {
    vegan_override: null, vegetarian_override: null,
    gluten_free_override: null, dairy_free_override: null,
  }
  test('all NULL -> same as computed', () => {
    expect(effectiveDietary(noOverrides, ['milk'])).toEqual(['Vegetarian', 'Gluten-Free'])
  })
  test('explicit false beats computed true (beef stew is not vegetarian)', () => {
    expect(effectiveDietary({ ...noOverrides, vegetarian_override: false, vegan_override: false }, []))
      .toEqual(['Gluten-Free', 'Dairy-Free'])
  })
  test('explicit true beats computed false (gluten-free soy sauce)', () => {
    expect(effectiveDietary({ ...noOverrides, gluten_free_override: true }, ['gluten']))
      .toEqual(['Vegan', 'Vegetarian', 'Gluten-Free', 'Dairy-Free'])
  })
  test('flag metadata maps labels to columns', () => {
    expect(DIETARY_FLAGS.map((f) => f.column)).toEqual([
      'vegan_override', 'vegetarian_override', 'gluten_free_override', 'dairy_free_override',
    ])
  })
})
