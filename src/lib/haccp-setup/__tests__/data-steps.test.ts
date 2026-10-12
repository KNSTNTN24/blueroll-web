// Confirm-from-Blueroll steps and the documents tab only show when they have something to show.
import { describe, it, expect } from 'vitest'
import { QUESTIONS } from '../content/questions'
import { evalCond } from '../conditions'
import { nextQuestion, visibleQuestions, progressByTab, tabOf, TAB_ORDER, effectiveAnswers } from '../engine'
import type { Answers } from '../types'

const CONFIRM = ['confirm_raw_products', 'confirm_menu_methods', 'confirm_suppliers', 'confirm_team', 'confirm_checklists']
const ALL = { raw_products: true, menu_methods: true, suppliers: true, team: true, checklists: true, documents_needed: true }

describe('data conditions', () => {
  it('evaluates against data flags', () => {
    expect(evalCond({ data: 'suppliers' }, {}, { suppliers: true })).toBe(true)
    expect(evalCond({ data: 'suppliers' }, {}, { suppliers: false })).toBe(false)
    expect(evalCond({ data: 'suppliers' }, {})).toBe(false)
  })
})

describe('confirm and documents steps', () => {
  it('exist with the right kinds', () => {
    for (const id of CONFIRM) expect(QUESTIONS.find((q) => q.id === id)?.answer.kind, id).toBe('confirm_data')
    expect(QUESTIONS.find((q) => q.id === 'documents')?.answer.kind).toBe('documents')
  })
  it('are hidden when Blueroll has nothing to confirm', () => {
    const ids = visibleQuestions(QUESTIONS, {}, {}).map((q) => q.id)
    for (const id of [...CONFIRM, 'documents']) expect(ids).not.toContain(id)
  })
  it('are shown when there is data', () => {
    const ids = visibleQuestions(QUESTIONS, {}, ALL).map((q) => q.id)
    for (const id of [...CONFIRM, 'documents']) expect(ids).toContain(id)
  })
  it('documents live in their own last tab', () => {
    expect(TAB_ORDER[TAB_ORDER.length - 1]).toBe('documents')
    expect(tabOf(QUESTIONS.find((q) => q.id === 'documents')!)).toBe('documents')
    expect(progressByTab(QUESTIONS, {}, ALL).documents).toEqual({ answered: 0, total: 1 })
  })
  it('effective answers drop hidden data steps', () => {
    expect(effectiveAnswers(QUESTIONS, { confirm_suppliers: true }, {})).not.toHaveProperty('confirm_suppliers')
    expect(effectiveAnswers(QUESTIONS, { confirm_suppliers: true }, { suppliers: true })).toHaveProperty('confirm_suppliers', true)
  })
})

describe('v1 sessions', () => {
  it('a fully answered v1 session resumes at the first new v2 question', () => {
    const v1: Answers = {
      venue_type: 'restaurant', processes: ['cook_hot', 'cool_cooked', 'reheat', 'hot_hold', 'defrost', 'rte_prep', 'deliveries_in'],
      extra_care: ['rice'], equipment: [{ kind: 'fridge', label: 'Fridge 1' }, { kind: 'freezer', label: 'Freezer' }, { kind: 'probe', label: 'Probe' }],
      separation: 'raw_below', colour_boards: true, hygiene_rules: true, illness_policy: true, uniform: 'staff_launder', changing: 'staff_room',
      allergen_matrix: true, allergen_ask: true, allergen_training: true, cloths: 'both', chemicals: 'separate_cupboard', glass_policy: true,
      pest_control: 'contractor', pest_proofing: true, handwash_basin: true, sanitiser: true, clean_as_go: true, cleaning_schedule: true,
      labels: true, fifo: true, delivery_checks: true, cooling_method: 'portions', defrost_method: ['fridge'], freeze_own: false,
      reheat_once: true, probe_calibration: true, new_dishes: true, opening_closing: true, approved_suppliers: true, induction: true, diary: true,
    }
    expect(nextQuestion(QUESTIONS, v1, {})?.id).toBe('cloth_habits')
  })
})
