import { describe, it, expect } from 'vitest'
import { buildChecklistFlow, itemsHash, CORRECTIVE_FLOW_JSON, MAX_FORM_ITEMS, FLOW_JSON_VERSION, FLOW_BUILDER_VERSION } from '../../../../supabase/functions/_shared/channels/whatsapp-flows'
import type { TemplateItem } from '../../../../supabase/functions/_shared/checklists-core/types'

const item = (id: string, item_type: TemplateItem['item_type'], o: Partial<TemplateItem> = {}): TemplateItem =>
  ({ id, name: `Item ${id}`, item_type, required: true, min_value: null, max_value: null, unit: null, sort_order: 0, ...o })

// Meta Flow JSON component limits (developers.facebook.com/docs/whatsapp/flows/reference/components)
const LABEL_MAX: Record<string, number> = { TextInput: 20, TextArea: 20, RadioButtonsGroup: 30, Footer: 35 }
function assertMetaLimits(json: Record<string, unknown>) {
  for (const screen of json.screens as any[]) {
    const all: any[] = []
    const walk = (cs: any[]) => cs.forEach((c) => { all.push(c); if (Array.isArray(c.children)) walk(c.children) })
    walk(screen.layout.children)
    expect(all.length).toBeLessThanOrEqual(50)
    expect(all.filter((c) => c.type === 'OptIn').length).toBeLessThanOrEqual(5)
    expect(all.filter((c) => c.type === 'Footer').length).toBe(1)
    // Meta rejects mixing a dynamic reference with static text inside one property
    const strings: string[] = []
    const collect = (v: unknown) => {
      if (typeof v === 'string') strings.push(v)
      else if (Array.isArray(v)) v.forEach(collect)
      else if (v && typeof v === 'object') Object.values(v).forEach(collect)
    }
    collect(screen.layout)
    for (const s of strings.filter((x) => x.includes('${'))) expect(s).toMatch(/^\$\{[^}]+\}$/)
    for (const c of all) {
      if (LABEL_MAX[c.type]) expect(c.label.length, `${c.type} label`).toBeLessThanOrEqual(LABEL_MAX[c.type])
      if (c['helper-text']) expect(c['helper-text'].length).toBeLessThanOrEqual(80)
      if (c.type === 'TextInput') expect(['text', 'number', 'email', 'password', 'passcode', 'phone']).toContain(c['input-type'])
      if (c.type === 'RadioButtonsGroup') {
        const ds = c['data-source'] as any[]
        expect(ds.length).toBeGreaterThanOrEqual(1); expect(ds.length).toBeLessThanOrEqual(20)
        ds.forEach((o) => expect(o.title.length).toBeLessThanOrEqual(30))
      }
      if (c.type === 'TextSubheading') expect(c.text.length).toBeLessThanOrEqual(80)
    }
  }
}

describe('buildChecklistFlow', () => {
  it('builds one screen with a component per supported item and a complete payload', () => {
    const r = buildChecklistFlow('Fridge temps', [
      item('a', 'temperature', { min_value: 0, max_value: 5, unit: '°C', sort_order: 1 }),
      item('b', 'yes_no', { sort_order: 2 }), item('c', 'tick', { sort_order: 3 }), item('d', 'text', { required: false, sort_order: 4 }),
      item('p', 'photo', { required: false, sort_order: 5 }),
    ])!
    expect(r.itemIds).toEqual(['a', 'b', 'c', 'd'])
    expect(r.json).toMatchSnapshot()
  })
  it('returns null for a required photo or too many items', () => {
    expect(buildChecklistFlow('X', [item('p', 'photo')])).toBeNull()
    expect(buildChecklistFlow('X', Array.from({ length: MAX_FORM_ITEMS + 1 }, (_, i) => item(String(i), 'tick')))).toBeNull()
  })
  it('stays within Meta component limits for long names and many ticks', () => {
    expect(FLOW_JSON_VERSION).toBe('7.3')
    const long = 'Walk-in fridge temperature at the back of the kitchen'
    const r = buildChecklistFlow('A very long checklist template name that overflows', [
      ...Array.from({ length: MAX_FORM_ITEMS - 3 }, (_, i) => item(`t${i}`, 'tick', { name: long, sort_order: i })),
      item('x', 'temperature', { name: long, min_value: 0, max_value: 5, sort_order: 100 }),
      item('y', 'yes_no', { name: long, sort_order: 101 }),
      item('z', 'text', { name: long, sort_order: 102 }),
    ])!
    expect(r.itemIds).toHaveLength(MAX_FORM_ITEMS)
    assertMetaLimits(r.json)
    // the full item name stays visible somewhere when the label had to be cut
    const inputs = (r.json as any).screens[0].layout.children[0].children as any[]
    expect(inputs.find((c) => c.name === `f${MAX_FORM_ITEMS - 3}`)['helper-text']).toContain(long)
  })
  it('tick submits the string "true" so answers.ts accepts it', () => {
    const r = buildChecklistFlow('X', [item('c', 'tick')])!
    const c = (r.json as any).screens[0].layout.children[0].children[0]
    expect(c.type).toBe('RadioButtonsGroup')
    expect(c['data-source'].map((o: any) => o.id)).toEqual(['true'])
  })
})

describe('itemsHash', () => {
  it('changes when an item, unit, name or builder version changes, stable otherwise', async () => {
    const a = [item('a', 'temperature', { min_value: 0, max_value: 5, unit: '°C' })]
    const h = await itemsHash('Fridge temps', a)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(await itemsHash('Fridge temps', [...a])).toBe(h)
    expect(await itemsHash('Fridge temps', [item('a', 'temperature', { min_value: 0, max_value: 8, unit: '°C' })])).not.toBe(h)
    expect(await itemsHash('Fridge temps', [item('a', 'temperature', { min_value: 0, max_value: 5, unit: '°F' })])).not.toBe(h)
    expect(await itemsHash('Freezer temps', a)).not.toBe(h)
    expect(await itemsHash('Fridge temps', a, FLOW_BUILDER_VERSION + 1)).not.toBe(h)
  })
})

describe('corrective flow', () => {
  it('declares its data inputs', () => {
    const screen = (CORRECTIVE_FLOW_JSON.screens as any[])[0]
    expect(screen.id).toBe('CORRECTIVE')
    expect(Object.keys(screen.data)).toEqual(['item_name', 'value_text'])
  })
  it('stays within Meta component limits', () => assertMetaLimits(CORRECTIVE_FLOW_JSON))
})
