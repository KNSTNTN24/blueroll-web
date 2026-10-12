// src/lib/haccp-setup/engine.ts
import type { SectionId } from '@/lib/haccp-pack/methods'
import type { AnswerValue, Answers, DataFlags, Question, VenueType } from './types'
import { evalCond } from './conditions'
import { QUESTIONS } from './content/questions'

function isAnswered(v: AnswerValue | undefined): boolean {
  return v !== undefined
}

export function visibleQuestions(questions: Question[], answers: Answers, data: DataFlags = {}): Question[] {
  const eff: Answers = {}
  const out: Question[] = []
  for (const q of questions) {
    if (q.showIf && !evalCond(q.showIf, eff, data)) continue
    out.push(q)
    if (isAnswered(answers[q.id])) eff[q.id] = answers[q.id]
  }
  return out
}

export function effectiveAnswers(questions: Question[], answers: Answers, data: DataFlags = {}): Answers {
  const eff: Answers = {}
  for (const q of visibleQuestions(questions, answers, data)) {
    if (isAnswered(answers[q.id])) eff[q.id] = answers[q.id]
  }
  return eff
}

export function nextQuestion(questions: Question[], answers: Answers, data: DataFlags = {}): Question | null {
  return visibleQuestions(questions, answers, data).find((q) => !isAnswered(answers[q.id])) ?? null
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

// ── Tabs: the questionnaire is shown in the HACCP pack's sections, after a short "Profile" tab ──

export type TabId = 'profile' | SectionId | 'documents'
export const TAB_ORDER: TabId[] = ['profile', 'cross', 'cleaning', 'chilling', 'cooking', 'management', 'documents']
/** Questions that describe the business as a whole rather than one SFBB section. */
export const PROFILE_QUESTION_IDS = new Set(['venue_type', 'processes', 'extra_care', 'equipment'])

export function tabOf(q: Question): TabId {
  if (q.answer.kind === 'documents') return 'documents'
  return PROFILE_QUESTION_IDS.has(q.id) ? 'profile' : q.section
}

/** The question to show in a tab: its first visible unanswered question (null when the tab is done). */
export function currentQuestionIn(tab: TabId, answers: Answers, data: DataFlags = {}): Question | null {
  return visibleQuestions(QUESTIONS, answers, data).find((q) => tabOf(q) === tab && !isAnswered(answers[q.id])) ?? null
}

/** After an answer: move on only when the user was working at the frontier (or everything is answered). Editing an earlier tab stays put. */
export function tabAfterAnswer(tab: TabId, before: Answers, after: Answers, data: DataFlags = {}): TabId | 'review' {
  const frontier = (a: Answers) => { const n = nextQuestion(QUESTIONS, a, data); return n ? tabOf(n) : 'review' }
  const next = nextQuestion(QUESTIONS, after, data)
  const nextTab = next ? tabOf(next) : 'review'
  const tabDone = !next || tabOf(next) !== tab
  return tabDone && (tab === frontier(before) || nextTab === 'review') ? nextTab : tab
}

export function progressByTab(questions: Question[], answers: Answers, data: DataFlags = {}): Record<TabId, { answered: number; total: number }> {
  const res = Object.fromEntries(TAB_ORDER.map((t) => [t, { answered: 0, total: 0 }])) as Record<TabId, { answered: number; total: number }>
  for (const q of visibleQuestions(questions, answers, data)) {
    const t = tabOf(q)
    res[t].total++
    if (isAnswered(answers[q.id])) res[t].answered++
  }
  return res
}
