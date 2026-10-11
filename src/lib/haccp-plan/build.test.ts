import { describe, it, expect } from 'vitest'
import { buildPlan } from './build'
import { makeBundle } from './fixtures'
import { HACCP_METHODS } from '@/lib/haccp-pack/methods'

const TOTAL = HACCP_METHODS.reduce((n, m) => n + m.fields.length, 0)

describe('buildPlan', () => {
  it('renders an empty pack as all-open without NaN', () => {
    const d = buildPlan(makeBundle())
    expect(d.total).toBe(TOTAL)
    expect(d.filled).toBe(0)
    expect(d.pct).toBe(0)
    expect(d.sections.map((s) => s.num)).toEqual([1, 2, 3, 4, 5])
    expect(d.sections.flatMap((s) => s.methods)).toHaveLength(26)
    expect(d.openPoints.length).toBe(TOTAL)
    expect(d.sections[2].methods[0]).toMatchObject({ id: 'chilled_storage', ref: '3.1', status: 'open', proof: null })
    expect(d.inspectionReady).toBe(false)
    expect(d.review).toEqual({ lastAt: null, lastBy: null, nextDue: null, overdue: true })
    expect(JSON.stringify(d)).not.toContain('NaN')
  })

  it('prefers manual over auto, and auto only when not overridden', () => {
    const b = makeBundle({
      pack: { data: { toggles: {}, texts: { sup_list: 'Manual list' }, files: {}, selects: {}, overrides: { tr_responsible: true }, sources: {} }, updatedAt: null },
      sources: { suppliers: [{ id: 's', name: 'Meadow Dairy', contact_name: null, phone: null, email: null, delivery_days: null }],
                 team: [{ full_name: 'Emma Marsh', role: 'owner' }] },
    })
    const mgmt = buildPlan(b).sections[4].methods
    expect(mgmt.find((m) => m.id === 'suppliers')!.answers[0]).toEqual({ label: 'List your food suppliers and contact details', value: 'Manual list', autoLabel: null })
    expect(mgmt.find((m) => m.id === 'training')!.answers.find((a) => a.label.startsWith('Named person'))).toBeUndefined()
  })

  it('uses auto values with a source label', () => {
    const b = makeBundle({ sources: { team: [{ full_name: 'Emma Marsh', role: 'owner' }] } })
    const tr = buildPlan(b).sections[4].methods.find((m) => m.id === 'training')!
    expect(tr.answers[0]).toEqual({ label: 'Named person responsible for food safety training', value: 'Emma Marsh (owner)', autoLabel: 'From your team' })
  })

  it('ignores auto values when auto-fill is off', () => {
    const b = makeBundle({ business: { autoFill: false }, sources: { team: [{ full_name: 'Emma', role: 'owner' }] } })
    expect(buildPlan(b).sections[4].methods.find((m) => m.id === 'training')!.answers).toEqual([])
  })

  it('computes method status from toggles', () => {
    const toggles = { st_temp: true, st_records: true, st_rotation: true, st_labelled: true, cd_90min: true }
    const d = buildPlan(makeBundle({ pack: { data: { toggles, texts: {}, files: {}, selects: {}, overrides: {}, sources: {} }, updatedAt: null } }))
    const ch = d.sections[2].methods
    expect(ch[0]).toMatchObject({ status: 'in_place', inPlace: 4, toggleTotal: 4 })
    expect(ch[0].doList[0]).toBe('Fridge temperature checked daily (0–5°C)')
    expect(ch[1]).toMatchObject({ status: 'partial', inPlace: 1, toggleTotal: 3 })
  })

  it('parses attachments and skips broken refs', () => {
    const files = { fa_matrix_file: JSON.stringify({ id: 'd1', title: 'Allergen menu.pdf' }), pc_contract_file: 'legacy-path.pdf' }
    const d = buildPlan(makeBundle({ pack: { data: { toggles: {}, texts: {}, files, selects: {}, overrides: {}, sources: {} }, updatedAt: null } }))
    expect(d.sections[0].methods.find((m) => m.id === 'food_allergies')!.attachments).toEqual([{ title: 'Allergen menu.pdf' }])
    expect(d.sections[0].methods.find((m) => m.id === 'pest_control')!.attachments).toEqual([])
  })

  it('keeps multi-line answers intact', () => {
    const long = 'Line one\nLine two\n' + 'x'.repeat(2000)
    const d = buildPlan(makeBundle({ pack: { data: { toggles: {}, texts: { cc_method: long }, files: {}, selects: {}, overrides: {}, sources: {} }, updatedAt: null } }))
    expect(d.sections[1].methods.find((m) => m.id === 'clear_clean')!.answers[0].value).toBe(long)
  })

  it('flags edits after sign-off and computes the review window', () => {
    const d = buildPlan(makeBundle({
      pack: { updatedAt: '2026-10-05T10:00:00Z' },
      signoff: { signedByName: 'Emma Marsh', signedAt: '2026-10-03T16:42:00Z' },
      proof: { lastReview: { at: '2026-10-03T16:40:00Z', by: 'Emma Marsh' } },
    }), new Date('2026-10-11T09:00:00Z'))
    expect(d.signoff).toEqual({ name: 'Emma Marsh', at: '2026-10-03T16:42:00Z', editedAfter: true })
    expect(d.review).toEqual({ lastAt: '2026-10-03T16:40:00Z', lastBy: 'Emma Marsh', nextDue: '2026-10-31', overdue: false })
  })

  it('builds the allergen matrix only from active dishes on this site', () => {
    const dish = (name: string, active: boolean, site_ids: string[]) => ({ id: name, name, category: null, active, allergen_source: 'manual' as const,
      recipe_id: null, declared_allergens: ['milk'], may_contain: ['nuts'], dietary: [], attested_by_name: null, attested_at: null, site_ids, site_categories: {} })
    const b = makeBundle({ sources: { dishes: [dish('Flat white', true, ['site-1']), dish('Old dish', false, ['site-1']), dish('Other site', true, ['site-2'])] } })
    b.site!.id = 'site-1'
    expect(buildPlan(b).dishes.map((x) => x.name)).toEqual(['Flat white'])
  })

  it('names the file and footer', () => {
    const d = buildPlan(makeBundle())
    expect(d.fileName).toBe('HACCP-Plan-st-james-s-cafe-borough-2026-10-11.pdf')
    expect(d.footerLabel).toBe('St James’s Café · Borough — HACCP Plan')
  })
})
