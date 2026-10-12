'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, FileText } from 'lucide-react'
import { DocumentPickerModal } from '@/components/shared/document-picker-modal'
import { SectionIcon } from '@/components/haccp-plan/parts'
import { HACCP_METHODS } from '@/lib/haccp-pack/methods'
import type { SetupContext } from '@/lib/haccp-setup/context'
import type { AnswerValue, DataSource, Question } from '@/lib/haccp-setup/types'

// "We found this in Blueroll" and "Attach what an inspector may ask to see" (design: From-Blueroll, Documents).

const SOURCE_PAGE: Record<DataSource, { href: string; label: string }> = {
  raw_products: { href: '/recipes', label: 'Recipes' },
  menu_methods: { href: '/recipes', label: 'Recipes' },
  suppliers: { href: '/suppliers', label: 'Suppliers' },
  team: { href: '/team', label: 'Team' },
  checklists: { href: '/checklists', label: 'Checklists' },
}

const MENU_GROUPS: [string, string][] = [
  ['ck_dishes', 'Cooked from raw'], ['cd_method', 'Cooled to use later'], ['rh_items', 'Reheated'], ['hh_items', 'Kept hot'],
  ['df_products', 'Defrosted'], ['fz_method', 'Frozen'], ['ec_items', 'Extra care foods'], ['rte_items', 'Ready to eat'],
]

const lines = (s: string | undefined) => (s ?? '').split(/\n|, (?=[A-Z])/).map((x) => x.trim()).filter(Boolean)

