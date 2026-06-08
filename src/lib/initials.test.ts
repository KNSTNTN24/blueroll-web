import { describe, expect, test } from 'vitest'
import { normalizeInitials, isValidInitials } from './initials'

describe('initials', () => {
  test('uppercases and trims', () => expect(normalizeInitials(' jd ')).toBe('JD'))
  test('valid: 2-5 alphanumeric', () => {
    expect(isValidInitials('JD')).toBe(true)
    expect(isValidInitials('JDOE5')).toBe(true)
  })
  test('invalid: too short/long/symbols', () => {
    expect(isValidInitials('J')).toBe(false)
    expect(isValidInitials('JDOEXX')).toBe(false)
    expect(isValidInitials('J.D')).toBe(false)
    expect(isValidInitials('')).toBe(false)
  })
})
