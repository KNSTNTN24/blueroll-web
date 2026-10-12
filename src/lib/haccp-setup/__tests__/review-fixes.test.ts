// Regressions from the final review of setup v2.
import { describe, it, expect } from 'vitest'
import { buildDraft } from '../draft'
import { buildSetupContext } from '../context'
import { currentQuestionIn, tabAfterAnswer } from '../engine'
import { QUESTIONS } from '../content/questions'
import type { AutoDataSources } from '@/lib/haccp-pack/auto-data'
import type { Answers } from '../types'

const existing = { templates: [], others: [], pack: null, packUpdatedAt: null }
const ref = JSON.stringify({ id: 'd1', title: 'Contract.pdf' })

describe('documents reach the pack', () => {
  it('buildDraft keeps a documents answer when documents are needed', () => {
    const d = buildDraft({ answers: { documents: { pc_contract_file: ref } }, scotland: false, existing, flags: { documents_needed: true } })
    expect(d.fields.find((f) => f.fieldId === 'pc_contract_file')).toMatchObject({ type: 'file', value: ref, status: 'new' })
  })
})

describe('auto-fill switched off', () => {
  const sources: AutoDataSources = { recipes: [], dishes: [], suppliers: [{ id: 's', name: 'Meadow Dairy', contact_name: null, phone: null, email: null, delivery_days: null }],
    templates: [], documents: [], team: [{ full_name: 'Emma', role: 'owner' }] }
  it('uses no Blueroll data and asks no confirm questions', () => {
    const c = buildSetupContext(sources, 's1', [], { autoFill: false })
    expect(c.auto).toEqual({})
    expect(c.flags).toMatchObject({ suppliers: false, team: false, raw_products: false, menu_methods: false, checklists: false })
  })
  it('still knows the supplier list document is covered (scope is about records, not auto-fill)', () => {
    expect(buildSetupContext(sources, 's1', [], { autoFill: false }).neededFiles.map((f) => f.fieldId)).not.toContain('sup_file')
  })
})

describe('step navigation', () => {
  it('a section picked ahead of the next question opens its first unanswered question', () => {
    const q = currentQuestionIn('management', {}, {})
    expect(q?.id).toBe('opening_closing')
  })
  it('is null only when the section is really done', () => {
    const answers: Answers = Object.fromEntries(QUESTIONS.filter((x) => x.section === 'cleaning').map((x) => [x.id, true]))
    expect(currentQuestionIn('cleaning', answers, {})).toBeNull()
  })
  it('editing an earlier section keeps the user there', () => {
    const before: Answers = { venue_type: 'coffee_shop' }
    const after: Answers = { ...before, handwash_basin: true }
    // user is on cleaning (not the frontier tab, which is profile) → stays
    expect(tabAfterAnswer('cleaning', before, after, {})).toBe('cleaning')
  })
  it('finishing the frontier section moves on', () => {
    const before: Answers = { venue_type: 'coffee_shop', processes: ['rte_prep'], extra_care: [] }
    const after: Answers = { ...before, equipment: [] }
    expect(tabAfterAnswer('profile', before, after, {})).toBe('cross')
  })
})
