import type { PlanDoc } from '@/lib/haccp-plan/types'
import { SectionIcon } from './parts'

/** Sticky jump-to-section chips for the screen views (inspector link, present mode). */
export function SectionChips({ doc, scrollRoot }: { doc: PlanDoc; scrollRoot?: HTMLElement | null }) {
  function go(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    if (scrollRoot) scrollRoot.scrollTo({ top: el.offsetTop - 64, behavior: 'smooth' })
    else el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <nav aria-label="Plan sections" className="plan-no-print" style={{ position: 'sticky', top: 0, zIndex: 5, background: '#ffffff', borderBottom: '1px solid #e9eaed' }}>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 12px', maxWidth: 820, margin: '0 auto' }}>
        {doc.sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(`section-${s.id}`)}
            style={{ flex: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 14px 0 6px', borderRadius: 999, border: '1px solid #e2e4e8', background: '#fff', color: '#16181d', font: "600 13px var(--font-geist), system-ui", whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            <SectionIcon icon={s.id} size={30} />
            {s.num} · {s.name}
          </button>
        ))}
      </div>
    </nav>
  )
}
