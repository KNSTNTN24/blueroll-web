// src/lib/haccp-setup/__tests__/draft-method.test.ts
import { describe, it, expect } from 'vitest'
import {
  DRAFT_METHODS, MAX_OWN_WORDS, buildDraftMethodRequest, isDraftMethodBody, numbersIn, parseDraftMethodResponse,
} from '../../../../supabase/functions/_shared/draft-method'
import type { KnowledgeChunk } from '../../../../supabase/functions/_shared/knowledge'
import { findField } from '@/lib/haccp-pack/methods'
import type { DraftMethodResult as ClientResult } from '@/lib/haccp-setup/api'
import type { DraftMethodResult as ServerResult } from '../../../../supabase/functions/_shared/draft-method'

const tool = (input: unknown) => ({ content: [{ type: 'tool_use', name: 'draft_method', input }] })
const spec = DRAFT_METHODS.chilling_down
const OWN = 'stews and rice go in flat gastro trays, ice bath in the sink for big batches, walk-in once it stops steaming. rice we bin after one day'
const CHUNK = { id: 'sfbb-chill-1', title: 'Chilling down hot food', source: 'FSA SFBB', text: 'Cool within 90 minutes.' } as KnowledgeChunk

describe('DRAFT_METHODS', () => {
  it('targets a text field and ticks toggle fields of its own method, with the pack labels', () => {
    expect(Object.keys(DRAFT_METHODS).sort()).toEqual(['chilling_down', 'defrosting', 'freezing', 'pest_control', 'temperature_probes', 'training'])
    for (const s of Object.values(DRAFT_METHODS)) {
      const t = findField(s.target)!
      expect(t.type, s.target).toBe('text')
      expect(t.methodId, s.target).toBe(s.method)
      for (const k of s.ticks) {
        const f = findField(k.id)!
        expect(f.type, k.id).toBe('toggle')
        expect(f.methodId, k.id).toBe(s.method)
        expect(k.label, k.id).toBe(f.label)
      }
    }
  })
})

describe('isDraftMethodBody', () => {
  it('accepts a known method with text', () => {
    expect(isDraftMethodBody({ action: 'draft_method', method: 'chilling_down', text: 'trays' })).toBe(true)
  })
  it('rejects unknown or inherited methods and empty text', () => {
    expect(isDraftMethodBody({ action: 'draft_method', method: 'cooking_safely', text: 'x' })).toBe(false)
    expect(isDraftMethodBody({ action: 'draft_method', method: '__proto__', text: 'x' })).toBe(false)
    expect(isDraftMethodBody({ action: 'draft_method', method: 'chilling_down', text: '   ' })).toBe(false)
    expect(isDraftMethodBody(null)).toBe(false)
  })
})

describe('numbersIn', () => {
  it('reads digits, decimals and number words', () => {
    expect([...numbersIn('cool within 90 minutes at 1,5 kg, bin after one day, ninety')].sort()).toEqual(['1', '1.5', '90'])
  })
  it('ignores "one" in a draft sentence ("no one")', () => {
    expect([...numbersIn('No one handles food when ill.', true)]).toEqual([])
  })
})

describe('buildDraftMethodRequest', () => {
  it('limits ticks to the method, wraps cleaned owner text and cuts it', () => {
    const req = buildDraftMethodRequest(spec, '<b>trays</b> ' + 'x'.repeat(3000), [CHUNK], 'restaurant')
    const schema = req.tools[0].input_schema.properties
    expect(schema.ticks.items.properties.id.enum).toEqual(['cd_portions', 'cd_fridge', 'cd_90min'])
    const content = req.messages[0].content as string
    expect(content).toContain('<<<\nbtrays/b')
    expect(content.split('<<<\n')[1].split('\n>>>')[0].length).toBe(MAX_OWN_WORDS)
    expect(content).toContain('Business type: restaurant')
    expect(content).toContain('[sfbb-chill-1]')
    expect(req.system).toContain('cooling cooked food')
  })
})

