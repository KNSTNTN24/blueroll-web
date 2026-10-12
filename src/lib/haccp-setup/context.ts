// What the questionnaire knows about the site before asking anything: data it can
// confirm instead of asking (menu, recipes, suppliers, team, checklists), the
// documents it still needs, and previews of what each answer puts in the plan.
import { HACCP_METHODS, findField, type SectionId } from '@/lib/haccp-pack/methods'
import { computeAutoData, type AutoDataSources } from '@/lib/haccp-pack/auto-data'
import { COVERED_FILE_REASON, packFields, scopeFrom, type PackScope } from '@/lib/haccp-pack/scope'
import { SECTION_NAME, SECTION_ORDER, methodRef } from '@/lib/haccp-plan/copy'
import { mergePack } from './draft-pack'
import { FIELD_RULES } from './content/haccp-mapping'
import { CHECKLIST_LIBRARY } from './content/checklists'
import { condRefs, evalCond } from './conditions'
import { ownWordsValues } from './own-words'
import type { Answers, DataFlags, DraftField, PackData, PackValue, Question } from './types'

export interface SetupContext {
  sources: AutoDataSources
  auto: Record<string, string>
  scope: PackScope
  flags: DataFlags
  neededFiles: { fieldId: string; methodId: string; label: string }[]
  coveredFiles: { fieldId: string; label: string; reason: string }[]
  documents: { id: string; title: string; category: string | null }[]
}

const MENU_METHOD_FIELDS = ['ck_dishes', 'rh_items', 'hh_items', 'mc_items', 'cd_method', 'fz_method', 'df_method', 'ec_items', 'rte_items']

export function buildSetupContext(
  sources: AutoDataSources, siteId: string, documents: SetupContext['documents'], opts: { autoFill?: boolean } = {},
): SetupContext {
  // With auto-fill off the pack and the plan ignore Blueroll data, so setup neither counts nor asks to confirm it.
  const autoFill = opts.autoFill !== false
  const auto = autoFill ? computeAutoData(sources) : {}
  const scope = scopeFrom({ dishes: sources.dishes, siteId, templates: sources.templates, suppliers: sources.suppliers })
  const neededFiles: SetupContext['neededFiles'] = []
  const coveredFiles: SetupContext['coveredFiles'] = []
  for (const m of HACCP_METHODS) {
    const asked = new Set(packFields(m, scope).map((f) => f.id))
    for (const f of m.fields) {
      if (f.type !== 'file') continue
      if (asked.has(f.id)) neededFiles.push({ fieldId: f.id, methodId: m.id, label: f.label })
      else {
        const reason = COVERED_FILE_REASON[f.id]?.(scope)
        if (reason) coveredFiles.push({ fieldId: f.id, label: f.label, reason })
      }
    }
  }
  const flags: DataFlags = {
    raw_products: !!auto.sf_raw_products,
    menu_methods: MENU_METHOD_FIELDS.some((k) => !!auto[k]),
    suppliers: autoFill && sources.suppliers.length > 0,
    team: !!auto.tr_responsible,
    checklists: !!(auto.st_method || auto.tp_method),
    documents_needed: neededFiles.length > 0,
    autoFilled: Object.keys(auto).filter((k) => !!auto[k]),
  }
  return { sources, auto, scope, flags, neededFiles, coveredFiles, documents }
}

export interface FillPreview { fieldId: string; label: string; ref: string; value: PackValue | null }

/** Every pack field the question can fill, with the value the current answers give it (null = not set). */
export function fillsPreview(q: Question, answers: Answers, ctx: { scotland: boolean }): FillPreview[] {
  const docs = (answers.documents && typeof answers.documents === 'object' && !Array.isArray(answers.documents))
    ? answers.documents as Record<string, string> : {}
  const own = new Map(ownWordsValues(q, answers).map((x) => [x.fieldId, x.value]))
  return q.fills.map((fieldId) => {
    const f = findField(fieldId)!
    let value: PackValue | null = null
    if (f.type === 'file') value = docs[fieldId] ?? null
    else {
      for (const r of FIELD_RULES) {
        if (r.fieldId !== fieldId) continue
        const v = r.value({ answers, scotland: ctx.scotland })
        if (v !== undefined && v !== false && v !== '') { value = v; break }
      }
      if (value === null && own.has(fieldId)) value = own.get(fieldId)!
    }
    return { fieldId, label: f.label, ref: methodRef(f.methodId), value }
  })
}

