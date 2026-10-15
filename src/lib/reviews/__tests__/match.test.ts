import { describe, it, expect } from 'vitest'
import { suggestSite, normPostcode } from '../../../../supabase/functions/_shared/reviews/match'

const S = (id: string, name: string, postcode: string) => ({ id, name, postcode, timezone: 'Europe/London' })
const sites = [S('a', 'Wharf Side', 'N1 7GR'), S('b', 'Angel', 'N1 9AA'), S('c', 'Islington', 'n19aa'), S('d', 'Soho', '')]

describe('suggestSite', () => {
  it('normalises postcodes', () => expect(normPostcode(' n1-7gr ')).toBe('N17GR'))
  it('unique postcode match wins', () => expect(suggestSite({ postcode: 'n1 7gr', title: 'Anything' }, sites)).toBe('a'))
  it('several sites share the postcode → narrow by name', () => expect(suggestSite({ postcode: 'N1 9AA', title: 'Casa-Mia Islington' }, sites)).toBe('c'))
  it('no postcode match → name match', () => expect(suggestSite({ postcode: 'W1 1AA', title: 'Casa-Mia Soho' }, sites)).toBe('d'))
  it('ambiguous or nothing → null', () => {
    expect(suggestSite({ postcode: 'N1 9AA', title: 'Casa-Mia' }, sites)).toBeNull()
    expect(suggestSite({ postcode: '', title: 'Elsewhere' }, sites)).toBeNull()
  })
})
