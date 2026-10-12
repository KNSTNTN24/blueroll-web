'use client'

import { useEffect, useState } from 'react'
import type { AnswerValue, Equipment, Option, Question } from '@/lib/haccp-setup/types'
import { EquipmentInput } from './answer-input'

// One question at a time, answered with large option cards (design: Main.dc.html).

const YES_NO: Option[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]

function OptionCard({ type, name, option, checked, onChange }: {
  type: 'radio' | 'checkbox'; name: string; option: Option; checked: boolean; onChange: () => void
}) {
  return (
    <label className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] px-3.5 py-3 transition-colors ${checked ? 'border-[#1f9d63] bg-[#f3faf6]' : 'border-[#e2e4e8] bg-white hover:border-[#c9cdd3]'}`}>
      <input type={type} name={name} checked={checked} onChange={onChange} className="h-[18px] w-[18px] shrink-0 accent-[#1f9d63]" />
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] font-semibold">{option.label}</span>
        {option.hint && <span className="text-[12px] text-[#5f6670]">{option.hint}</span>}
      </span>
    </label>
  )
}

export function QuestionCard({ question, position, initial, onConfirm, onDraft, onBack, onAskAssistant, continueLabel = 'Continue' }: {
  question: Question
  position: string
  initial: AnswerValue | undefined
  onConfirm: (v: AnswerValue) => void
  /** The answer as it is being chosen, before Continue — drives the live previews. */
  onDraft?: (v: AnswerValue | undefined) => void
  onBack?: () => void
  onAskAssistant?: () => void
  continueLabel?: string
}) {
  const a = question.answer
  const [single, setSingle] = useState<string | null>(
    a.kind === 'yes_no' ? (initial === true ? 'yes' : initial === false ? 'no' : null) : typeof initial === 'string' ? initial : null,
  )
  const [multi, setMulti] = useState<string[]>(Array.isArray(initial) && a.kind === 'multi' ? (initial as string[]) : [])
  const [equipment, setEquipment] = useState<Equipment[]>(a.kind === 'equipment_list' && Array.isArray(initial) ? (initial as Equipment[]) : [])

  useEffect(() => {
    if (!onDraft) return
    if (a.kind === 'yes_no') onDraft(single === null ? undefined : single === 'yes')
    else if (a.kind === 'single') onDraft(single ?? undefined)
    else if (a.kind === 'multi') onDraft(multi)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, multi])

  const canContinue = a.kind === 'multi' || a.kind === 'equipment_list' || single !== null
  const confirm = () => {
    if (a.kind === 'yes_no') onConfirm(single === 'yes')
    else if (a.kind === 'single') onConfirm(single as string)
    else if (a.kind === 'multi') onConfirm(multi)
    else if (a.kind === 'equipment_list') onConfirm(equipment)
  }
  const options = a.kind === 'yes_no' ? YES_NO : 'options' in a ? a.options : []

  return (
    <section aria-labelledby={`q-${question.id}`} className="flex flex-col gap-3.5 rounded-[14px] border border-[#e9eaed] bg-white p-5">
      <div className="text-[12px] text-[#5f6670]">{position}</div>
      <h2 id={`q-${question.id}`} className="text-[20px] font-bold leading-snug tracking-[-0.3px]">{question.text}</h2>

      {a.kind === 'equipment_list' ? (
        <EquipmentInput value={equipment} onChange={setEquipment} onConfirm={confirm} />
      ) : (
        <fieldset className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <legend className="sr-only">{question.text}</legend>
          {options.map((o) => (
            <OptionCard key={o.value} name={question.id} option={o}
              type={a.kind === 'multi' ? 'checkbox' : 'radio'}
              checked={a.kind === 'multi' ? multi.includes(o.value) : single === o.value}
              onChange={() => a.kind === 'multi'
                ? setMulti((m) => (m.includes(o.value) ? m.filter((x) => x !== o.value) : [...m, o.value]))
                : setSingle(o.value)} />
          ))}
        </fieldset>
      )}
      {a.kind === 'multi' && <p className="text-[12px] text-[#5f6670]">Leave all unticked if none apply.</p>}

      {a.kind !== 'equipment_list' && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
          {onAskAssistant ? (
            <button type="button" onClick={onAskAssistant} className="min-h-11 px-3 text-[13px] font-semibold text-[#1f7a52]">
              Not sure — ask the assistant
            </button>
          ) : <span />}
          <div className="flex gap-2">
            {onBack && (
              <button type="button" onClick={onBack} className="min-h-11 rounded-[10px] border border-[#e2e4e8] bg-white px-4 text-[13.5px] font-semibold">Back</button>
            )}
            <button type="button" disabled={!canContinue} onClick={confirm}
              className="min-h-11 rounded-[10px] bg-[#1f9d63] px-[18px] text-[13.5px] font-bold text-white disabled:opacity-50">
              {continueLabel}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