function SourceBody({ source, ctx }: { source: DataSource; ctx: SetupContext }) {
  if (source === 'suppliers') {
    return (
      <div className="overflow-x-auto rounded-[10px] border border-[#e9eaed]">
        <table className="w-full min-w-[480px] border-collapse text-[13.5px]">
          <thead><tr className="bg-[#f6f7f8] text-left text-[12px] text-[#3b3f47]">
            <th className="px-3 py-2 font-bold">Supplier</th><th className="px-3 py-2 font-bold">Contact</th><th className="px-3 py-2 font-bold">Delivers</th>
          </tr></thead>
          <tbody>
            {ctx.sources.suppliers.map((s) => (
              <tr key={s.id} className="border-t border-[#e9eaed]">
                <td className="px-3 py-2.5 font-semibold">{s.name}</td>
                <td className="px-3 py-2.5 text-[#3b3f47]">{[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-3 py-2.5 text-[#3b3f47]">{Array.isArray(s.delivery_days) ? s.delivery_days.join(', ') : s.delivery_days || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (source === 'raw_products') {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {(ctx.auto.sf_raw_products ?? '').split(', ').filter(Boolean).map((r) => (
          <li key={r} className="rounded-full border border-[#e9eaed] bg-[#f6f7f8] px-3 py-1.5 text-[13px]">{r}</li>
        ))}
      </ul>
    )
  }
  if (source === 'menu_methods') {
    return (
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {MENU_GROUPS.filter(([k]) => ctx.auto[k]).map(([k, label]) => (
          <div key={k} className="flex flex-col gap-1 rounded-[10px] bg-[#f6f7f8] p-3">
            <div className="text-[12px] font-bold text-[#5f6670]">{label}</div>
            <ul className="text-[13px] leading-normal">{lines(ctx.auto[k]).map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        ))}
      </div>
    )
  }
  const value = source === 'team' ? ctx.auto.tr_responsible : [ctx.auto.st_method, ctx.auto.tp_method].filter(Boolean).join('\n')
  return <ul className="flex flex-col gap-1 text-[14px]">{lines(value).map((l) => <li key={l}>{l}</li>)}</ul>
}

export function ConfirmData({ question, ctx, position, onConfirm, onBack }: {
  question: Question; ctx: SetupContext; position: string; onConfirm: (v: AnswerValue) => void; onBack?: () => void
}) {
  if (question.answer.kind !== 'confirm_data') return null
  const source = question.answer.source
  const page = SOURCE_PAGE[source]
  const method = HACCP_METHODS.find((m) => m.id === question.method)
  return (
    <section aria-labelledby={`q-${question.id}`} className="flex flex-col gap-3.5 rounded-[14px] border border-[#e9eaed] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-3">
          {method && <SectionIcon icon={method.section} size={36} />}
          <div className="text-[12px] text-[#5f6670]">{position}</div>
        </div>
        <span className="rounded-full bg-[#e9f4ee] px-2.5 py-1 text-[12px] font-semibold text-[#1f7a52]">From {page.label}</span>
      </div>
      <h2 id={`q-${question.id}`} className="text-[20px] font-bold leading-snug tracking-[-0.3px]">{question.text}</h2>
      <SourceBody source={source} ctx={ctx} />
      <p className="text-[12.5px] text-[#5f6670]">Something missing or wrong? Fix it in <Link href={page.href} className="font-semibold text-[#1f7a52]">{page.label}</Link> and it updates your plan too.</p>
      <div className="flex flex-wrap justify-end gap-2">
        {onBack && <button type="button" onClick={onBack} className="min-h-11 rounded-[10px] border border-[#e2e4e8] bg-white px-4 text-[13.5px] font-semibold">Back</button>}
        <button type="button" onClick={() => onConfirm('missing')} className="min-h-11 rounded-[10px] border border-[#e2e4e8] bg-white px-4 text-[13.5px] font-semibold">Something’s missing</button>
        <button type="button" onClick={() => onConfirm(true)} className="min-h-11 rounded-[10px] bg-[#1f9d63] px-[18px] text-[13.5px] font-bold text-white">Yes, that’s right</button>
      </div>
    </section>
  )
}

const refTitle = (raw: string | undefined) => {
  if (!raw) return null
  try { const p = JSON.parse(raw); return typeof p?.title === 'string' ? p.title as string : null } catch { return null }
}

export function DocumentsStep({ ctx, initial, onConfirm, onBack }: {
  ctx: SetupContext; initial: Record<string, string> | undefined; onConfirm: (v: Record<string, string>) => void; onBack?: () => void
}) {
  const [files, setFiles] = useState<Record<string, string>>(initial ?? {})
  const [picking, setPicking] = useState<{ fieldId: string; label: string } | null>(null)
  const attached = ctx.neededFiles.filter((f) => refTitle(files[f.fieldId])).length

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="docs-needed" className="overflow-hidden rounded-[14px] border border-[#e9eaed] bg-white">
        <h2 id="docs-needed" className="border-b border-[#e9eaed] px-[18px] py-3.5 text-[14px] font-bold">Needed · {attached} of {ctx.neededFiles.length} attached</h2>
        {ctx.neededFiles.map((f) => {
          const title = refTitle(files[f.fieldId])
          const method = HACCP_METHODS.find((m) => m.id === f.methodId)
          return (
            <div key={f.fieldId} className="flex flex-wrap items-center gap-3 border-b border-[#f1f2f4] px-[18px] py-3.5">
              {method && <SectionIcon icon={method.section} size={36} />}
              <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
                <div className="text-[14px] font-semibold">{f.label.replace(/^Upload /, '').replace(/^./, (c) => c.toUpperCase())}</div>
                <div className="text-[12.5px] text-[#5f6670]">{method?.name}</div>
              </div>
              {title ? (
                <>
                  <span className="inline-flex min-h-9 items-center gap-2 rounded-[10px] bg-[#e9f4ee] px-3 text-[13px] font-semibold text-[#1f7a52]"><FileText className="h-4 w-4" strokeWidth={1.8} />{title}</span>
                  <button type="button" onClick={() => setPicking({ fieldId: f.fieldId, label: f.label })} className="min-h-9 rounded-[10px] border border-[#e2e4e8] bg-white px-3 text-[12.5px] font-semibold">Change</button>
                </>
              ) : (
                <button type="button" onClick={() => setPicking({ fieldId: f.fieldId, label: f.label })} className="min-h-10 rounded-[10px] bg-[#14161b] px-3.5 text-[13px] font-bold text-white">Choose or upload</button>
              )}
            </div>
          )
        })}
      </section>

      {ctx.coveredFiles.length > 0 && (
        <section aria-labelledby="docs-covered" className="overflow-hidden rounded-[14px] border border-[#e9eaed] bg-white">
          <h2 id="docs-covered" className="border-b border-[#e9eaed] px-[18px] py-3.5 text-[14px] font-bold">Not needed — Blueroll has it</h2>
          {ctx.coveredFiles.map((f) => (
            <div key={f.fieldId} className="flex items-center gap-3 border-b border-[#f1f2f4] px-[18px] py-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-[#1f9d63] text-white" aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={2.5} /></span>
              <div className="flex flex-col gap-0.5">
                <div className="text-[13.5px] font-semibold">{f.label.replace(/^Upload /, '').replace(/^./, (c) => c.toUpperCase())}</div>
                <div className="text-[12.5px] text-[#5f6670]">{f.reason}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          {onBack && <button type="button" onClick={onBack} className="min-h-11 rounded-[10px] border border-[#e2e4e8] bg-white px-4 text-[13.5px] font-semibold">Back</button>}
          <button type="button" onClick={() => onConfirm(files)} className="min-h-11 rounded-[10px] border border-[#e2e4e8] bg-white px-4 text-[13.5px] font-semibold">Do this later</button>
        </div>
        <button type="button" onClick={() => onConfirm(files)} className="min-h-11 rounded-[10px] bg-[#1f9d63] px-[18px] text-[13.5px] font-bold text-white">Continue to review</button>
      </div>

      <DocumentPickerModal open={!!picking} onOpenChange={(o) => { if (!o) setPicking(null) }} label={picking?.label}
        onSelect={(doc) => { if (picking) setFiles((m) => ({ ...m, [picking.fieldId]: JSON.stringify({ id: doc.id, title: doc.title }) })); setPicking(null) }} />
    </div>
  )
}
