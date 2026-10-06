import { describe, it, expect } from 'vitest'
import { QUESTIONS } from '../content/questions'
import { visibleQuestions, effectiveAnswers, nextQuestion, suggestedAnswer, progressBySection } from '../engine'
import type { Question } from '../types'

const mini: Question[] = [
  { id: 'a', text: 'A?', why: 'w', section: 'cooking', answer: { kind: 'yes_no' } },
  { id: 'b', text: 'B?', why: 'w', section: 'cooking', answer: { kind: 'yes_no' }, showIf: { q: 'a', eq: true } },
  { id: 'c', text: 'C?', why: 'w', section: 'chilling', answer: { kind: 'yes_no' }, showIf: { q: 'b', eq: true } },
  { id: 'd', text: 'D?', why: 'w', section: 'management', answer: { kind: 'single', options: [{ value: 'x', label: 'X' }] },
    defaultsByType: { bakery: 'x' } },
]

describe('engine', () => {
  it('first question is the first unanswered visible one', () => {
    expect(nextQuestion(mini, {})?.id).toBe('a')
    expect(nextQuestion(mini, { a: false })?.id).toBe('d')
    expect(nextQuestion(mini, { a: true })?.id).toBe('b')
  })
  it('returns null when every visible question is answered', () => {
    expect(nextQuestion(mini, { a: false, d: 'x' })).toBeNull()
  })
  it('hiding is transitive and stale answers are dropped', () => {
    const answers = { a: false, b: true, c: true, d: 'x' }
    expect(visibleQuestions(mini, answers).map((q) => q.id)).toEqual(['a', 'd'])
    expect(effectiveAnswers(mini, answers)).toEqual({ a: false, d: 'x' })
  })
  it('suggests the venue-type default', () => {
    expect(suggestedAnswer(mini[3], { venue_type: 'bakery' })).toBe('x')
    expect(suggestedAnswer(mini[3], { venue_type: 'takeaway' })).toBeUndefined()
  })
  it('progress counts only visible questions', () => {
    const p = progressBySection(mini, { a: true, b: false })
    expect(p.cooking).toEqual({ answered: 2, total: 2 })
    expect(p.chilling).toEqual({ answered: 0, total: 0 })
    expect(p.management).toEqual({ answered: 0, total: 1 })
  })
})

describe('QUESTIONS content', () => {
  it('starts with venue type and processes', () => {
    expect(QUESTIONS[0].id).toBe('venue_type')
    expect(QUESTIONS[1].id).toBe('processes')
  })
  it('a coffee shop that only does RTE never sees cooling or reheating questions', () => {
    const ans = { venue_type: 'coffee_shop', processes: ['rte_prep', 'deliveries_in'] }
    const ids = visibleQuestions(QUESTIONS, ans).map((q) => q.id)
    expect(ids).not.toContain('cooling_method')
    expect(ids).not.toContain('reheat_once')
    expect(ids).toContain('handwash_basin')
  })
})
