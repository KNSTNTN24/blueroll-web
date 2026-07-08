'use client'

import type { ReactNode } from 'react'

/**
 * Inspection-themed empty state — one system across Recipes, Allergen Matrix,
 * Checklists (Today), Documents, Deliveries, Suppliers. Sits directly on the
 * canvas (no card): illustration → amber "why it matters" badge → title →
 * one sentence → CTA row. Matches design_handoff_empty_states.
 */
export function InspectionEmpty({
  illustration, badge, title, sentence, children,
}: {
  illustration: ReactNode
  badge: string
  title: string
  sentence: string
  children?: ReactNode // CTA buttons
}) {
  return (
    <div className="flex flex-col items-center px-6 pb-9 pt-12 text-center">
      {illustration}
      <span className="mt-[22px] inline-flex items-center gap-[7px] whitespace-nowrap rounded-full bg-[#fbf1e1] px-3 py-1.5 text-[12px] font-semibold text-[#8a6a1f]">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.6-3.1 7.4-7 8.5C8.1 18.4 5 15.6 5 11V6z" /></svg>
        {badge}
      </span>
      <h2 className="mt-[13px] text-[19px] font-bold tracking-[-.01em] text-[#16181d]">{title}</h2>
      <p className="mt-2 max-w-[430px] text-[13.5px] leading-[1.55] text-[#5c626b]" style={{ textWrap: 'pretty' } as React.CSSProperties}>{sentence}</p>
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">{children}</div>}
    </div>
  )
}

/** Primary green CTA used inside InspectionEmpty. */
export function EmptyPrimary({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-[11px] bg-brand px-[18px] py-[11px] text-[14px] font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,.1)] transition-opacity hover:opacity-90">
      {children}
    </button>
  )
}

