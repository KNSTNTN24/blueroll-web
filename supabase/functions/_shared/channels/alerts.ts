// supabase/functions/_shared/channels/alerts.ts
// Out-of-range alerts. alertManagers: every active owner/manager linked on WhatsApp gets the alert there, provided the
// business can use WhatsApp right now (channel_ready). alertGroups: Telegram alerts go to groups, never personal chats.
// Pure over AlertDeps / GroupDeps (unit-tested with fakes);
// makeAlertDeps is the Supabase-backed implementation (`admin` = service-role client, typed loosely).
import type { SendFn } from './types.ts'
import { isBillable } from './bot.ts'
import { telegramUI, whatsappUI, type Channel, type ChannelUI, type ManagerAlert } from './ui.ts'

export { TG_MINI_APP_URL } from './telegram.ts'
import { TG_MINI_APP_URL, tgText, tgOutcome, type TgApi } from './telegram.ts'
import type { GroupDeps, ChannelGroup } from './groups-db.ts'

export interface AlertRecipient { channel: Channel; external_id: string; last_inbound_at: string | null }
export interface AlertLogRow {
  business_id: string; site_id: null; profile_id: null; channel: Channel; direction: 'out'; kind: 'alert'
  template_name?: string; billable: boolean; wa_message_id: string | null
}
export interface AlertDeps {
  /** WhatsApp identities of active owners/managers. Telegram alerts go to groups (alertGroups), never to personal chats. */
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

/** Plain text (no parse mode), same wording as the old personal Telegram manager alert. */
export const groupAlertText = (a: ManagerAlert) =>
  `⚠ ${a.siteName} · ${a.itemName} ${a.value} at ${a.time} (${a.byName}). Action: ${a.action}. — via Blueroll`

/** Spec §2: the group where the check was filled in + every group marked "Alerts" in that business, once each. */
export async function alertGroups(g: Pick<GroupDeps, 'groupById' | 'alertGroups' | 'markGroupUnlinked' | 'now'>, api: TgApi, businessId: string, sourceGroupId: string | null, a: ManagerAlert): Promise<void> {
  const targets = new Map<string, ChannelGroup>()
  if (sourceGroupId) {
    const src = await g.groupById(sourceGroupId)
    if (src && src.business_id === businessId) targets.set(src.id, src)
  }
  for (const x of await g.alertGroups(businessId)) targets.set(x.id, x)
  for (const t of targets.values()) {
    try {
      const r = await api('sendMessage', tgText(t.chat_id, groupAlertText(a)))
      // Bot removed from an alerts group without us hearing about it: unlink; the cron takes its lists down.
      if (!r.ok && tgOutcome(r) === 'kicked') await g.markGroupUnlinked(t.id, g.now())
      else if (!r.ok) console.error('group alert failed', t.chat_id, r.status)
    } catch (err) {
      console.error('group alert failed', t.chat_id, String((err as Error)?.message ?? err).slice(0, 200))
    }
  }
}

export type TelegramAlertGroups = { g: Pick<GroupDeps, 'ready' | 'groupById' | 'alertGroups' | 'markGroupUnlinked' | 'now'>; api: TgApi }

/**
 * Out-of-range alert from a WhatsApp submission (spec §2): every Telegram group marked "Alerts" in the business, while the
 * business can use Telegram. There is no source group. Best effort: never throws, so the WhatsApp flow is never failed.
 */
export async function alertTelegramAlertsGroups(t: TelegramAlertGroups, businessId: string, a: ManagerAlert): Promise<void> {
  try {
    if (!(await t.g.ready(businessId))) return
    await alertGroups(t.g, t.api, businessId, null, a)
  } catch (err) {
    console.error('telegram alerts-group alert failed', String((err as Error)?.message ?? err).slice(0, 200))
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
        .eq('business_id', b).is('revoked_at', null).in('profile_id', mgr).eq('channel', 'whatsapp'))
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
