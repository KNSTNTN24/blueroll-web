'use client'

import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { QUESTIONS } from '@/lib/haccp-setup/content/questions'
import { nextQuestion, progressByTab, tabOf, TAB_ORDER, type TabId } from '@/lib/haccp-setup/engine'
import { cn } from '@/lib/utils'
import { abandonSession, loadOrCreateSession, saveAnswers } from '@/lib/haccp-setup/api'
import type { AnswerValue, Answers } from '@/lib/haccp-setup/types'
import { Chat } from './chat'
import { AssistantPanel } from './assistant-panel'
import { DraftReview } from './draft-review'

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
  if (session.isLoading) return <Notice text="Loading…" />
  if (session.error || !session.data) return <Notice text="Could not start the setup. Please try again." />
  return <SetupInner key={session.data.id} session={session.data} businessId={businessId} siteId={siteId} />
}

type Tab = TabId | 'review'
const TAB_NAMES: Record<TabId, string> = {
  profile: 'Profile', cross: 'Cross-Contamination', cleaning: 'Cleaning', chilling: 'Chilling', cooking: 'Cooking', management: 'Management',
}

function SetupInner({ session, businessId, siteId }: {
  session: { id: string; answers: Answers | null }; businessId: string; siteId: string
}) {
  const qc = useQueryClient()
  const { sites, business } = useAuth()
  const site = sites.find((s) => s.id === siteId)
  const [answers, setAnswers] = useState<Answers>(() => session.answers ?? {})
  const saveChain = useRef<Promise<unknown>>(Promise.resolve())

  const persist = (next: Answers) => {
    setAnswers(next)
    saveChain.current = saveChain.current
      .then(() => saveAnswers(session.id, next))
      .catch(() => { toast.error('Could not save your answer — check your connection.') })
  }
  // Open on the tab holding the next unanswered question (or the review once everything is answered).
  const tabFor = (a: Answers): Tab => { const n = nextQuestion(QUESTIONS, a); return n ? tabOf(n) : 'review' }
  const [tab, setTab] = useState<Tab>(() => tabFor(answers))
  const onAnswer = (id: string, v: AnswerValue) => {
    const next = { ...answers, [id]: v }
    persist(next)
    // Finishing the open tab moves on to the tab of the next question; editing an earlier tab stays put.
    const nextTab = tabFor(next)
    const tabDone = !nextQuestion(QUESTIONS, next) || tabOf(nextQuestion(QUESTIONS, next)!) !== tab
    if (tabDone && (tab === tabFor(answers) || nextTab === 'review')) setTab(nextTab)
  }
  const restart = async () => {
    try {
      await abandonSession(session.id)
      qc.invalidateQueries({ queryKey: ['haccp-setup-session', businessId, siteId] })
    } catch { toast.error('Could not start over — try again.') }
  }

  const progress = progressByTab(QUESTIONS, answers)
  const finished = nextQuestion(QUESTIONS, answers) === null

  const tabs: { id: Tab; name: string; done: number; total: number; disabled: boolean }[] = [
    ...TAB_ORDER.map((t) => ({
      id: t as Tab, name: TAB_NAMES[t], done: progress[t].answered, total: progress[t].total, disabled: progress[t].total === 0,
    })),
    { id: 'review', name: 'Review & apply', done: finished ? 1 : 0, total: 1, disabled: !finished },
  ]

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Set up my HACCP</h1>
          {site && <p className="text-[13px] text-muted-foreground">{site.name}</p>}
        </div>
        <Button variant="ghost" className="text-[12px]" onClick={restart}>Start over</Button>
      </div>

      <div className="flex gap-0.5 overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
        {tabs.map((t) => {
          const active = t.id === tab
          const pct = t.total ? Math.round((t.done / t.total) * 100) : 0
          return (
            <button key={t.id} disabled={t.disabled} onClick={() => setTab(t.id)}
              className={cn(
                'flex min-w-[118px] flex-1 flex-col items-start gap-1 rounded-lg px-3.5 py-2.5 text-left transition-colors',
                active ? 'bg-primary' : 'hover:bg-muted/60',
                t.disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
              )}>
              <span className={cn('text-[12.5px] leading-tight tracking-tight', active ? 'font-semibold text-white' : 'font-medium text-zinc-500')}>
                {t.name}
              </span>
              <span className={cn('inline-flex items-center gap-2 font-mono text-[10.5px] leading-none tabular-nums', active ? 'text-emerald-50' : 'text-zinc-500')}>
                <span className={cn('relative block h-[3px] w-9 overflow-hidden rounded-full', active ? 'bg-emerald-800/40' : 'bg-zinc-300')}>
                  <span className={cn('absolute inset-y-0 left-0 rounded-full', active ? 'bg-white' : 'bg-primary')} style={{ width: `${pct}%` }} />
                </span>
                {t.id === 'review' ? (finished ? 'ready' : '—') : t.total ? `${t.done} / ${t.total}` : '—'}
              </span>
            </button>
          )
        })}
      </div>

      {tab === 'review' ? (
        <DraftReview businessId={businessId} siteId={siteId} sessionId={session.id} answers={answers}
          postcode={site?.postcode ?? business?.post_code ?? null}
          flushSaves={() => saveChain.current}
          onApplied={() => qc.invalidateQueries({ queryKey: ['haccp-setup-session', businessId, siteId] })} />
      ) : (
        <>
          <Chat tab={tab} answers={answers} onAnswer={onAnswer} />
          {progress[tab].total > 0 && progress[tab].answered === progress[tab].total && (
            <Button className="self-start" onClick={() => setTab(tabFor(answers))}>
              {finished ? 'Review & apply' : 'Next section'} →
            </Button>
          )}
        </>
      )}
      <AssistantPanel venueType={answers.venue_type as string | undefined} />
    </div>
  )
}
