import { describe, it, expect } from 'vitest'
import { isScottishPostcode } from '../geo'

describe('isScottishPostcode', () => {
  it.each(['EH1 1YZ', 'g2 3ab', 'AB10 1AA', 'KY16 9AJ', 'ZE1 0AA', 'TD9 7AA', 'IV2 3BB'])('%s is Scottish', (p) =>
    expect(isScottishPostcode(p)).toBe(true))
  it.each(['N8 9AA', 'GL1 1AA', 'TD15 1AA', 'SW1A 1AA', 'HG1 1AA', '', null, undefined])('%s is not', (p) =>
    expect(isScottishPostcode(p as string)).toBe(false))
})
