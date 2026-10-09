// supabase/functions/_shared/channels/alerts.ts
// Manager alerts across channels: every active owner/manager linked on ANY channel gets the alert on that channel,
// provided the business can use that channel right now (channel_ready). Pure over AlertDeps (unit-tested with fakes);
// makeAlertDeps is the Supabase-backed implementation (`admin` = service-role client, typed loosely).
import type { SendFn } from './types.ts'
import { isBillable } from './bot.ts'
import { telegramUI, whatsappUI, type Channel, type ChannelUI, type ManagerAlert } from './ui.ts'

export const TG_MINI_APP_URL = 'https://app.blueroll.app/tg/form'

export interface AlertRecipient { channel: Channel; external_id: string; last_inbound_at: string | null }
export interface AlertLogRow {
  business_id: string; site_id: null; profile_id: null; channel: Channel; direction: 'out'; kind: 'alert'
  template_name?: string; billable: boolean; wa_message_id: string | null
}
export interface AlertDeps {
  /** Linked (non-revoked) identities of active owners/managers of the business, on every channel. */
  managerRecipients(businessId: string): Promise<AlertRecipient[]>
  /** channel_ready(b, ch): entitled and the channel is enabled for the business. */
  ready(businessId: string, channel: Channel): Promise<boolean>
  log(e: AlertLogRow): Promise<void>
}
export type Senders = Partial<Record<Channel, SendFn>>

export const uiFor = (ch: Channel): ChannelUI => (ch === 'telegram' ? telegramUI(TG_MINI_APP_URL) : whatsappUI())

export async function alertManagers(deps: AlertDeps, senders: Senders, businessId: string, a: ManagerAlert, now: Date): Promise<void> {
  const ready = new Map<Channel, boolean>()
  for (const m of await deps.managerRecipients(businessId)) {
    const send = senders[m.channel]
    if (!send) continue   // this function can't reach that channel (e.g. no token configured here)
    try {
      if (!ready.has(m.channel)) {
        try { ready.set(m.channel, await deps.ready(businessId, m.channel)) }
        catch (err) { ready.set(m.channel, false); console.error('alert ready check failed', m.channel, String((err as Error)?.message ?? err).slice(0, 200)) }
      }
      if (!ready.get(m.channel)) continue
      const { msg, templateName } = uiFor(m.channel).managerAlert(m.external_id, a)
      const r = await send(msg)
      // Only WhatsApp templates outside the 24h service window cost money; Telegram never does.
      await deps.log({ business_id: businessId, site_id: null, profile_id: null, channel: m.channel, direction: 'out', kind: 'alert',
        template_name: templateName, billable: m.channel === 'whatsapp' && !!templateName && r.ok && isBillable(m.last_inbound_at, now), wa_message_id: r.id })
    } catch (err) {
      console.error('manager alert failed', m.channel, String((err as Error)?.message ?? err).slice(0, 200))   // one recipient must not abort the rest
    }
  }
}

// deno-lint-ignore no-explicit-any
export function makeAlertDeps(admin: any): AlertDeps {
  // deno-lint-ignore no-explicit-any
  const one = async (q: any) => { const { data, error } = await q; if (error) throw error; return data }
  return {
    managerRecipients: async (b) => {
      // Active (not soft-removed) owners/managers — parity with web getManagerIds + soft-remove.
      // deno-lint-ignore no-explicit-any
      const mgr: string[] = ((await one(admin.from('profiles').select('id').eq('business_id', b).in('role', ['owner', 'manager']).is('removed_at', null))) ?? []).map((p: any) => p.id)
      if (!mgr.length) return []
      const ids = await one(admin.from('channel_identities').select('channel, external_id, last_inbound_at')
        .eq('business_id', b).is('revoked_at', null).in('profile_id', mgr).in('channel', ['whatsapp', 'telegram']))
      // deno-lint-ignore no-explicit-any
      return (ids ?? []).map((i: any) => ({ channel: i.channel as Channel, external_id: i.external_id, last_inbound_at: i.last_inbound_at ?? null }))
    },
    ready: async (b, ch) => !!(await one(admin.rpc('channel_ready', { b, ch }))),
    log: async (e) => {
      const { error } = await admin.from('channel_messages_log').insert(e)
      if (error) console.error('channel_messages_log insert failed', e.kind, e.channel, (error.message ?? '').slice(0, 200))
    },
  }
}
