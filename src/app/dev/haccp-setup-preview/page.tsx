'use client'

import { Suspense, useMemo, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { QUESTIONS } from '@/lib/haccp-setup/content/questions'
import { buildSetupContext, checklistsFor, fillsPreview, planQuote } from '@/lib/haccp-setup/context'
import { makeRichBundle } from '@/lib/haccp-plan/fixtures'
import type { AnswerValue, Answers } from '@/lib/haccp-setup/types'
import { QuestionCard } from '@/app/(dashboard)/haccp-setup/question-card'
import { MethodContext } from '@/app/(dashboard)/haccp-setup/method-context'
import { ContextAssistant, FillsPanel } from '@/app/(dashboard)/haccp-setup/side-panels'
import { ConfirmData, DocumentsStep } from '@/app/(dashboard)/haccp-setup/data-steps'
import { StepRail, type Step } from '@/app/(dashboard)/haccp-setup/step-rail'
import { DraftReview } from '@/app/(dashboard)/haccp-setup/draft-review'
import { OwnWordsCard } from '@/app/(dashboard)/haccp-setup/own-words-card'
import { AssistantError, type DraftMethodResult } from '@/lib/haccp-setup/api'

// Dev-only visual check of the setup UI against docs/design/haccp-setup (no auth, fixture data).
const STEPS: Step[] = [
  { id: 'profile', name: 'Your kitchen', short: 'Kitchen', sub: '4 of 4', icon: 'profile', state: 'done' },
  { id: 'cross', name: '1 · Cross-contamination', short: '1 Cross-contamination', sub: '16 of 16', icon: 'cross', state: 'done' },
  { id: 'cleaning', name: '2 · Cleaning', short: '2 Cleaning', sub: '6 of 6', icon: 'cleaning', state: 'done' },
  { id: 'chilling', name: '3 · Chilling', short: '3 Chilling', sub: '1 of 9 · now', icon: 'chilling', state: 'now' },
  { id: 'cooking', name: '4 · Cooking', short: '4 Cooking', sub: '0 of 9', icon: 'cooking', state: 'todo' },
  { id: 'management', name: '5 · Management', short: '5 Management', sub: '0 of 6', icon: 'management', state: 'todo' },
  { id: 'documents', name: 'Documents', short: 'Documents', sub: '0 of 1', icon: 'documents', state: 'todo' },
  { id: 'review', name: 'Review & apply', short: 'Review', sub: 'After the last section', icon: 'review', state: 'disabled' },
]

function Preview() {
  const sp = useSearchParams()
  const view = sp.get('view') ?? 'question'
  const qid = sp.get('q') ?? (view === 'own_words' ? 'cooling_words' : 'fridge_check_method')
  const qc = useQueryClient()
  const bundle = useMemo(() => makeRichBundle(), [])
  const ctx = useMemo(() => buildSetupContext(bundle.sources, 'site-1', bundle.sources.documents), [bundle])
  const [answers, setAnswers] = useState<Answers>({ venue_type: 'restaurant', equipment: [{ kind: 'fridge', label: 'Walk-in' }, { kind: 'probe', label: 'Probe' }] })
  const onAnswer = (id: string, v: AnswerValue) => setAnswers((a) => ({ ...a, [id]: v }))
  const [pending, setPending] = useState<AnswerValue | undefined>(undefined)
  const q = QUESTIONS.find((x) => x.id === qid)!
  const live: Answers = pending !== undefined ? { ...answers, [qid]: pending } : answers

  const mockDraft = async (): Promise<DraftMethodResult> => {
    await new Promise((r) => setTimeout(r, 500))
    if (sp.get('fail')) throw new AssistantError('unavailable', 'The assistant is not available right now.')
    return {
      draft: ['Cooked food to be stored is split into shallow gastronorm trays.', 'Large batches are cooled faster in an ice bath in the sink.',
        'Food goes into the walk-in fridge as soon as it has stopped steaming, then is labelled with the date.', 'Cooked rice is kept for no more than 1 day, then thrown away.'],
      ticks: [{ id: 'cd_portions', state: 'yes' }, { id: 'cd_fridge', state: 'yes' }, { id: 'cd_90min', state: 'confirm' }],
      confirm: { id: 'cd_90min', question: 'SFBB asks for food to be cooled within 90 minutes. Is it usually under 90 minutes?' },
      sources: [{ title: 'Chilling down hot food', source: 'FSA SFBB' }],
    }
  }
  const savedOwn = sp.get('answered') ? { text: 'trays', draft: 'Cooked food is split into shallow trays.', ticks: { cd_portions: true } } : undefined

  if (view === 'review') {
    qc.setQueryData(['haccp-setup-existing', 'biz-1', 'site-1'], { templates: [], others: [], pack: null, packUpdatedAt: null })
  }

  return (
    <div className="min-h-screen bg-[#f6f7f8] p-6 font-[family-name:var(--font-geist)] text-[#16181d]">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-[18px] lg:flex-row lg:items-start">
        <StepRail steps={STEPS} onPick={() => {}} />
        {view === 'review' ? (
          <div className="min-w-0 flex-1">
            <DraftReview businessId="biz-1" siteId="site-1" sessionId="s" answers={{ ...answers, processes: ['cook_hot', 'cool_cooked', 'reheat'], cloths: 'both', fridge_check_method: 'probe' }}
              postcode="SE1 9JE" ctx={ctx} flushSaves={async () => {}} onApplied={() => {}} />
          </div>
        ) : view === 'documents' ? (
          <div className="min-w-0 flex-1"><DocumentsStep ctx={ctx} initial={undefined} onConfirm={() => {}} /></div>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-3.5">
              <MethodContext methodId={q.method} quote={planQuote(q, live, { scotland: false })} />
              {q.answer.kind === 'own_words'
                ? <OwnWordsCard key={q.id} question={q} position="Question 6 of 9 in Chilling" initial={savedOwn} venueType="restaurant"
                    taken={new Set()} onConfirm={(v) => onAnswer(q.id, v)} onDraft={setPending} draftMethod={mockDraft} />
                : q.answer.kind === 'confirm_data'
                ? <ConfirmData question={q} ctx={ctx} position="Question 2 of 6 in Management" onConfirm={(v) => onAnswer(q.id, v)} />
                : <QuestionCard key={q.id} question={q} position="Question 1 of 9 in Chilling" initial={answers[q.id]} onConfirm={(v) => onAnswer(q.id, v)} onDraft={setPending} onBack={() => {}} onAskAssistant={() => {}} />}
            </div>
            <aside className="flex w-full flex-col gap-3.5 lg:w-[300px] lg:shrink-0">
              <FillsPanel fills={fillsPreview(q, live, { scotland: false })} checklists={checklistsFor(q, live)} />
              <ContextAssistant methodId={q.method} venueType="restaurant" />
            </aside>
          </>
        )}
      </div>
    </div>
  )
}

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Suspense><Preview /></Suspense>
}
