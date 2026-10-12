'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { QUESTIONS } from '@/lib/haccp-setup/content/questions'
import { nextQuestion, progressByTab, tabOf, visibleQuestions, suggestedAnswer, TAB_ORDER, type TabId } from '@/lib/haccp-setup/engine'
import { abandonSession, loadOrCreateSession, loadSetupContext, saveAnswers } from '@/lib/haccp-setup/api'
import { checklistsFor, fillsPreview, planQuote, type SetupContext } from '@/lib/haccp-setup/context'
import { isScottishPostcode } from '@/lib/haccp-setup/geo'
import type { AnswerValue, Answers, Question } from '@/lib/haccp-setup/types'
import { formatAnswer } from './answer-input'
import { DraftReview } from './draft-review'
import { QuestionCard } from './question-card'
import { MethodContext } from './method-context'
import { ContextAssistant, FillsPanel } from './side-panels'
import { ConfirmData, DocumentsStep } from './data-steps'
import { StepRail, type Step } from './step-rail'

export default function HaccpSetupPage() {
  const { business, sites, currentSiteId, isManager, demoMode } = useAuth()
  const [pickedSite, setPickedSite] = useState<string | null>(null)
  const siteId = currentSiteId ?? (sites.length === 1 ? sites[0].id : pickedSite)
  const businessId = business?.id

  if (!isManager) return <Notice text="Only owners and managers can set up the HACCP pack." />
  if (demoMode) return <Notice text="Not available in demo mode." />
  if (!businessId) return null
  if (!siteId) {
    return (
      <div className="mx-auto max-w-[720px] p-6">
        <h1 className="mb-4 text-[20px] font-semibold">Set up my HACCP</h1>
        <p className="mb-3 text-[14px]">Which site are you setting up?</p>
        <div className="flex flex-wrap gap-2">
          {sites.map((s) => <Button key={s.id} variant="outline" onClick={() => setPickedSite(s.id)}>{s.name}</Button>)}
        </div>
      </div>
    )
  }
  return <Setup businessId={businessId} siteId={siteId} />
}

function Notice({ text }: { text: string }) {
  return <div className="mx-auto max-w-[720px] p-6 text-[14px] text-muted-foreground">{text}</div>
}

