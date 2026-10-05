// src/lib/haccp-setup/draft.ts
import type { Answers, Draft, Equipment, ExistingState } from './types'
import { QUESTIONS } from './content/questions'
import { effectiveAnswers } from './engine'
import { buildChecklistDraft } from './draft-checklists'
import { buildPackDraft } from './draft-pack'

const HOT = ['cook_hot', 'reheat', 'hot_hold', 'cool_cooked']

function notesFor(a: Answers): string[] {
  const notes: string[] = []
  const processes = Array.isArray(a.processes) ? (a.processes as string[]) : []
  const eq = Array.isArray(a.equipment) ? (a.equipment as Equipment[]) : []
  if (a.handwash_basin !== true) notes.push('SFBB requires a basin used only for handwashing. Arrange one before your next inspection.')
  if (processes.some((p) => HOT.includes(p)) && !eq.some((e) => e.kind === 'probe'))
    notes.push('You cook or hold hot food but listed no probe thermometer. You need one to check temperatures.')
  if (a.chemicals === 'mixed') notes.push('Move cleaning chemicals away from food — they must never be stored with or above food.')
  if (a.sanitiser === false) notes.push('Use a sanitiser that meets BS EN 1276 or BS EN 13697 and follow its contact time.')
  return notes
}

export function buildDraft(input: { answers: Answers; scotland: boolean; existing: ExistingState }): Draft {
  const answers = effectiveAnswers(QUESTIONS, input.answers)
  const ctx = { answers, scotland: input.scotland }
  const cl = buildChecklistDraft(ctx, input.existing.templates)
  return {
    checklists: cl.checklists,
    existing: cl.existing,
    itemAdds: cl.itemAdds,
    fields: buildPackDraft(ctx, input.existing.pack),
    notes: notesFor(answers),
  }
}
