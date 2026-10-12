// "What's due" menu for one site (WhatsApp `checks` reply), pure: header with progress, every open checklist with its
// deadline and 🔴/🟠/⚪, done ones with ✅ and time, and one menu row per open checklist (WhatsApp list message limits).
import { clip, hhmm, listIcon } from './live-list.ts'

export interface MenuOpen { templateId: string; name: string; deadlineUtc: string | null }
export interface MenuDone { name: string; completedAt: string }
export interface DueMenuInput { siteId: string; siteName: string; tz: string; now: Date; open: MenuOpen[]; done: MenuDone[] }
export interface MenuRow { id: string; title: string; description: string }
export interface DueMenu { header: string; body: string; footer: string; button: string; rows: MenuRow[] }

// developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages: header text ≤60, body ≤4096 (we keep
// it short), footer ≤60, button ≤20, ≤10 rows, row title ≤24, description ≤72, id ≤200.
export const MENU_ROWS_MAX = 10
const HEADER_MAX = 60
const BODY_MAX = 1024
const ROW_TITLE_MAX = 24
const ROW_DESC_MAX = 72

const byDeadline = (a: MenuOpen, b: MenuOpen) => {
  if (a.deadlineUtc && b.deadlineUtc) return new Date(a.deadlineUtc).getTime() - new Date(b.deadlineUtc).getTime() || a.name.localeCompare(b.name)
  if (a.deadlineUtc) return -1
  if (b.deadlineUtc) return 1
  return a.name.localeCompare(b.name)
}

function status(icon: string): string {
  return icon === '🔴' ? ' · overdue' : icon === '🟠' ? ' · due soon' : ''
}

export function renderDueMenu(i: DueMenuInput): DueMenu {
  const open = [...i.open].sort(byDeadline)
  const done = [...i.done].sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime())
  const total = open.length + done.length
  const lines = [
    ...open.map((o) => `${listIcon(o.deadlineUtc, i.now)} ${o.name}${o.deadlineUtc ? ` — due ${hhmm(o.deadlineUtc, i.tz)}` : ''}`),
    ...done.map((x) => `✅ ${x.name} — ${hhmm(x.completedAt, i.tz)}`),
  ]
  const shown = open.slice(0, MENU_ROWS_MAX)
  const more = open.length > shown.length ? `\n+${open.length - shown.length} more — send CHECKS again after these` : ''
  const rows = shown.map((o) => {
    const icon = listIcon(o.deadlineUtc, i.now)
    const title = clip(o.name, ROW_TITLE_MAX)
    const when = o.deadlineUtc ? `Due ${hhmm(o.deadlineUtc, i.tz)}${status(icon)}` : 'No deadline'
    // A cut title is completed in the description so the full name is still readable.
    const desc = title === o.name ? `${icon} ${when}` : `${icon} ${when} · ${o.name}`
    return { id: `fill:${o.templateId}:${i.siteId}`, title, description: clip(desc, ROW_DESC_MAX) }
  })
  return {
    header: clip(`📋 ${i.siteName} — ${done.length} of ${total} done`, HEADER_MAX),
    body: clip(lines.join('\n'), BODY_MAX - [...more].length) + more,   // the "+N more" line always survives the cut
    footer: 'Forms open on your phone',
    button: 'Choose a check',
    rows,
  }
}
