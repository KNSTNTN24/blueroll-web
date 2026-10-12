// src/lib/whatsapp/__tests__/fakes/team-bot-deps.ts
// BotDeps for the WhatsApp team bot tests, built over the in-memory TeamDeps fake (identities, people, completions shared).
import type { BotDeps, FormToken, PendingCorrective } from '../../../../../supabase/functions/_shared/channels/bot'
import type { TemplateItem } from '../../../../../supabase/functions/_shared/checklists-core/types'
import { whatsappUI } from '../../../../../supabase/functions/_shared/channels/ui'
import { itemsHash } from '../../../../../supabase/functions/_shared/channels/whatsapp-flows'
import { fakeTeamDeps, fakeSend, TEMP_ITEM, type FakeTeamState } from './team-deps'

export const textOf = (m: any): string | undefined => m?.text?.body ?? m?.interactive?.body?.text

export function fakeTeamBot(init: Partial<FakeTeamState> = {}, over: Partial<BotDeps> = {}) {
  const { d: teams, s } = fakeTeamDeps(init)
  const { send, sent } = fakeSend()
  const tokens = new Map<string, FormToken>()
  const items: Record<string, TemplateItem[]> = {}
  /** Published flow per template; undefined = published for the template's CURRENT items; null = no flow. */
  const flows: Record<string, { flow_id: string; item_ids: string[]; items_hash: string } | null> = {}
  const pending: PendingCorrective[] = []
  const corrective: { rid: string; notes: string }[] = []
  const inbound = new Set<string>()
  let n = 0
  const itemsOf = (tid: string) => items[tid] ?? [TEMP_ITEM]
  const d: BotDeps = {
    channel: 'whatsapp', ui: whatsappUI(), now: () => s.now, send, newToken: () => `tok${++n}`,
    findIdentity: async (x) => {
      const i = s.identities.find((y) => y.phone === x && !y.revoked)
      return i ? { id: i.id, business_id: i.business_id, profile_id: i.profile_id, external_id: x } : null
    },
    touchIdentity: async (id, at) => { const i = s.identities.find((y) => y.id === id); if (i) i.last_inbound_at = at.toISOString() },
    revokeIdentity: async (id) => { const i = s.identities.find((y) => y.id === id); if (i) i.revoked = true },
    ready: teams.ready,
    person: teams.person,
    items: async (tid) => itemsOf(tid),
    flowFor: async (tid) => {
      if (flows[tid] !== undefined) return flows[tid]
      const t = s.templates.find((x) => x.id === tid)!
      return { flow_id: 'F1', item_ids: itemsOf(tid).filter((i) => i.item_type !== 'photo').map((i) => i.id), items_hash: await itemsHash(t.name, itemsOf(tid)) }
    },
    correctiveFlowId: () => 'FC',
    saveToken: async (t) => { tokens.set(t.token, { ...t }) },
    takeToken: async (tok, now, pid) => {
      const t = tokens.get(tok)
      if (!t || t.used_at || t.profile_id !== pid || new Date(t.expires_at) <= now) return null
      t.used_at = now.toISOString(); return { ...t }
    },
    setCorrective: async (rid, notes) => { corrective.push({ rid, notes }); return { templateName: 'Fridge temps', itemName: 'Walk-in fridge', value: '9', unit: '°C', siteName: 'Ashfield Row', byName: 'Anna Smith', businessId: 'b' } },
    alertManagers: async () => {},
    log: async (e) => {
      if (e.direction === 'in' && e.wa_message_id) { if (inbound.has(e.wa_message_id)) return false; inbound.add(e.wa_message_id) }
      return true
    },
    pendingCorrective: async () => pending,
    insertCompletion: teams.insertCompletion, insertResponses: teams.insertResponses, managerIds: teams.managerIds, insertNotifications: teams.insertNotifications,
    teams,
    ...over,
  }
  return { d, s, sent, tokens, items, flows, pending, corrective }
}
