import { describe, it, expect } from 'vitest'
import { QUESTIONS } from '../content/questions'
import { TAB_ORDER, tabOf, progressByTab, visibleQuestions } from '../engine'

describe('questionnaire tabs', () => {
  it('profile questions come first and tabs follow the question order', () => {
    const order = QUESTIONS.map((q) => TAB_ORDER.indexOf(tabOf(q)))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(QUESTIONS.slice(0, 4).map(tabOf)).toEqual(['profile', 'profile', 'profile', 'profile'])
  })
  it('progress per tab counts only visible questions', () => {
    const answers = { venue_type: 'coffee_shop', processes: ['rte_prep'] }
    const p = progressByTab(QUESTIONS, answers)
    const visible = visibleQuestions(QUESTIONS, answers)
    expect(Object.values(p).reduce((s, x) => s + x.total, 0)).toBe(visible.length)
    expect(p.profile.answered).toBe(2)
    expect(p.cooking.total).toBe(0)
  })
})
