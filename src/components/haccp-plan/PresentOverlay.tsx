'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { PlanDoc } from '@/lib/haccp-plan/types'
import { PlanDocument } from './PlanDocument'
import { SectionChips } from './SectionChips'

/** Full-screen, chrome-free view of the plan for showing an inspector on a phone or tablet. Esc closes. */
export function PresentOverlay({ doc, onClose }: { doc: PlanDoc; onClose: () => void }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    setRoot(scrollRef.current)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  return (
    <div role="dialog" aria-modal="true" aria-label="HACCP Plan — present" className="fixed inset-0 z-50 flex flex-col bg-[#f6f7f8]">
      <div className="flex items-center justify-between gap-3 bg-[#14161b] px-4 py-2.5 text-white">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <span className="h-2 w-2 rounded-full bg-[#1f9d63]" />
          HACCP Plan · {doc.businessName}{doc.siteName ? ` · ${doc.siteName}` : ''}
        </div>
        <button type="button" onClick={onClose} aria-label="Close present mode"
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-[#3a3e46] px-3.5 text-[13px] font-semibold">
          <X className="h-4 w-4" strokeWidth={1.8} /> Exit
        </button>
      </div>
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        <SectionChips doc={doc} scrollRoot={root} />
        <div className="py-6">
          <PlanDocument doc={doc} mode="screen" />
        </div>
      </div>
    </div>
  )
}
