import { describe, expect, test } from 'vitest'
import { FEEDBACK_COPY, FEEDBACK_KINDS, feedbackMessageError } from './feedback'

describe('feedback copy', () => {
  test('defines copy for every supported kind', () => {
    expect(Object.keys(FEEDBACK_COPY)).toEqual(FEEDBACK_KINDS)
  })
})

describe('feedbackMessageError', () => {
  test('rejects blank and very short messages', () => {
    expect(feedbackMessageError('   ')).toBe('Please add a little more detail.')
    expect(feedbackMessageError('help')).toBe('Please add a little more detail.')
  })

  test('accepts a useful message', () => {
    expect(feedbackMessageError('The checklist does not save.')).toBeNull()
  })

  test('rejects messages over the database limit', () => {
    expect(feedbackMessageError('x'.repeat(4001))).toBe('Please keep your message under 4,000 characters.')
  })
})
