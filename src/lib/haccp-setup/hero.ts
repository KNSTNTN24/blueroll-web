// The "Set up my HACCP" panel on the pack page: start, continue (with progress) or review.
import { QUESTIONS } from './content/questions'
import { nextQuestion, tabOf, visibleQuestions } from './engine'
import { SECTION_NAME } from '@/lib/haccp-plan/copy'
import type { SectionId } from '@/lib/haccp-pack/methods'
import type { Answers } from './types'

export interface SetupHero { mode: 'start' | 'continue' | 'review'; pct: number; next: string | null; left: number }

const TAB_LABEL = (t: string) => (t === 'profile' ? 'Your kitchen' : t === 'documents' ? 'Documents' : SECTION_NAME[t as SectionId])

/** Progress ignores Blueroll-data steps (they depend on the site's data and are quick confirms). */
export function setupHero(session: { status: string; answers: Answers | null } | null): SetupHero {
  if (!session) return { mode: 'start', pct: 0, next: null, left: 0 }
  if (session.status === 'applied') return { mode: 'review', pct: 100, next: null, left: 0 }
  const answers = session.answers ?? {}
  const visible = visibleQuestions(QUESTIONS, answers)
  const answered = visible.filter((q) => answers[q.id] !== undefined).length
  const n = nextQuestion(QUESTIONS, answers)
  if (!answered) return { mode: 'start', pct: 0, next: null, left: 0 }
  const tab = n ? tabOf(n) : null
  return {
    mode: 'continue',
    pct: visible.length ? Math.round((answered / visible.length) * 100) : 0,
    next: tab ? TAB_LABEL(tab) : null,
    left: tab ? visible.filter((q) => tabOf(q) === tab && answers[q.id] === undefined).length : 0,
  }
}
