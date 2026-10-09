import { describe, it, expect } from 'vitest'
import { pageAll, PAGE_SIZE } from '../../../../supabase/functions/_shared/channels/db'

describe('pageAll', () => {
  it('keeps fetching pages until a short page (no 1000-row truncation)', async () => {
    const rows = Array.from({ length: PAGE_SIZE * 2 + 7 }, (_, i) => i)
    const ranges: [number, number][] = []
    const got = await pageAll<number>((from, to) => { ranges.push([from, to]); return Promise.resolve({ data: rows.slice(from, to + 1), error: null }) })
    expect(got).toEqual(rows)
    expect(ranges).toEqual([[0, PAGE_SIZE - 1], [PAGE_SIZE, 2 * PAGE_SIZE - 1], [2 * PAGE_SIZE, 3 * PAGE_SIZE - 1]])
  })
  it('an exact multiple ends with an empty page; errors throw', async () => {
    const rows = Array.from({ length: PAGE_SIZE }, (_, i) => i)
    expect(await pageAll<number>((from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }))).toHaveLength(PAGE_SIZE)
    await expect(pageAll(() => Promise.resolve({ data: null, error: { message: 'boom' } }))).rejects.toMatchObject({ message: 'boom' })
  })
})
