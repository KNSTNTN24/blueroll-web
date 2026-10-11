import {
  ClipboardCheck, Flame, HandPlatter, Refrigerator, ShieldAlert, Snowflake, SprayCan, Thermometer, Wheat,
  type LucideIcon,
} from 'lucide-react'
import type { SectionId } from '@/lib/haccp-pack/methods'
import type { PlanDoc } from '@/lib/haccp-plan/types'

export type IconKey = SectionId | 'fridge' | 'allergens' | 'thermometer' | 'review'

const ICONS: Record<IconKey, LucideIcon> = {
  cross: ShieldAlert, cleaning: SprayCan, chilling: Snowflake, cooking: Flame, management: ClipboardCheck,
  fridge: Refrigerator, allergens: Wheat, thermometer: Thermometer, review: HandPlatter,
}

const TONES = {
  tint: { bg: '#e9f4ee', fg: '#1f7a52' },
  solid: { bg: '#1f7a52', fg: '#ffffff' },
  onDark: { bg: 'rgba(255,255,255,0.14)', fg: '#ffffff' },
  plain: { bg: 'transparent', fg: '#1f7a52' },
} as const

/** Lucide icon in a rounded tile — the section marks of the plan. */
export function SectionIcon({ icon, size = 40, tone = 'tint' }: { icon: IconKey; size?: number; tone?: keyof typeof TONES }) {
  const Icon = ICONS[icon]
  const t = TONES[tone]
  const glyph = tone === 'plain' ? size : Math.round(size * 0.52)
  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: Math.round(size * 0.28), background: t.bg, color: t.fg,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
      }}
    >
      <Icon size={glyph} strokeWidth={1.6} />
    </span>
  )
}

export function Tick({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <rect x="0.5" y="0.5" width="17" height="17" rx="4" fill="#1f9d63" />
      <path d="M5 9.2l2.6 2.6L13 6.4" stroke="#ffffff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ size = 13, color = '#1f7a52' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="100 50 370 430" width={size} height={Math.round(size * 1.16)} aria-hidden="true">
      <path
        fill={color}
        d="M241 97V203.426C254.606 198.617 269.247 196 284.5 196C356.573 196 415 254.427 415 326.5C415 398.573 356.573 457 284.5 457C212.594 457 154.272 398.843 154.003 327H154V97H241ZM284.5 283C260.476 283 241 302.476 241 326.5C241 350.524 260.476 370 284.5 370C308.524 370 328 350.524 328 326.5C328 302.476 308.524 283 284.5 283Z"
      />
    </svg>
  )
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(iso + 'T12:00:00Z') : new Date(iso)
  return d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', ...opts })
}

/** Running head at the top of every sheet. */
export function RunHead({ doc, right }: { doc: PlanDoc; right: string }) {
  return (
    <div className="pd-runhead">
      <div className="pd-row-c" style={{ gap: 8 }}>
        <Logo />
        <strong>{doc.businessName}{doc.siteName ? ` · ${doc.siteName}` : ''}</strong>
        <span>HACCP Plan</span>
      </div>
      <span>{right}</span>
    </div>
  )
}

export function SheetFooter({ doc, note }: { doc: PlanDoc; note?: string }) {
  const signed = doc.signoff ? `Signed off by ${doc.signoff.name} · ${fmtDate(doc.signoff.at)}` : 'Not signed off'
  return (
    <div className="pd-footer">
      <span>{signed}{note ? ` · ${note}` : ''}</span>
      <span>blueroll.app</span>
    </div>
  )
}