/** Secondary white CTA used inside InspectionEmpty. */
export function EmptySecondary({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-[11px] border border-[#e2e4e8] bg-white px-4 py-[11px] text-[14px] font-semibold text-[#41464d] transition-colors hover:border-[#cdd1d6] hover:text-[#1c1f24]">
      {children}
    </button>
  )
}

// ── Illustrations (exact from design handoff) ────────────────────────────────
export const RecipesArt = (
  <svg width="190" height="129" viewBox="0 0 224 152" fill="none" aria-hidden="true">
    <rect x="30" y="30" width="122" height="86" rx="13" fill="#fff" stroke="#e9eaed" transform="rotate(-7 91 73)" />
    <rect x="72" y="28" width="122" height="86" rx="13" fill="#fff" stroke="#e9eaed" transform="rotate(6 133 71)" />
    <rect x="50" y="36" width="126" height="90" rx="13" fill="#fff" stroke="#e2e4e8" />
    <path d="M66 62h24M66 62a12 12 0 0 0 24 0" stroke="#1f9d63" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="78" y1="50" x2="78" y2="55" stroke="#1f9d63" strokeWidth="2.4" strokeLinecap="round" />
    <rect x="102" y="52" width="58" height="7" rx="3.5" fill="#eef0f2" />
    <rect x="102" y="66" width="40" height="7" rx="3.5" fill="#eef0f2" />
    <rect x="66" y="92" width="42" height="16" rx="6" fill="#f8f0e8" />
    <rect x="114" y="92" width="42" height="16" rx="6" fill="#eaf4ee" />
    <path d="M186 22l3.4 8.6 8.6 3.4-8.6 3.4-3.4 8.6-3.4-8.6-8.6-3.4 8.6-3.4z" fill="#1f9d63" />
    <path d="M203 52l1.9 4.8 4.8 1.9-4.8 1.9-1.9 4.8-1.9-4.8-4.8-1.9 4.8-1.9z" fill="#8fd0b0" />
  </svg>
)

export const AllergenArt = (
  <svg width="196" height="129" viewBox="0 0 232 152" fill="none" aria-hidden="true">
    <rect x="30" y="10" width="32" height="32" rx="9" fill="#fff" stroke="#e9eaed" /><circle cx="46" cy="26" r="2.5" fill="#e7e9ec" />
    <rect x="72" y="10" width="32" height="32" rx="9" fill="#f6e6cf" /><path d="M81 26l5 5 9-10" stroke="#c8861a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="114" y="10" width="32" height="32" rx="9" fill="#fff" stroke="#e9eaed" /><circle cx="130" cy="26" r="2.5" fill="#e7e9ec" />
    <rect x="156" y="10" width="32" height="32" rx="9" fill="#fff" stroke="#e9eaed" /><circle cx="172" cy="26" r="2.5" fill="#e7e9ec" />
    <rect x="30" y="52" width="32" height="32" rx="9" fill="#f6e6cf" /><path d="M39 68l5 5 9-10" stroke="#c8861a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="72" y="52" width="32" height="32" rx="9" fill="#fff" stroke="#e9eaed" /><circle cx="88" cy="68" r="2.5" fill="#e7e9ec" />
    <rect x="114" y="52" width="32" height="32" rx="9" fill="#f6e6cf" /><path d="M123 68l5 5 9-10" stroke="#c8861a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="156" y="52" width="32" height="32" rx="9" fill="#fff" stroke="#e9eaed" /><circle cx="172" cy="68" r="2.5" fill="#e7e9ec" />
    <rect x="30" y="94" width="32" height="32" rx="9" fill="#fff" stroke="#e9eaed" /><circle cx="46" cy="110" r="2.5" fill="#e7e9ec" />
    <rect x="72" y="94" width="32" height="32" rx="9" fill="#f6e6cf" /><path d="M81 110l5 5 9-10" stroke="#c8861a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="114" y="94" width="32" height="32" rx="9" fill="#fff" stroke="#e9eaed" /><circle cx="130" cy="110" r="2.5" fill="#e7e9ec" />
    <path d="M186 62l28 11v17c0 17-11.5 27.5-28 32-16.5-4.5-28-15-28-32V73z" fill="#1f9d63" stroke="#f6f7f8" strokeWidth="5" />
    <path d="M174 94l8.5 8.5L200 84" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const ChecklistArt = (
  <svg width="184" height="126" viewBox="0 0 216 148" fill="none" aria-hidden="true">
    <rect x="58" y="14" width="100" height="122" rx="13" fill="#fff" stroke="#e2e4e8" />
    <rect x="88" y="6" width="40" height="16" rx="6" fill="#eef0f2" />
    <circle cx="78" cy="48" r="8" fill="#eaf4ee" /><path d="M74.5 48l2.5 2.5 4.5-5" stroke="#1f9d63" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="94" y="43" width="48" height="7" rx="3.5" fill="#eef0f2" />
    <circle cx="78" cy="76" r="8" fill="#eaf4ee" /><path d="M74.5 76l2.5 2.5 4.5-5" stroke="#1f9d63" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="94" y="71" width="36" height="7" rx="3.5" fill="#eef0f2" />
    <circle cx="78" cy="104" r="8" fill="#fff" stroke="#e2e4e8" />
    <rect x="94" y="99" width="44" height="7" rx="3.5" fill="#eef0f2" />
    <path d="M164 84l24 9.5v14.5c0 14.5-10 23.5-24 27.5-14-4-24-13-24-27.5V93.5z" fill="#1f9d63" stroke="#f6f7f8" strokeWidth="5" />
    <path d="M154 111l7 7 14-14.5" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M40 34l2.8 7 7 2.8-7 2.8-2.8 7-2.8-7-7-2.8 7-2.8z" fill="#8fd0b0" />
  </svg>
)

export const DocumentsArt = (
  <svg width="184" height="126" viewBox="0 0 216 148" fill="none" aria-hidden="true">
    <rect x="42" y="30" width="92" height="112" rx="12" fill="#fff" stroke="#e9eaed" transform="rotate(-6 88 86)" />
    <rect x="66" y="22" width="96" height="116" rx="12" fill="#fff" stroke="#e2e4e8" />
    <path d="M128 22l34 34h-26a8 8 0 0 1-8-8z" fill="#eef0f2" />
    <rect x="80" y="70" width="52" height="7" rx="3.5" fill="#eef0f2" />
    <rect x="80" y="86" width="64" height="7" rx="3.5" fill="#eef0f2" />
    <rect x="80" y="102" width="40" height="7" rx="3.5" fill="#eef0f2" />
    <rect x="80" y="40" width="30" height="14" rx="5" fill="#f8f0e8" />
    <path d="M172 82l24 9.5V106c0 14.5-10 23.5-24 27.5-14-4-24-13-24-27.5V91.5z" fill="#1f9d63" stroke="#f6f7f8" strokeWidth="5" />
    <path d="M162 109l7 7 14-14.5" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M36 12l2.8 7 7 2.8-7 2.8-2.8 7-2.8-7-7-2.8 7-2.8z" fill="#8fd0b0" />
  </svg>
)

export const DeliveriesArt = (
  <svg width="196" height="123" viewBox="0 0 232 146" fill="none" aria-hidden="true">
    <rect x="28" y="34" width="108" height="64" rx="10" fill="#fff" stroke="#e2e4e8" />
    <rect x="42" y="48" width="34" height="7" rx="3.5" fill="#eef0f2" />
    <rect x="42" y="62" width="52" height="7" rx="3.5" fill="#eef0f2" />
    <rect x="42" y="76" width="26" height="7" rx="3.5" fill="#eef0f2" />
    <path d="M136 52h30l18 18v28h-48z" fill="#fff" stroke="#e2e4e8" />
    <circle cx="58" cy="104" r="10" fill="#fff" stroke="#e2e4e8" /><circle cx="58" cy="104" r="4" fill="#eef0f2" />
    <circle cx="156" cy="104" r="10" fill="#fff" stroke="#e2e4e8" /><circle cx="156" cy="104" r="4" fill="#eef0f2" />
    <path d="M186 74l24 9.5V98c0 14.5-10 23.5-24 27.5-14-4-24-13-24-27.5V83.5z" fill="#1f9d63" stroke="#f6f7f8" strokeWidth="5" />
    <path d="M176 101l7 7 14-14.5" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M36 12l2.8 7 7 2.8-7 2.8-2.8 7-2.8-7-7-2.8 7-2.8z" fill="#8fd0b0" />
  </svg>
)

export const SuppliersArt = (
  <svg width="196" height="123" viewBox="0 0 232 146" fill="none" aria-hidden="true">
    <rect x="52" y="66" width="56" height="48" rx="8" fill="#fff" stroke="#e2e4e8" />
    <line x1="80" y1="66" x2="80" y2="114" stroke="#eef0f2" strokeWidth="2" />
    <rect x="112" y="66" width="56" height="48" rx="8" fill="#fff" stroke="#e2e4e8" />
    <line x1="140" y1="66" x2="140" y2="114" stroke="#eef0f2" strokeWidth="2" />
    <rect x="82" y="16" width="56" height="46" rx="8" fill="#fff" stroke="#e2e4e8" />
    <line x1="110" y1="16" x2="110" y2="62" stroke="#eef0f2" strokeWidth="2" />
    <rect x="98" y="34" width="24" height="10" rx="4" fill="#f8f0e8" />
    <path d="M186 74l24 9.5V98c0 14.5-10 23.5-24 27.5-14-4-24-13-24-27.5V83.5z" fill="#1f9d63" stroke="#f6f7f8" strokeWidth="5" />
    <path d="M176 101l7 7 14-14.5" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M36 22l2.8 7 7 2.8-7 2.8-2.8 7-2.8-7-7-2.8 7-2.8z" fill="#8fd0b0" />
  </svg>
)
