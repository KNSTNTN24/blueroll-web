'use client'

import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { HACCP_SECTIONS } from '@/lib/constants'
import { QUESTIONS } from '@/lib/haccp-setup/content/questions'
import { nextQuestion, progressBySection } from '@/lib/haccp-setup/engine'
import { abandonSession, loadOrCreateSession, saveAnswers } from '@/lib/haccp-setup/api'
import type { AnswerValue, Answers } from '@/lib/haccp-setup/types'
import { Chat } from './chat'
import { AssistantPanel } from './assistant-panel'

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

function SetupInner({ session, businessId, siteId }: {
  session: { id: string; answers: Answers | null }; businessId: string; siteId: string
}) {
  const qc = useQueryClient()
  const { sites } = useAuth()
  const site = sites.find((s) => s.id === siteId)
  const [answers, setAnswers] = useState<Answers>(() => session.answers ?? {})
  const [previous, setPrevious] = useState<Answers>({})
  const saveChain = useRef<Promise<unknown>>(Promise.resolve())

  const persist = (next: Answers) => {
    setAnswers(next)
    saveChain.current = saveChain.current
      .then(() => saveAnswers(session.id, next))
      .catch(() => { toast.error('Could not save your answer — check your connection.') })
  }
  const onAnswer = (id: string, v: AnswerValue) => persist({ ...answers, [id]: v })
  const onClear = (id: string) => {
    if (answers[id] !== undefined) setPrevious((p) => ({ ...p, [id]: answers[id] }))
    const next = { ...answers }; delete next[id]; persist(next)
  }
  const restart = async () => {
    try {
      await abandonSession(session.id)
      qc.invalidateQueries({ queryKey: ['haccp-setup-session', businessId, siteId] })
    } catch { toast.error('Could not start over — try again.') }
  }

  const progress = progressBySection(QUESTIONS, answers)
  const finished = nextQuestion(QUESTIONS, answers) === null

  return (
    <div className="mx-auto grid max-w-[1100px] gap-6 p-6 md:grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-2">
        <h1 className="text-[18px] font-semibold">Set up my HACCP</h1>
        {site && <p className="text-[13px] text-muted-foreground">{site.name}</p>}
        <ul className="mt-2 flex flex-col gap-1">
          {HACCP_SECTIONS.map((s) => {
            const p = progress[s.id]
            return (
              <li key={s.id} className="flex justify-between text-[13px]">
                <span>{s.name}</span>
                <span className="text-muted-foreground">{p.total ? `${p.answered}/${p.total}` : '—'}</span>
              </li>
            )
          })}
        </ul>
        <Button variant="ghost" className="mt-4 self-start text-[12px]" onClick={restart}>Start over</Button>
      </aside>
      <main className="flex flex-col gap-6">
        <Chat answers={answers} previous={previous} onAnswer={onAnswer} onClear={onClear} />
        {finished && <div data-testid="draft-pending" />}
        <AssistantPanel venueType={answers.venue_type as string | undefined} />
      </main>
    </div>
  )
}