function Setup({ businessId, siteId }: { businessId: string; siteId: string }) {
  const session = useQuery({
    queryKey: ['haccp-setup-session', businessId, siteId],
    queryFn: () => loadOrCreateSession(businessId, siteId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const context = useQuery({
    queryKey: ['haccp-setup-context', businessId, siteId],
    queryFn: () => loadSetupContext(businessId, siteId),
    staleTime: 60_000,
  })
  if (session.isLoading || context.isLoading) return <Notice text="Loading…" />
  if (session.error || !session.data) return <Notice text="Could not start the setup. Please try again." />
  if (context.error || !context.data) return <Notice text="Could not load your kitchen data. Please try again." />
  return <SetupInner key={session.data.id} session={session.data} ctx={context.data} businessId={businessId} siteId={siteId} />
}

type Tab = TabId | 'review'
const TAB_NAMES: Record<TabId, { name: string; short: string }> = {
  profile: { name: 'Your kitchen', short: 'Kitchen' },
  cross: { name: '1 · Cross-contamination', short: '1 Cross-contamination' },
  cleaning: { name: '2 · Cleaning', short: '2 Cleaning' },
  chilling: { name: '3 · Chilling', short: '3 Chilling' },
  cooking: { name: '4 · Cooking', short: '4 Cooking' },
  management: { name: '5 · Management', short: '5 Management' },
  documents: { name: 'Documents', short: 'Documents' },
}

function SetupInner({ session, ctx, businessId, siteId }: {
  session: { id: string; answers: Answers | null }; ctx: SetupContext; businessId: string; siteId: string
}) {
  const qc = useQueryClient()
  const { sites, business } = useAuth()
  const site = sites.find((s) => s.id === siteId)
  const postcode = site?.postcode ?? business?.post_code ?? null
  const scotland = isScottishPostcode(postcode)
  const flags = ctx.flags
  const [answers, setAnswers] = useState<Answers>(() => session.answers ?? {})
  const [editing, setEditing] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  // The current question's answer while it is being chosen (before Continue) — feeds the live previews.
  const [pending, setPending] = useState<{ id: string; value: AnswerValue | undefined } | null>(null)
  const saveChain = useRef<Promise<unknown>>(Promise.resolve())
  const assistantRef = useRef<HTMLInputElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  const persist = (next: Answers) => {
    setAnswers(next)
    saveChain.current = saveChain.current
      .then(() => saveAnswers(session.id, next))
      .catch(() => { toast.error('Could not save your answer — check your connection.') })
  }
  const tabFor = (a: Answers): Tab => { const n = nextQuestion(QUESTIONS, a, flags); return n ? tabOf(n) : 'review' }
  const [tab, setTab] = useState<Tab>(() => tabFor(answers))

  const visible = useMemo(() => visibleQuestions(QUESTIONS, answers, flags), [answers, flags])
  const progress = progressByTab(QUESTIONS, answers, flags)
  const finished = nextQuestion(QUESTIONS, answers, flags) === null
  const answeredCount = visible.filter((q) => answers[q.id] !== undefined).length

  const inTab = (t: Tab) => visible.filter((q) => tabOf(q) === t)
  const next = nextQuestion(QUESTIONS, answers, flags)
  const current: Question | null = editing
    ? visible.find((q) => q.id === editing) ?? null
    : tab !== 'review' && next && tabOf(next) === tab ? next : null
  const doneInTab = tab === 'review' ? [] : inTab(tab).filter((q) => answers[q.id] !== undefined && q.id !== current?.id)

  useEffect(() => { cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [current?.id])
  const previewAnswers: Answers = current && pending?.id === current.id && pending.value !== undefined
    ? { ...answers, [current.id]: pending.value } : answers

  const onAnswer = (id: string, v: AnswerValue) => {
    const nextAnswers = { ...answers, [id]: v }
    persist(nextAnswers)
    setEditing(null)
    const n = nextQuestion(QUESTIONS, nextAnswers, flags)
    const tabDone = !n || tabOf(n) !== tab
    if (tabDone && tab !== 'review') setTab(n ? tabOf(n) : 'review')
  }
  const goBack = () => {
    const order = visible.filter((q) => answers[q.id] !== undefined)
    const idx = current ? visible.findIndex((q) => q.id === current.id) : visible.length
    const prev = [...order].reverse().find((q) => visible.indexOf(q) < idx)
    if (prev) { setEditing(prev.id); setTab(tabOf(prev)) }
  }
  const restart = async () => {
    try {
      await abandonSession(session.id)
      qc.invalidateQueries({ queryKey: ['haccp-setup-session', businessId, siteId] })
    } catch { toast.error('Could not start over — try again.') }
  }

  const steps: Step[] = [
    ...TAB_ORDER.map((t): Step => {
      const p = progress[t]
      const state: Step['state'] = t === tab ? 'now' : p.total === 0 ? 'disabled' : p.answered === p.total ? 'done' : 'todo'
      return {
        id: t, name: TAB_NAMES[t].name, short: TAB_NAMES[t].short,
        icon: t === 'profile' ? 'profile' : t === 'documents' ? 'documents' : t,
        state,
        sub: p.total === 0 ? (t === 'documents' ? 'Nothing needed' : '—') : `${p.answered} of ${p.total}${t === tab ? ' · now' : ''}`,
      }
    }),
    { id: 'review', name: 'Review & apply', short: 'Review', icon: 'review', sub: finished ? 'Ready' : 'After the last section',
      state: tab === 'review' ? 'now' : finished ? 'todo' : 'disabled' },
  ]
  const pickStep = (id: string) => { setEditing(null); setTab(id as Tab) }

  const tabQs = tab === 'review' ? [] : inTab(tab)
  const position = current && tab !== 'review'
    ? `Question ${tabQs.findIndex((q) => q.id === current.id) + 1} of ${tabQs.length} in ${TAB_NAMES[tab].short.replace(/^\d /, '')}`
    : ''
  const tabComplete = tab !== 'review' && !current && tabQs.length > 0

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-[18px] px-1 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-[12.5px] text-[#5f6670]"><Link href="/haccp-pack" className="text-[#1f7a52]">HACCP Pack</Link> / Set up my HACCP</div>
          <h1 className="text-[24px] font-bold tracking-[-0.5px]">Set up my HACCP</h1>
          <div className="text-[13px] text-[#5f6670]">{site?.name} · answers fill your HACCP pack and add the right checks</div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-[12.5px] font-semibold">{answeredCount} of {visible.length} questions</span>
            <span className="h-[5px] w-[180px] overflow-hidden rounded-full bg-[#e2e4e8]"><span className="block h-[5px] bg-[#1f9d63]" style={{ width: `${visible.length ? (answeredCount / visible.length) * 100 : 0}%` }} /></span>
          </div>
          <Link href="/haccp-pack" className="inline-flex min-h-10 items-center rounded-[10px] border border-[#e2e4e8] bg-white px-3.5 text-[13px] font-semibold">Save &amp; exit</Link>
        </div>
      </div>

      <div className="flex flex-col gap-[18px] lg:flex-row lg:items-start">
        <StepRail steps={steps} onPick={pickStep} />

        {tab === 'review' ? (
          <div className="min-w-0 flex-1">
            <DraftReview businessId={businessId} siteId={siteId} sessionId={session.id} answers={answers} postcode={postcode} ctx={ctx}
              flushSaves={() => saveChain.current}
              onApplied={() => qc.invalidateQueries({ queryKey: ['haccp-setup-session', businessId, siteId] })} />
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-3.5">
              {doneInTab.length > 0 && (
                <section className="rounded-[14px] border border-[#e9eaed] bg-white">
                  <button type="button" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}
                    className="flex min-h-11 w-full items-center justify-between px-4 text-[13px] font-semibold">
                    Your answers in this section ({doneInTab.length})
                    <ChevronDown className={`h-4 w-4 transition-transform ${showDone ? 'rotate-180' : ''}`} />
                  </button>
                  {showDone && (
                    <ul className="flex flex-col border-t border-[#e9eaed]">
                      {doneInTab.map((q) => (
                        <li key={q.id} className="flex items-start justify-between gap-3 border-b border-[#f1f2f4] px-4 py-2.5 text-[13px]">
                          <span className="flex flex-col gap-0.5">
                            <span className="text-[#5f6670]">{q.text}</span>
                            <span className="font-semibold">{q.answer.kind === 'confirm_data' ? (answers[q.id] === true ? 'Confirmed' : 'Something missing') : q.answer.kind === 'documents' ? 'Documents saved' : formatAnswer(q, answers[q.id])}</span>
                          </span>
                          <button type="button" onClick={() => setEditing(q.id)} className="min-h-9 shrink-0 rounded-lg border border-[#e2e4e8] px-2.5 text-[12px] font-semibold">Edit</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {current && (
                <div ref={cardRef} className="flex flex-col gap-3.5">
                  {current.answer.kind !== 'documents' && <MethodContext methodId={current.method} quote={planQuote(current, previewAnswers, { scotland })} />}
                  {current.answer.kind === 'confirm_data' ? (
                    <ConfirmData question={current} ctx={ctx} position={position} onConfirm={(v) => onAnswer(current.id, v)} onBack={goBack} />
                  ) : current.answer.kind === 'documents' ? (
                    <DocumentsStep ctx={ctx} initial={answers.documents as Record<string, string> | undefined}
                      onConfirm={(v) => onAnswer(current.id, v)} onBack={goBack} />
                  ) : (
                    <QuestionCard key={current.id} question={current} position={position}
                      initial={answers[current.id] ?? suggestedAnswer(current, answers)}
                      onConfirm={(v) => onAnswer(current.id, v)} onBack={goBack}
                      onDraft={(v) => setPending({ id: current.id, value: v })}
                      onAskAssistant={() => assistantRef.current?.focus()} />
                  )}
                </div>
              )}

              {tabComplete && (
                <section className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#e9eaed] bg-white p-5">
                  <span className="text-[14px] font-semibold">This section is done.</span>
                  <Button onClick={() => setTab(tabFor(answers))}>{finished ? 'Review & apply' : 'Next section'} →</Button>
                </section>
              )}
              <button type="button" onClick={restart} className="self-start text-[12px] text-[#5f6670] underline">Start over</button>
            </div>

            {current && current.answer.kind !== 'documents' && (
              <aside className="flex w-full flex-col gap-3.5 lg:w-[300px] lg:shrink-0">
                <FillsPanel fills={fillsPreview(current, previewAnswers, { scotland })} checklists={checklistsFor(current, previewAnswers)} />
                <ContextAssistant ref={assistantRef} methodId={current.method} venueType={answers.venue_type as string | undefined} />
              </aside>
            )}
          </>
        )}
      </div>
    </div>
  )
}