/** One line of what this answer puts in the plan: its text, else the ticked points, else "label: choice". */
export function planQuote(q: Question, answers: Answers, ctx: { scotland: boolean }): string | null {
  const set = fillsPreview(q, answers, ctx).filter((p) => p.value !== null)
  if (!set.length) return null
  const type = (id: string) => findField(id)!.type
  const text = set.find((p) => type(p.fieldId) === 'text')
  if (text) return String(text.value)
  const ticks = set.filter((p) => type(p.fieldId) === 'toggle')
  if (ticks.length) return ticks.map((p) => p.label).join(' · ')
  const sel = set.find((p) => type(p.fieldId) === 'select')
  return sel ? `${sel.label}: ${sel.value}` : null
}

// Questions that don't appear in a checklist's include rule but decide how it is used.
const RELATED_CHECKLISTS: Record<string, string[]> = {
  fridge_check_method: ['fridge_temps'], fridge_checks_recorded: ['fridge_temps'], freezer_minus18: ['fridge_temps'],
  opening_closing: ['opening_checks', 'closing_checks'], cleaning_schedule: ['weekly_deep_clean'], two_stage_clean: ['weekly_deep_clean'],
  allergen_matrix: ['allergen_check'], probe_clean: ['probe_calibration'], cook_checks: ['cooking_temps'],
  hot_hold_rules: ['hot_holding'], reheat_75: ['reheating'], cool_90: ['cooling'], no_refreeze: ['defrosting'],
}

/** Library checklists this question's answer adds to the draft (by the current answers). */
export function checklistsFor(q: Question, answers: Answers): string[] {
  const related = new Set(RELATED_CHECKLISTS[q.id] ?? [])
  return CHECKLIST_LIBRARY
    .filter((c) => {
      const refs = condRefs(c.includeIf)
      const linked = refs.includes(q.id) || related.has(c.key) || (q.id === 'equipment' && JSON.stringify(c.includeIf).includes('"equipment"'))
      return linked && !('always' in c.includeIf && !related.has(c.key)) && evalCond(c.includeIf, answers)
    })
    .map((c) => c.name)
}

export interface ReviewSection { id: SectionId; name: string; answers: number; blueroll: number; open: number; total: number }

/** Where every asked pack field stands after applying the draft: from answers (or already in the pack), from Blueroll data, or open. */
export function reviewComposition(ctx: SetupContext, pack: PackData | null, draft: DraftField[]): {
  sections: ReviewSection[]; filled: number; total: number; open: { ref: string; label: string }[]
} {
  const merged = mergePack(pack, draft)
  const isRef = (raw: string | undefined) => { try { return !!raw && !!JSON.parse(raw)?.title } catch { return false } }
  const inPack = (id: string, type: string) =>
    type === 'toggle' ? merged.toggles[id] === true
      : type === 'file' ? isRef(merged.files[id])
        : !!(type === 'text' ? merged.texts[id] : merged.selects[id])?.trim()
  const sections: ReviewSection[] = []
  const open: { ref: string; label: string }[] = []
  let filled = 0, total = 0
  for (const sid of SECTION_ORDER) {
    const s: ReviewSection = { id: sid, name: SECTION_NAME[sid], answers: 0, blueroll: 0, open: 0, total: 0 }
    for (const m of HACCP_METHODS.filter((x) => x.section === sid)) {
      for (const f of packFields(m, ctx.scope)) {
        s.total++
        if (inPack(f.id, f.type)) s.answers++
        else if (f.autoSource && ctx.auto[f.id] && !merged.overrides[f.id]) s.blueroll++
        else { s.open++; open.push({ ref: methodRef(m.id), label: f.label }) }
      }
    }
    filled += s.answers + s.blueroll
    total += s.total
    sections.push(s)
  }
  return { sections, filled, total, open }
}