describe('parseDraftMethodResponse', () => {
  it('keeps grounded sentences and known ticks, and adds the confirm point', () => {
    const r = parseDraftMethodResponse(tool({
      draft: ['Cooked food is split into shallow trays.', 'Cooked rice is thrown away after 1 day.'],
      ticks: [{ id: 'cd_portions', state: 'yes' }, { id: 'cd_fridge', state: 'yes' }],
      confirm: { id: 'cd_90min', question: 'Is food usually cooled within 90 minutes?' },
      source_ids: ['sfbb-chill-1'],
    }), spec, OWN, [CHUNK])
    expect(r.draft).toEqual(['Cooked food is split into shallow trays.', 'Cooked rice is thrown away after 1 day.'])
    expect(r.ticks).toEqual([{ id: 'cd_portions', state: 'yes' }, { id: 'cd_fridge', state: 'yes' }, { id: 'cd_90min', state: 'confirm' }])
    expect(r.confirm).toEqual({ id: 'cd_90min', question: 'Is food usually cooled within 90 minutes?' })
    expect(r.sources).toEqual([{ title: 'Chilling down hot food', source: 'FSA SFBB' }])
  })
  it('drops a sentence with a number the owner never wrote', () => {
    const r = parseDraftMethodResponse(tool({
      draft: ['Food is cooled within 90 minutes.', 'Big batches go in an ice bath.'], ticks: [], source_ids: [],
    }), spec, OWN, [])
    expect(r.draft).toEqual(['Big batches go in an ice bath.'])
  })
  it('drops unknown tick ids, bad states and duplicates', () => {
    const r = parseDraftMethodResponse(tool({
      draft: ['Big batches go in an ice bath.'],
      ticks: [{ id: 'ck_75c', state: 'yes' }, { id: 'cd_fridge', state: 'maybe' }, { id: 'cd_portions', state: 'yes' }, { id: 'cd_portions', state: 'no' }],
      confirm: { id: 'ck_75c', question: 'Cook to 75?' }, source_ids: [],
    }), spec, OWN, [])
    expect(r.ticks).toEqual([{ id: 'cd_portions', state: 'yes' }])
    expect(r.confirm).toBeNull()
  })
  it('caps sentences, sentence length and question length', () => {
    const long = 'a'.repeat(400)
    const r = parseDraftMethodResponse(tool({
      draft: Array.from({ length: 12 }, () => long), ticks: [], confirm: { id: 'cd_fridge', question: 'q'.repeat(300) }, source_ids: [],
    }), spec, OWN, [])
    expect(r.draft).toHaveLength(8)
    expect(r.draft[0]).toHaveLength(300)
    expect(r.confirm!.question).toHaveLength(200)
  })
  it('returns an empty result for an empty draft or a malformed response', () => {
    const empty = { draft: [], ticks: [], confirm: null, sources: [], dropped: 0 }
    expect(parseDraftMethodResponse(tool({ draft: [], ticks: [{ id: 'cd_fridge', state: 'yes' }], source_ids: [] }), spec, OWN, [])).toEqual(empty)
    expect(parseDraftMethodResponse({ content: 'nope' }, spec, OWN, [])).toEqual(empty)
  })
})

describe('client type', () => {
  it('client and server result types match', () => {
    const s: ServerResult = { draft: [], ticks: [], confirm: null, sources: [], dropped: 0 }
    const c: ClientResult = s
    const back: ServerResult = c
    expect(back).toBe(s)
  })
})

describe('number guard — units and counts', () => {
  const draftOf = (own: string, sentences: string[]) =>
    parseDraftMethodResponse(tool({ draft: sentences, ticks: [], source_ids: [] }), spec, own, [])
  it('a number the owner used for something else does not ground a time ("level 2" ≠ "2 hours")', () => {
    const r = draftOf('all chefs have level 2 food hygiene, rice cooled in trays', ['All chefs have Level 2 food hygiene.', 'Food is cooled within 2 hours.'])
    expect(r.draft).toEqual(['All chefs have Level 2 food hygiene.'])
  })
  it('a time the owner wrote, in words or digits, grounds the same time', () => {
    expect(draftOf('we cool it for 2 hours', ['Food is cooled within 2 hours.']).draft).toHaveLength(1)
    expect(draftOf('rice we bin after one day', ['Cooked rice is thrown away after 1 day.']).draft).toHaveLength(1)
    expect(draftOf('freezer is at minus eighteen degrees', ['The freezer runs at -18°C.']).draft).toHaveLength(1)
  })
  it('reads more number words', () => {
    expect([...numbersIn('eighty fifty seventeen')].sort()).toEqual(['17', '50', '80'])
  })
  it('counts the sentences it dropped', () => {
    const r = draftOf('cool for an hour and a half then fridge', ['Food is cooled for 90 minutes.', 'Then it goes in the fridge.'])
    expect(r.draft).toEqual(['Then it goes in the fridge.'])
    expect(r.dropped).toBe(1)
    const all = draftOf('cool for an hour and a half', ['Food is cooled for 90 minutes.'])
    expect(all.draft).toEqual([])
    expect(all.dropped).toBe(1)
  })
})
