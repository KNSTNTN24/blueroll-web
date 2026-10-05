'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import type { AnswerValue, Equipment, EquipmentKind, Question } from '@/lib/haccp-setup/types'
import { EQUIPMENT_KINDS } from '@/lib/haccp-setup/types'
import { assistantParseEquipment, AssistantError } from '@/lib/haccp-setup/api'
import { dedupeEquipment } from '@/lib/haccp-setup/equipment-labels'

const KIND_LABEL: Record<EquipmentKind, string> = {
  fridge: 'Fridge', freezer: 'Freezer', display_chiller: 'Display chiller', blast_chiller: 'Blast chiller',
  dishwasher: 'Dishwasher', probe: 'Probe thermometer', hot_hold: 'Hot holding unit', other: 'Other',
}

export function formatAnswer(q: Question, v: AnswerValue): string {
  const a = q.answer
  if (a.kind === 'yes_no') return v === true ? 'Yes' : 'No'
  if (a.kind === 'single') return a.options.find((o) => o.value === v)?.label ?? String(v)
  if (a.kind === 'multi') {
    const vals = v as string[]
    return vals.length ? a.options.filter((o) => vals.includes(o.value)).map((o) => o.label).join(', ') : 'None of these'
  }
  const eq = v as Equipment[]
  return eq.length ? eq.map((e) => `${e.label} (${KIND_LABEL[e.kind]})`).join(', ') : 'No equipment listed'
}

export function AnswerInput({ question, initial, onConfirm }: {
  question: Question; initial: AnswerValue | undefined; onConfirm: (v: AnswerValue) => void
}) {
  const a = question.answer
  const [single, setSingle] = useState<string | undefined>(typeof initial === 'string' ? initial : undefined)
  const [multi, setMulti] = useState<string[]>(Array.isArray(initial) && typeof initial[0] !== 'object' ? (initial as string[]) : [])
  const [equipment, setEquipment] = useState<Equipment[]>(
    Array.isArray(initial) && (initial.length === 0 || typeof initial[0] === 'object') ? (initial as Equipment[]) : [])

  if (a.kind === 'yes_no') {
    return (
      <div className="flex gap-2">
        <Button variant={initial === true ? 'default' : 'outline'} onClick={() => onConfirm(true)}>Yes</Button>
        <Button variant={initial === false ? 'default' : 'outline'} onClick={() => onConfirm(false)}>No</Button>
      </div>
    )
  }
  if (a.kind === 'single') {
    return (
      <div className="flex flex-col gap-2">
        {a.options.map((o) => (
          <button key={o.value} onClick={() => setSingle(o.value)}
            className={cn('rounded-lg border px-3 py-2 text-left text-[14px]', single === o.value ? 'border-brand bg-brand/10' : 'border-border')}>
            {o.label}
          </button>
        ))}
        <Button className="self-start" disabled={!single} onClick={() => single && onConfirm(single)}>Confirm</Button>
      </div>
    )
  }
  if (a.kind === 'multi') {
    const toggle = (v: string) => setMulti((m) => (m.includes(v) ? m.filter((x) => x !== v) : [...m, v]))
    return (
      <div className="flex flex-col gap-2">
        {a.options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={multi.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
        <Button className="self-start" onClick={() => onConfirm(multi)}>Confirm</Button>
      </div>
    )
  }
  return <EquipmentInput value={equipment} onChange={setEquipment} onConfirm={() => onConfirm(equipment)} />
}

function EquipmentInput({ value, onChange, onConfirm }: {
  value: Equipment[]; onChange: (v: Equipment[]) => void; onConfirm: () => void
}) {
  const [kind, setKind] = useState<EquipmentKind>('fridge')
  const [label, setLabel] = useState('')
  const [free, setFree] = useState('')
  const [parsing, setParsing] = useState(false)
  const [assistantOff, setAssistantOff] = useState(false)

  const add = () => {
    const l = label.trim()
    if (!l) return
    onChange(dedupeEquipment(value, [{ kind, label: l }]))
    setLabel('')
  }
  const parse = async () => {
    setParsing(true)
    try {
      const items = await assistantParseEquipment(free)
      if (!items.length) toast.message("We couldn't find any equipment in that text — add items one by one.")
      onChange(dedupeEquipment(value, items))
      setFree('')
    } catch (e) {
      if (e instanceof AssistantError) { toast.error(e.message); if (e.code !== 'limit') setAssistantOff(true) }
      else toast.error('Something went wrong — try again.')
    } finally { setParsing(false) }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2">
        {value.map((e, i) => (
          <li key={`${e.label}-${i}`} className="flex items-center gap-1 rounded-full border px-3 py-1 text-[13px]">
            {e.label} · {KIND_LABEL[e.kind]}
            <button aria-label={`Remove ${e.label}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Equipment type" className="rounded-md border px-2 text-[14px]" value={kind}
          onChange={(e) => setKind(e.target.value as EquipmentKind)}>
          {EQUIPMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <Input aria-label="Equipment name" className="w-56" placeholder="Name, e.g. Walk-in fridge" value={label}
          onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Button variant="outline" onClick={add}>Add</Button>
      </div>
      {!assistantOff && (
        <div className="flex flex-col gap-2">
          <Textarea aria-label="Describe your equipment" rows={2} placeholder="Or describe it: “2 fridges, a chest freezer and a probe”"
            value={free} onChange={(e) => setFree(e.target.value)} />
          <Button variant="outline" className="self-start" disabled={!free.trim() || parsing} onClick={parse}>
            {parsing ? 'Reading…' : 'Add from description'}
          </Button>
        </div>
      )}
      <Button className="self-start" onClick={onConfirm}>Confirm equipment</Button>
    </div>
  )
}
