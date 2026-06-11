import { describe, expect, test } from 'vitest'
import { normalizeTag, getRecipeTags, groupByTags, UNTAGGED } from './tags'

describe('normalizeTag', () => {
  test('lowercases and trims', () => {
    expect(normalizeTag('  Pasta Dishes ')).toBe('pasta dishes')
  })
})

describe('getRecipeTags', () => {
  test('extracts sorted tag refs from the supabase join shape', () => {
    const recipe = {
      recipe_tags: [
        { tag: { id: 't2', name: 'Pasta' } },
        { tag: { id: 't1', name: 'hits' } },
        { tag: null }, // defensive: dangling join row
      ],
    }
    expect(getRecipeTags(recipe)).toEqual([
      { id: 't1', name: 'hits' },
      { id: 't2', name: 'Pasta' },
    ])
  })
  test('missing join key -> empty list', () => {
    expect(getRecipeTags({})).toEqual([])
  })
})

describe('groupByTags (duplicate under each tag, Untagged last)', () => {
  const carbonara = { id: 'r1', name: 'Carbonara', recipe_tags: [{ tag: { id: 't1', name: 'Pasta' } }, { tag: { id: 't2', name: 'hits' } }] }
  const tiramisu = { id: 'r2', name: 'Tiramisu', recipe_tags: [{ tag: { id: 't3', name: 'Desserts' } }] }
  const water = { id: 'r3', name: 'Water', recipe_tags: [] }

  test('multi-tag recipe appears in every one of its sections', () => {
    const groups = groupByTags([carbonara, tiramisu, water])
    expect(groups.map((g) => g.title)).toEqual(['Desserts', 'hits', 'Pasta', UNTAGGED])
    expect(groups.find((g) => g.title === 'Pasta')!.recipes.map((r: any) => r.id)).toEqual(['r1'])
    expect(groups.find((g) => g.title === 'hits')!.recipes.map((r: any) => r.id)).toEqual(['r1'])
    expect(groups.find((g) => g.title === UNTAGGED)!.recipes.map((r: any) => r.id)).toEqual(['r3'])
  })
  test('sections sorted case-insensitively, recipes by name', () => {
    const groups = groupByTags([tiramisu, carbonara])
    expect(groups.map((g) => g.title)).toEqual(['Desserts', 'hits', 'Pasta'])
  })
  test('no untagged recipes -> no Untagged section', () => {
    expect(groupByTags([tiramisu]).map((g) => g.title)).toEqual(['Desserts'])
  })
})
