// supabase/functions/_shared/channels/tg-reminder.ts
// Telegram reminder message (pure): one message per reminder job with one Mini App "Fill in <name>" button per checklist.
// A checklist without a token (e.g. a required photo item) gets no button and is marked "app only" in the text.
import type { DueChecklist } from '../checklists-core/types.ts'
import type { OutboundMessage } from './types.ts'
import { tgText, tgWebAppButton } from './telegram.ts'
import { TG_MINI_APP_URL } from './alerts.ts'

export interface TelegramReminderJob { external_id: string; siteName: string; tz: string; items: DueChecklist[] }

const BUTTON_MAX = 64

const hhmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

/** At most `max` characters (code points), with an ellipsis when cut. */
function clip(s: string, max: number): string {
  const cps = [...s]
  return cps.length <= max ? s : cps.slice(0, max - 1).join('') + '…'
}

/** `tokens`: template id → checklist form token (missing/null = can only be completed in the app). */
export function buildTelegramReminder(job: TelegramReminderJob, tokens: Map<string, string | null>, baseUrl = TG_MINI_APP_URL): OutboundMessage {
  const time = (d: DueChecklist) => (d.deadline_utc ? hhmm(d.deadline_utc, job.tz) : '')
  const buttons = job.items.flatMap((d) => {
    const t = tokens.get(d.template.id)
    return t ? [{ title: clip(`Fill in ${d.template.name}`, BUTTON_MAX), url: `${baseUrl}?t=${encodeURIComponent(t)}` }] : []
  })
  let text: string
  if (job.items.length === 1) {
    const d = job.items[0]
    text = `${d.template.name} is due at ${time(d)} at ${job.siteName}.`
    if (!tokens.get(d.template.id)) text += ' It can only be completed in the Blueroll app.'
  } else {
    const names = job.items.map((d) => `${d.template.name} (${time(d)}${tokens.get(d.template.id) ? '' : ', app only'})`)
    text = `${job.items.length} checks due at ${job.siteName}: ${names.join(', ')}`
  }
  return buttons.length ? tgWebAppButton(job.external_id, text, buttons) : tgText(job.external_id, text)
}
