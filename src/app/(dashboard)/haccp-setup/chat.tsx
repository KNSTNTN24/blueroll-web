'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { AnswerValue, Answers, Question } from '@/lib/haccp-setup/types'
import { QUESTIONS } from '@/lib/haccp-setup/content/questions'
import { nextQuestion, suggestedAnswer, visibleQuestions } from '@/lib/haccp-setup/engine'
import { AnswerInput, formatAnswer } from './answer-input'

export function Chat({ answers, onAnswer }: {
  answers: Answers; onAnswer: (id: string, v: AnswerValue) => void
}) {
  // An answered question is edited in place, where the owner clicked "Edit".
  const [editing, setEditing] = useState<string | null>(null)
  const current = nextQuestion(QUESTIONS, answers)
  const done = visibleQuestions(QUESTIONS, answers).filter((q) => answers[q.id] !== undefined)

  return (
    <div className="flex flex-col gap-4">
      {done.map((q) => editing === q.id ? (
        <QuestionCard key={q.id} q={q} initial={answers[q.id]}
          onConfirm={(v) => { onAnswer(q.id, v); setEditing(null) }}
          onCancel={() => setEditing(null)} />
      ) : (
        <div key={q.id} className="flex flex-col gap-1">
          <p className="max-w-[560px] rounded-xl bg-muted px-3 py-2 text-[14px]">{q.text}</p>
          <div className="flex items-center justify-end gap-2">
            <p className="max-w-[560px] rounded-xl bg-brand/15 px-3 py-2 text-[14px]">{formatAnswer(q, answers[q.id])}</p>
            <button className="text-[12px] text-muted-foreground underline" onClick={() => setEditing(q.id)}>Edit</button>
          </div>
        </div>
      ))}
      {current && !editing && (
        <QuestionCard key={current.id} q={current} initial={suggestedAnswer(current, answers)}
          onConfirm={(v) => onAnswer(current.id, v)} />
      )}
    </div>
  )
}

function QuestionCard({ q, initial, onConfirm, onCancel }: {
  q: Question; initial: AnswerValue | undefined; onConfirm: (v: AnswerValue) => void; onCancel?: () => void
}) {
  const [why, setWhy] = useState(false)
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4">
      <p className="text-[15px] font-medium">{q.text}</p>
      <button className="flex items-center gap-1 self-start text-[12px] text-muted-foreground" onClick={() => setWhy(!why)}>
        Why we ask <ChevronDown className="h-3 w-3" />
      </button>
      {why && <p className="text-[13px] text-muted-foreground">{q.why}</p>}
      <AnswerInput question={q} initial={initial} onConfirm={onConfirm} />
      {onCancel && (
        <button className="self-start text-[12px] text-muted-foreground underline" onClick={onCancel}>Cancel</button>
      )}
    </div>
  )
}
