// supabase/functions/_shared/channels/live-list.ts
// Telegram live list (spec §4), pure: what one (group, site) list message says and when to edit or delete it.
import type { Template } from '../checklists-core/types.ts'
import { localParts } from '../checklists-core/time.ts'
import { escapeHtml, type TgKeyboard } from './telegram.ts'

export interface OpenLine { templateId: string; name: string; deadlineUtc: string | null; url: string | null }   // url null = app only
export interface DoneLine { templateId: string; name: string; completedAt: string; by: string | null }
export interface LiveListInput { siteName: string; tz: string; now: Date; open: OpenLine[]; done: DoneLine[] }
export interface RenderedList { text: string; keyboard: TgKeyboard; hash: string; openCount: number; doneCount: number }

export const DUE_SOON_MS = 30 * 60_000
export const BUTTON_MAX = 64
/** Telegram's limit is 4096 characters; keep a margin. */
export const TEXT_MAX = 4000

export function listIcon(deadlineUtc: string | null, now: Date): '🔴' | '🟠' | '⚪' {
  if (!deadlineUtc) return '⚪'
  const left = new Date(deadlineUtc).getTime() - now.getTime()
  if (left < 0) return '🔴'
  return left <= DUE_SOON_MS ? '🟠' : '⚪'
}

/** At most `max` characters (code points), with an ellipsis when cut. */
export function clip(s: string, max: number): string {
  const cps = [...s]
  return cps.length <= max ? s : cps.slice(0, max - 1).join('') + '…'
}

export const hhmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

export function localDate(now: Date, tz: string): string {
  const p = localParts(now, tz)
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const byOpenOrder = (a: OpenLine, b: OpenLine) => {
  // Overdue → due soon → later (all by deadline), then no deadline by name.
  if (a.deadlineUtc && b.deadlineUtc) return new Date(a.deadlineUtc).getTime() - new Date(b.deadlineUtc).getTime() || a.name.localeCompare(b.name)
  if (a.deadlineUtc) return -1
  if (b.deadlineUtc) return 1
  return a.name.localeCompare(b.name)
}

export async function renderLiveList(i: LiveListInput): Promise<RenderedList> {
  const open = [...i.open].sort(byOpenOrder)
  const done = [...i.done].sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime())
  const header = `📋 <b>${escapeHtml(i.siteName)}</b> — ${done.length} of ${open.length + done.length} done`
  const openLines = open.map((o) => {
    const parts = [`${listIcon(o.deadlineUtc, i.now)} ${escapeHtml(o.name)}`]
    if (o.deadlineUtc) parts.push(`due ${hhmm(o.deadlineUtc, i.tz)}`)
    if (!o.url) parts.push('app only')
    return parts.join(' · ')
  })
  const doneLines = done.map((x) => `✅ ${escapeHtml(x.name)} · ${hhmm(x.completedAt, i.tz)}${x.by ? ` ${escapeHtml(x.by)}` : ''}`)
  let text = [header, ...openLines, ...doneLines].join('\n')
  if (text.length > TEXT_MAX && done.length) text = [header, ...openLines, `✅ ${done.length} done`].join('\n')
  const keyboard: TgKeyboard = open.filter((o) => o.url).map((o) => [{ text: clip(`${listIcon(o.deadlineUtc, i.now)} ${o.name}`, BUTTON_MAX), url: o.url! }])
  return { text, keyboard, hash: await sha256Hex(JSON.stringify({ text, keyboard })), openCount: open.length, doneCount: done.length }
}

export type RefreshDecision = 'delete_stale' | 'delete_done' | 'unchanged' | 'edit'

/** Spec §4 refresh steps 1–4, in order. */
export function refreshDecision(a: { listDate: string; today: string; openCount: number; storedHash: string | null; newHash: string }): RefreshDecision {
  if (a.listDate !== a.today) return 'delete_stale'
  if (a.openCount === 0) return 'delete_done'
  if (a.storedHash === a.newHash) return 'unchanged'
  return 'edit'
}

/** Sites that get a list for a group: at least one active mapped checklist applies there. */
export function sitesForGroup<S extends { id: string }>(templates: Pick<Template, 'site_id' | 'active'>[], sites: S[]): S[] {
  return sites.filter((s) => templates.some((t) => t.active && (t.site_id === null || t.site_id === s.id)))
}
