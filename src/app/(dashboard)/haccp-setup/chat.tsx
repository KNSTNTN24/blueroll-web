'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { AnswerValue, Answers, Question } from '@/lib/haccp-setup/types'
import { QUESTIONS } from '@/lib/haccp-setup/content/questions'
import { nextQuestion, suggestedAnswer, visibleQuestions } from '@/lib/haccp-setup/engine'
import { AnswerInput, formatAnswer } from './answer-input'

export function Chat({ answers, previous, onAnswer, onClear }: {
  answers: Answers; previous: Answers; onAnswer: (id: string, v: AnswerValue) => void; onClear: (id: string) => void
}) {
  const current = nextQuestion(QUESTIONS, answers)
  const done = visibleQuestions(QUESTIONS, answers).filter((q) => answers[q.id] !== undefined)

  return (
    <div className="flex flex-col gap-4">
      {done.map((q) => (
        <div key={q.id} className="flex flex-col gap-1">
          <p className="max-w-[560px] rounded-xl bg-muted px-3 py-2 text-[14px]">{q.text}</p>
          <div className="flex items-center justify-end gap-2">
            <p className="max-w-[560px] rounded-xl bg-brand/15 px-3 py-2 text-[14px]">{formatAnswer(q, answers[q.id])}</p>
            <button className="text-[12px] text-muted-foreground underline" onClick={() => onClear(q.id)}>Edit</button>
          </div>
        </div>
      ))}
      {current && <CurrentQuestion key={current.id} q={current} answers={answers} previous={previous} onAnswer={onAnswer} />}
    </div>
  )
}

function CurrentQuestion({ q, answers, previous, onAnswer }: { q: Question; answers: Answers; previous: Answers; onAnswer: (id: string, v: AnswerValue) => void }) {
  const [why, setWhy] = useState(false)
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4">
      <p className="text-[15px] font-medium">{q.text}</p>
      <button className="flex items-center gap-1 self-start text-[12px] text-muted-foreground" onClick={() => setWhy(!why)}>
        Why we ask <ChevronDown className="h-3 w-3" />
      </button>
      {why && <p className="text-[13px] text-muted-foreground">{q.why}</p>}
      <AnswerInput question={q} initial={previous[q.id] ?? suggestedAnswer(q, answers)} onConfirm={(v) => onAnswer(q.id, v)} />
    </div>
  )
}
