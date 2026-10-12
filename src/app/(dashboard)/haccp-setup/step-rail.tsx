'use client'

import { Check, Paperclip } from 'lucide-react'
import { SectionIcon, type IconKey } from '@/components/haccp-plan/parts'

// Steps down the left on desktop, section chips across the top on phones (design: Main / Phone).

export interface Step {
  id: string
  name: string
  short: string
  sub: string
  icon: IconKey | 'profile' | 'documents' | 'review'
  state: 'done' | 'now' | 'todo' | 'disabled'
}

function StepMark({ icon, active, size }: { icon: Step['icon']; active: boolean; size: number }) {
  if (icon === 'profile' || icon === 'documents' || icon === 'review') {
    const Glyph = icon === 'documents' ? Paperclip : icon === 'review' ? Check : null
    return (
      <span className={`flex shrink-0 items-center justify-center rounded-lg text-[12px] font-bold ${active ? 'bg-[#1f7a52] text-white' : 'bg-[#f1f2f4] text-[#3b3f47]'}`} style={{ width: size, height: size }} aria-hidden>
        {Glyph ? <Glyph className="h-3.5 w-3.5" strokeWidth={2} /> : '0'}
      </span>
    )
  }
  return <SectionIcon icon={icon} size={size} tone={active ? 'solid' : 'tint'} />
}

export function StepRail({ steps, onPick }: { steps: Step[]; onPick: (id: string) => void }) {
  return (
    <>
      <ol aria-label="Steps" className="hidden w-[236px] shrink-0 flex-col gap-0.5 rounded-[14px] border border-[#e9eaed] bg-white p-2 lg:flex">
        {steps.map((s) => (
          <li key={s.id}>
            <button type="button" disabled={s.state === 'disabled'} onClick={() => onPick(s.id)} aria-current={s.state === 'now' ? 'step' : undefined}
              className={`flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left disabled:opacity-45 ${s.state === 'now' ? 'bg-[#e9f4ee]' : 'hover:bg-[#f6f7f8]'}`}>
              <StepMark icon={s.icon} active={s.state === 'now'} size={30} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13px] font-semibold">{s.name}</span>
                <span className="text-[11.5px] text-[#5f6670]">{s.sub}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <ol aria-label="Steps" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:hidden">
        {steps.map((s) => (
          <li key={s.id} className="shrink-0">
            <button type="button" disabled={s.state === 'disabled'} onClick={() => onPick(s.id)} aria-current={s.state === 'now' ? 'step' : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border py-0 pl-1 pr-3 text-[12.5px] font-semibold disabled:opacity-45 ${s.state === 'now' ? 'border-[#16181d] bg-[#16181d] text-white' : 'border-[#e2e4e8] bg-white'}`}>
              <StepMark icon={s.icon} active={false} size={28} />
              {s.short}
            </button>
          </li>
        ))}
      </ol>
    </>
  )
}
