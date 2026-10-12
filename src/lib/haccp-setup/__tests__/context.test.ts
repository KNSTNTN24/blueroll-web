import { describe, it, expect } from 'vitest'
import { buildSetupContext, fillsPreview, planQuote } from '../context'
import { QUESTIONS } from '../content/questions'
import type { AutoDataSources } from '@/lib/haccp-pack/auto-data'

const empty: AutoDataSources = { recipes: [], dishes: [], suppliers: [], templates: [], documents: [], team: [] }
const q = (id: string) => QUESTIONS.find((x) => x.id === id)!

describe('buildSetupContext', () => {
  it('an empty business has no data steps and needs the usual documents', () => {
    const c = buildSetupContext(empty, 's1', [])
    expect(Object.values(c.flags).every((v) => !v || v === true)).toBe(true)
    expect(c.flags).toMatchObject({ raw_products: false, menu_methods: false, suppliers: false, team: false, checklists: false, documents_needed: true })
    expect(c.neededFiles.map((f) => f.fieldId).sort()).toEqual(['cs_file', 'fa_matrix_file', 'oc_file', 'pc_contract_file', 'sup_file', 'tr_file'].sort())
    expect(c.coveredFiles.map((f) => f.fieldId)).toEqual(['dd_file'])
  })
  it('suppliers switch on the supplier step and cover the supplier list file', () => {
    const c = buildSetupContext({ ...empty, suppliers: [{ id: 's', name: 'Meadow Dairy', contact_name: null, phone: null, email: null, delivery_days: null }] }, 's1', [])
    expect(c.flags.suppliers).toBe(true)
    expect(c.neededFiles.map((f) => f.fieldId)).not.toContain('sup_file')
    expect(c.coveredFiles.find((f) => f.fieldId === 'sup_file')?.reason).toBe('Your suppliers are listed in Blueroll.')
  })
  it('team and checklists come from auto-fill', () => {
    const c = buildSetupContext({ ...empty, team: [{ full_name: 'Emma', role: 'owner' }],
      templates: [{ id: 't', name: 'Fridge & Freezer Temperatures', frequency: 'daily', sfbb_section: 'temperature' }] }, 's1', [])
    expect(c.flags.team).toBe(true)
    expect(c.flags.checklists).toBe(true)
  })
})

describe('fillsPreview', () => {
  it('lists the pack points an answer sets, with plan refs', () => {
    expect(fillsPreview(q('fridge_check_method'), { fridge_check_method: 'probe' }, { scotland: false }))
      .toEqual([{ fieldId: 'st_check_method', label: 'How fridges are checked', ref: '3.1', value: 'Digital thermometer' }])
  })
  it('lists every field the question can fill, unset ones with value null', () => {
    const p = fillsPreview(q('cloth_habits'), { cloth_habits: ['colour_coded'] }, { scotland: false })
    expect(p.map((x) => [x.fieldId, x.value])).toEqual([['cl_colour_coded', true], ['cl_stored', null]])
  })
})

describe('planQuote', () => {
  it('uses the text the answer writes into the plan', () => {
    expect(planQuote(q('cloths'), { cloths: 'both' }, { scotland: false })).toBe('We use single-use cloths for raw food areas and reusable cloths washed at 90 °C for other cleaning.')
  })
  it('falls back to the ticked points', () => {
    expect(planQuote(q('handwash_basin'), { handwash_basin: true }, { scotland: false }))
      .toBe('Dedicated handwash basin available · Antibacterial soap provided · Disposable paper towels or air dryer available')
  })
  it('is null before an answer', () => {
    expect(planQuote(q('cloths'), {}, { scotland: false })).toBeNull()
  })
})

describe('reviewComposition', () => {
  it('splits every asked field into answers, Blueroll and open', async () => {
    const { reviewComposition } = await import('../context')
    const ctx = buildSetupContext({ ...empty, team: [{ full_name: 'Emma', role: 'owner' }] }, 's1', [])
    const pack = { toggles: { hw_basin: true }, texts: {}, files: {}, selects: {}, overrides: {}, sources: {} }
    const draft = [{ fieldId: 'hw_soap', methodId: 'handwashing', label: '', type: 'toggle' as const, value: true, status: 'new' as const }]
    const r = reviewComposition(ctx, pack, draft)
    const cleaning = r.sections.find((s) => s.id === 'cleaning')!
    expect(cleaning.answers).toBe(2)
    const mgmt = r.sections.find((s) => s.id === 'management')!
    expect(mgmt.blueroll).toBe(1) // tr_responsible from the team
    const total = r.sections.reduce((n, s) => n + s.total, 0)
    expect(r.sections.reduce((n, s) => n + s.answers + s.blueroll + s.open, 0)).toBe(total)
    expect(r.filled).toBe(3)
    expect(r.open[0]).toMatchObject({ ref: '1.1' })
  })
})
