// src/lib/haccp-setup/own-words.ts
// "In your own words" answers → pack values. The assistant's draft only fills what no other answer decides.
import { QUESTIONS } from './content/questions'
import type { AnswerValue, Answers, OwnWordsAnswer, PackValue, Question } from './types'

export const SKIP = 'skip'
const MAX_DRAFT = 2000

export function asOwnWords(v: AnswerValue | undefined): OwnWordsAnswer | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Partial<OwnWordsAnswer>
  return typeof o.text === 'string' && typeof o.draft === 'string' && !!o.ticks && typeof o.ticks === 'object' && !Array.isArray(o.ticks)
    ? (o as OwnWordsAnswer) : null
}

/** Pack points that another, answered question can set — those answers win over the assistant. */
export function answeredElsewhere(q: Question, answers: Answers): Set<string> {
  const out = new Set<string>()
  for (const x of QUESTIONS) {
    if (x.id === q.id || x.answer.kind === 'own_words' || answers[x.id] === undefined) continue
    for (const f of x.fills) out.add(f)
  }
  return out
}

/** The plan text and the points the owner ticked, minus points another answer decides. */
export function ownWordsValues(q: Question, answers: Answers): { fieldId: string; value: PackValue }[] {
  if (q.answer.kind !== 'own_words') return []
  const a = asOwnWords(answers[q.id])
  if (!a) return []
  const taken = answeredElsewhere(q, answers)
  const out: { fieldId: string; value: PackValue }[] = []
  const draft = a.draft.trim().slice(0, MAX_DRAFT)
  if (draft && !taken.has(q.answer.target)) out.push({ fieldId: q.answer.target, value: draft })
  for (const id of q.answer.ticks) if (a.ticks[id] === true && !taken.has(id)) out.push({ fieldId: id, value: true })
  return out
}
