// src/lib/haccp-setup/__tests__/draft-pack.test.ts
import { describe, it, expect } from 'vitest'
import { classifyField, buildPackDraft, mergePack, EMPTY_PACK } from '../draft-pack'
import { FIELD_RULES } from '../content/haccp-mapping'
import { findField } from '@/lib/haccp-pack/methods'
import type { Ctx, PackData } from '../types'

const pack = (p: Partial<PackData>): PackData => ({ ...EMPTY_PACK, ...p })

describe('classifyField', () => {
  it('empty → new', () => expect(classifyField('hw_basin', 'toggle', true, null).status).toBe('new'))
  it('override → manual', () =>
    expect(classifyField('hw_basin', 'toggle', true, pack({ toggles: { hw_basin: false }, overrides: { hw_basin: true } })).status).toBe('manual'))
  it('same value → kept', () => expect(classifyField('hw_basin', 'toggle', true, pack({ toggles: { hw_basin: true } })).status).toBe('kept'))
  it('owner text differs → kept, never overwritten', () =>
    expect(classifyField('cl_method', 'text', 'ours', pack({ texts: { cl_method: 'theirs' } }))).toEqual({ status: 'kept', current: 'theirs' }))
  it('our own earlier text → new (refresh)', () =>
    expect(classifyField('cl_method', 'text', 'ours v2', pack({ texts: { cl_method: 'ours v1' }, sources: { cl_method: 'questionnaire' } })).status).toBe('new'))
})

describe('mergePack', () => {
  it('writes only new fields and marks their source, keeps everything else', () => {
    const before = pack({ texts: { cl_method: 'theirs' }, files: { cs_file: 'x.pdf' } })
    const merged = mergePack(before, [
      { fieldId: 'hw_basin', methodId: 'handwashing', label: '', type: 'toggle', value: true, status: 'new' },
      { fieldId: 'cl_method', methodId: 'cloths', label: '', type: 'text', value: 'ours', status: 'kept', current: 'theirs' },
    ])
    expect(merged.toggles.hw_basin).toBe(true)
    expect(merged.texts.cl_method).toBe('theirs')
    expect(merged.files.cs_file).toBe('x.pdf')
    expect(merged.sources).toEqual({ hw_basin: 'questionnaire' })
  })
})

describe('FIELD_RULES', () => {
  it('target existing, non-auto fields', () => {
    for (const r of FIELD_RULES) {
      const f = findField(r.fieldId)
      expect(f, r.fieldId).toBeDefined()
      expect(f!.autoSource, r.fieldId).toBeUndefined()
      expect(f!.type, r.fieldId).not.toBe('file')
    }
  })
  it('restaurant answers produce SFBB statements', () => {
    const ctx: Ctx = { scotland: false, answers: {
      separation: 'raw_below', handwash_basin: true, cloths: 'single_use', reheat_once: true,
      processes: ['reheat', 'cook_hot'], equipment: [{ kind: 'probe', label: 'Probe' }],
    } }
    const byId = Object.fromEntries(buildPackDraft(ctx, null).map((f) => [f.fieldId, f.value]))
    expect(byId.hw_basin).toBe(true)
    expect(byId.sf_raw_separate).toBe(true)
    expect(String(byId.sf_storage)).toMatch(/bottom shelf/)
    expect(byId.cl_single_use).toBe(true)
    expect(byId.rh_once).toBe(true)
    expect(byId.ck_probe).toBe(true)
    expect(String(byId.rh_procedure)).toMatch(/75 °C/)
  })
  it('no false toggles are proposed', () => {
    const fields = buildPackDraft({ scotland: false, answers: { handwash_basin: false } }, null)
    expect(fields.find((f) => f.fieldId === 'hw_basin')).toBeUndefined()
  })
})
