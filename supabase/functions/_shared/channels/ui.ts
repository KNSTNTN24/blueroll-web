// supabase/functions/_shared/channels/ui.ts
// Channel UI: turns the bot's intents (text, choices, form, corrective, manager alert) into channel payloads.
// WhatsApp routes through the existing builders in whatsapp.ts (payloads unchanged, sanitizeParam inherited).
import type { OutboundMessage } from './types.ts'
import { buttonsMessage, flowMessage, templateMessage, textMessage } from './whatsapp.ts'
import { tgButtons, tgText, tgWebAppButton } from './telegram.ts'
import { buildTelegramReminder } from './tg-reminder.ts'
import type { DueChecklist } from '../checklists-core/types.ts'

export type Channel = 'whatsapp' | 'telegram'
export interface FormRequest { templateName: string; token: string; flowId?: string }
export interface ManagerAlert { siteName: string; itemName: string; value: string; time: string; byName: string; action: string }
export type Command = 'checks' | 'stop' | 'help'

export interface ChannelUI {
  channel: Channel
  text(to: string, body: string): OutboundMessage
  /** At most 3 buttons are shown. */
  choices(to: string, body: string, buttons: { id: string; title: string }[]): OutboundMessage
  /** WhatsApp: Flow message (null without flowId). Telegram: web_app button to the Mini App with ?t=token. */
  form(to: string, f: FormRequest): OutboundMessage | null
  /** WhatsApp only (corrective Flow); Telegram captures corrective actions inside the Mini App form → null. */
  corrective(to: string, c: { token: string; flowId: string; itemName: string; valueText: string }): OutboundMessage | null
  managerAlert(to: string, a: ManagerAlert): { msg: OutboundMessage; templateName?: string }
  /**
   * Telegram only: one message listing a site's due checklists with a Mini App "Fill in" button per checklist that has a
   * token (null token = app only, listed as text). WhatsApp lists via `choices` (fill: buttons) instead → undefined.
   */
  dueForms?(to: string, d: { siteName: string; tz: string; items: DueChecklist[] }, tokens: Map<string, string | null>): OutboundMessage
  /** How the person types a command on this channel: 'CHECKS' (WhatsApp) vs '/checks' (Telegram). */
  commandWord(cmd: Command): string
}

const correctiveBody = (item: string) => `${item} is out of range. Tell us what you did.`

export function whatsappUI(): ChannelUI {
  return {
    channel: 'whatsapp',
    text: (to, body) => textMessage(to, body),
    choices: (to, body, buttons) => buttonsMessage(to, body, buttons),
    form: (to, f) => (f.flowId ? flowMessage(to, { flowId: f.flowId, token: f.token, cta: 'Fill in', body: f.templateName, screen: 'CHECKLIST' }) : null),
    corrective: (to, c) => flowMessage(to, {
      flowId: c.flowId, token: c.token, cta: 'Add action', body: correctiveBody(c.itemName), screen: 'CORRECTIVE',
      data: { item_name: c.itemName, value_text: c.valueText },
    }),
    managerAlert: (to, a) => ({
      msg: templateMessage(to, 'manager_alert', [a.siteName, a.itemName, a.value, a.time, a.byName, a.action], []),
      templateName: 'manager_alert',
    }),
    commandWord: (cmd) => cmd.toUpperCase(),
  }
}

export function telegramUI(miniAppBaseUrl: string): ChannelUI {
  return {
    channel: 'telegram',
    text: (to, body) => tgText(to, body),
    choices: (to, body, buttons) => tgButtons(to, body, buttons.slice(0, 3)),
    form: (to, f) => tgWebAppButton(to, f.templateName, [{ title: 'Fill in', url: `${miniAppBaseUrl}?t=${encodeURIComponent(f.token)}` }]),
    corrective: () => null,
    dueForms: (to, d, tokens) => buildTelegramReminder({ external_id: to, ...d }, tokens, miniAppBaseUrl),
    managerAlert: (to, a) => ({
      msg: tgText(to, `⚠ ${a.siteName} · ${a.itemName} ${a.value} at ${a.time} (${a.byName}). Action: ${a.action}. — via Blueroll`),
    }),
    commandWord: (cmd) => `/${cmd}`,
  }
}
