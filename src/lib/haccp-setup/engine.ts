// src/lib/haccp-setup/engine.ts
import type { SectionId } from '@/lib/haccp-pack/methods'
import type { AnswerValue, Answers, Question, VenueType } from './types'
import { evalCond } from './conditions'

function isAnswered(v: AnswerValue | undefined): boolean {
  return v !== undefined
}

export function visibleQuestions(questions: Question[], answers: Answers): Question[] {
  const eff: Answers = {}
  const out: Question[] = []
  for (const q of questions) {
    if (q.showIf && !evalCond(q.showIf, eff)) continue
    out.push(q)
    if (isAnswered(answers[q.id])) eff[q.id] = answers[q.id]
  }
  return out
}

export function effectiveAnswers(questions: Question[], answers: Answers): Answers {
  const eff: Answers = {}
  for (const q of visibleQuestions(questions, answers)) {
    if (isAnswered(answers[q.id])) eff[q.id] = answers[q.id]
  }
  return eff
}

export function nextQuestion(questions: Question[], answers: Answers): Question | null {
  return visibleQuestions(questions, answers).find((q) => !isAnswered(answers[q.id])) ?? null
}

export function suggestedAnswer(q: Question, answers: Answers): AnswerValue | undefined {
  const type = answers.venue_type as VenueType | undefined
  return type ? q.defaultsByType?.[type] : undefined
}

export function progressBySection(questions: Question[], answers: Answers) {
  const res = {
    cross: { answered: 0, total: 0 }, cleaning: { answered: 0, total: 0 }, chilling: { answered: 0, total: 0 },
    cooking: { answered: 0, total: 0 }, management: { answered: 0, total: 0 },
  } satisfies Record<SectionId, { answered: number; total: number }>
  for (const q of visibleQuestions(questions, answers)) {
    res[q.section].total++
    if (isAnswered(answers[q.id])) res[q.section].answered++
  }
  return res
}
