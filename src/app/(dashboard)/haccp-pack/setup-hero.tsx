'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { loadSessionSummary } from '@/lib/haccp-setup/api'
import { setupHero } from '@/lib/haccp-setup/hero'

// The pack page's single way into "Set up my HACCP" (design: Pack-Entry.dc.html). Managers only.
export function SetupHero({ businessId, siteId }: { businessId: string; siteId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['haccp-setup-summary', businessId, siteId],
    queryFn: () => loadSessionSummary(businessId, siteId),
    staleTime: 30_000,
  })
  if (isLoading) return null
  const h = setupHero(data ?? null)
  const cta = h.mode === 'start' ? 'Start' : h.mode === 'continue' ? `Continue — ${h.pct}% done` : 'Review with questions'
  const sub = h.mode === 'continue' && h.next
    ? `Next: ${h.next}, ${h.left} question${h.left === 1 ? '' : 's'} left`
    : h.mode === 'review' ? 'Re-run it after changes to your menu, kit or way of working.' : null

  return (
    <section aria-labelledby="setup-hero" className="flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-[#1f7a52] px-7 py-6 text-white">
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
        <div className="text-[12px] font-bold uppercase tracking-[1.6px] text-white/85">{h.mode === 'review' ? 'Set up' : 'Recommended'}</div>
        <h2 id="setup-hero" className="text-[26px] font-extrabold leading-tight tracking-[-0.6px]">Set up my HACCP</h2>
        <p className="max-w-[560px] text-[15px] leading-normal text-white/90">
          Answer plain questions about how your kitchen works. We fill your pack from the answers, your menu, recipes and suppliers, and add the checks the FSA expects.
        </p>
        <div className="flex flex-wrap gap-3.5 text-[13px] text-white/90">
          <span>About 15 minutes</span><span aria-hidden>·</span><span>Save and come back any time</span><span aria-hidden>·</span><span>An assistant answers questions as you go</span>
        </div>
      </div>
      <div className="flex flex-col items-start gap-2.5">
        <Link href="/haccp-setup" className="inline-flex min-h-12 items-center rounded-xl bg-white px-[22px] text-[15px] font-extrabold text-[#1f7a52]">{cta}</Link>
        {sub && <span className="text-[12.5px] text-white/85">{sub}</span>}
      </div>
    </section>
  )
}
