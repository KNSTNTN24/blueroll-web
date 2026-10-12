'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ImageIcon } from 'lucide-react'
import { HACCP_METHODS } from '@/lib/haccp-pack/methods'
import { METHOD_COPY, SECTION_NAME, methodRef } from '@/lib/haccp-plan/copy'
import { SectionIcon, type IconKey } from '@/components/haccp-plan/parts'
import { CookCombos, PanToPass, TempScale, TwoStageClean } from '@/components/haccp-plan/infographics'
import '@/components/haccp-plan/plan.css'

// The SFBB safe method a question belongs to, with an example of what goes in the plan.

const METHOD_ICON: Record<string, IconKey> = { food_allergies: 'allergens', chilled_storage: 'fridge', freezing: 'fridge' }

export function MethodContext({ methodId, quote }: { methodId: string; quote: string | null }) {
  const [open, setOpen] = useState(false)
  const method = HACCP_METHODS.find((m) => m.id === methodId)
  const copy = METHOD_COPY[methodId]
  if (!method || !copy) return null
  const graphics = copy.infographic.filter((k) => k === 'tempScale' || k === 'cookCombos' || k === 'panToPass' || k === 'twoStageClean')

  return (
    <section aria-label={`${method.name} — Safer Food, Better Business`} className="flex flex-col gap-3 rounded-[14px] border border-[#e9eaed] bg-white px-5 py-[18px]">
      <div className="flex items-center gap-3">
        <SectionIcon icon={METHOD_ICON[methodId] ?? method.section} size={40} tone="solid" />
        <div className="flex flex-col gap-0.5">
          <div className="text-[11.5px] font-bold uppercase tracking-[1.4px] text-[#1f7a52]">Safe method {methodRef(methodId)} · {SECTION_NAME[method.section]}</div>
          <div className="text-[17px] font-bold">{method.name}</div>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-x-3.5 gap-y-2 text-[14px] leading-normal sm:grid-cols-[104px_minmax(0,1fr)]">
        <dt className="text-[12.5px] font-bold">Safety point</dt>
        <dd className="m-0">{copy.safetyPoint}</dd>
        <dt className="text-[12.5px] font-bold">Why?</dt>
        <dd className="m-0 text-[#3b3f47]">{copy.why}</dd>
      </dl>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="inline-flex min-h-9 items-center gap-2 self-start rounded-full border border-[#c9dfd2] bg-[#e9f4ee] px-3 text-[12.5px] font-bold text-[#1f7a52]">
        <ImageIcon className="h-3.5 w-3.5" strokeWidth={2} />
        {open ? 'Hide example' : 'Show example'}
      </button>
      {open && (
        <div className="plan-doc flex flex-col gap-3 border-t border-[#e9eaed] pt-3.5">
          {graphics.includes('tempScale') && <TempScale />}
          {graphics.includes('cookCombos') && <CookCombos />}
          {graphics.includes('panToPass') && <PanToPass />}
          {graphics.includes('twoStageClean') && <TwoStageClean />}
          <div className="flex flex-col gap-1.5 rounded-[10px] bg-[#f6f7f8] px-3.5 py-3">
            <div className="text-[11.5px] font-bold uppercase tracking-[1.2px] text-[#5f6670]">In your HACCP Plan</div>
            <div className="text-[13.5px] leading-normal">
              {quote ? `“${quote}”` : 'Your answer here becomes part of this safe method in your plan.'}
            </div>
            <Link href="/haccp-pack/document" className="text-[12.5px] font-semibold text-[#1f7a52]">See your HACCP Plan</Link>
          </div>
        </div>
      )}
    </section>
  )
}
