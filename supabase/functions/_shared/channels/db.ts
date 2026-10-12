// supabase/functions/_shared/channels/db.ts
// Supabase-backed BotDeps. `admin` is a service-role supabase-js client (typed loosely to keep this file import-free).
// Never log raw phone numbers / chat ids from here — use maskId.
import type { BotDeps, FormToken } from './bot.ts'
import type { TeamDeps } from './teams-db.ts'
import type { CoreDb } from '../checklists-core/record.ts'
import type { Person } from '../checklists-core/types.ts'
import type { SendFn } from './types.ts'
import type { Channel, ChannelUI } from './ui.ts'
import { alertManagers, alertTelegramAlertsGroups, makeAlertDeps, type Senders, type TelegramAlertGroups } from './alerts.ts'

const IDENTITY_COLS = 'id, business_id, profile_id, external_id'

/** Hex SHA-256 of a phone number — used as ref_id for link-failure rows so the raw number is never stored there. */
export async function hashExternalId(externalId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(externalId))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** PostgREST caps a response at 1000 rows by default. */
export const PAGE_SIZE = 1000

/**
 * Fetch every row of a query page by page. `fetchPage(from, to)` must apply a stable order and `.range(from, to)`.
 * Stops at the first page shorter than PAGE_SIZE.
 */
// deno-lint-ignore no-explicit-any
export async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
}

const TOKEN_COLS = 'token, kind, business_id, profile_id, site_id, template_id, item_ids, response_id, expires_at, used_at, group_id'

/**
 * Read-only form-token lookup (never consumes). Returns the row in any state — the caller checks ownership FIRST,
 * then used/expired/kind (form-api.ts), so a non-owner learns nothing about the token.
 */
// deno-lint-ignore no-explicit-any
export async function peekToken(admin: any, token: string): Promise<FormToken | null> {
  const { data, error } = await admin.from('channel_form_tokens').select(TOKEN_COLS).eq('token', token).maybeSingle()
  if (error) throw error
  return (data as FormToken | null) ?? null
}

/** Undo a take after a failed record: only the exact take (same used_at) is released. */
// deno-lint-ignore no-explicit-any
export async function releaseToken(admin: any, token: string, usedAtIso: string): Promise<void> {
  const { error } = await admin.from('channel_form_tokens').update({ used_at: null }).eq('token', token).eq('used_at', usedAtIso)
  if (error) throw error
}

/** The DB calls every channel's checklist recording shares (CoreDb) plus the person lookup. Channel-neutral. */
export interface CoreDbWithPerson extends CoreDb {
  person(profileId: string): Promise<Person | null>
}

// deno-lint-ignore no-explicit-any
export function makeCoreDb(admin: any): CoreDbWithPerson {
  // deno-lint-ignore no-explicit-any
  const one = async (q: any) => { const { data, error } = await q; if (error) throw error; return data }
  return {
    person: async (pid) => {
      const p = await one(admin.from('profiles').select('id, business_id, full_name, role, role_id')
        .eq('id', pid).is('removed_at', null).maybeSingle())
      return p && p.business_id
        ? { profile_id: p.id, business_id: p.business_id, full_name: p.full_name ?? '', role: p.role, role_id: p.role_id ?? null }
        : null
    },
    insertCompletion: async (row) => await one(admin.from('checklist_completions').insert(row).select('id').single()),
    insertResponses: async (rows) => rows.length ? ((await one(admin.from('checklist_responses').insert(rows).select('id, item_id'))) ?? []) : [],
    // Active (not soft-removed) owners/managers — parity with web getManagerIds + soft-remove.
    managerIds: async (b) =>
      ((await one(admin.from('profiles').select('id').eq('business_id', b).in('role', ['owner', 'manager']).is('removed_at', null))) ?? [])
        // deno-lint-ignore no-explicit-any
        .map((p: any) => p.id),
    insertNotifications: async (rows) => { if (rows.length) await one(admin.from('notifications').insert(rows)) },
  }
}

export interface DepsConfig {
  channel: Channel
  ui: ChannelUI
  /** Replies on `channel`. */
  send: SendFn
  /** WhatsApp corrective Flow id (unused on Telegram). */
  correctiveFlowId?: string
  /** Senders for cross-channel manager alerts; defaults to `{ [channel]: send }`. */
  senders?: Senders
  /** Telegram "Alerts" groups that also get this channel's out-of-range alerts (spec §2); omitted = none. */
  telegramAlertGroups?: TelegramAlertGroups
  /** WhatsApp teams (teams-db.ts makeTeamDeps). */
  teams: TeamDeps
}

// deno-lint-ignore no-explicit-any
export function makeDeps(admin: any, cfg: DepsConfig): BotDeps {
  // deno-lint-ignore no-explicit-any
  const one = async (q: any) => { const { data, error } = await q; if (error) throw error; return data }

  const core = makeCoreDb(admin)
  const clock = () => new Date()
  const ch = cfg.channel
  const channelReady = async (b: string) => !!(await one(admin.rpc('channel_ready', { b, ch })))
  const alertDeps = makeAlertDeps(admin)
  const senders: Senders = cfg.senders ?? { [ch]: cfg.send }

  return {
    channel: ch,
    ui: cfg.ui,
    now: clock,
    send: cfg.send,
    newToken: () => crypto.randomUUID().replace(/-/g, ''),
    correctiveFlowId: () => cfg.correctiveFlowId ?? '',
    teams: cfg.teams,

    findIdentity: async (x) => (await one(admin.from('channel_identities').select(IDENTITY_COLS)
      .eq('channel', ch).eq('external_id', x).is('revoked_at', null).maybeSingle())) ?? null,
    touchIdentity: async (id, at) => { await one(admin.from('channel_identities').update({ last_inbound_at: at.toISOString() }).eq('id', id)) },
    revokeIdentity: async (id) => {
      await one(admin.from('channel_identities').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null))
    },

    ready: channelReady,

    person: core.person,

    items: async (tid) => (await one(admin.from('checklist_template_items')
      .select('id, name, item_type, required, min_value, max_value, unit, sort_order').eq('template_id', tid))) ?? [],
    // WhatsApp Flows only; Telegram renders the Mini App form from the current items.
    flowFor: async (tid, sid) => {
      if (ch !== 'whatsapp') return null
      const f = await one(admin.from('channel_flows').select('flow_id, item_ids, items_hash, status')
        .eq('template_id', tid).eq('site_id', sid).eq('channel', ch).maybeSingle())
      return f && f.status === 'published' && f.flow_id ? { flow_id: f.flow_id, item_ids: f.item_ids ?? [], items_hash: f.items_hash } : null
    },

    saveToken: async (t: FormToken) => { await one(admin.from('channel_form_tokens').insert(t)) },
    // One atomic UPDATE: only the owner's unused, unexpired token is consumed.
    takeToken: async (token, now, profileId) => {
      const nowIso = now.toISOString()
      const rows = await one(admin.from('channel_form_tokens').update({ used_at: nowIso })
        .eq('token', token).eq('profile_id', profileId).is('used_at', null).gt('expires_at', nowIso)
        .select(TOKEN_COLS))
      return (rows?.[0] as FormToken | undefined) ?? null
    },

    setCorrective: async (rid, notes) => {
      const r = await one(admin.from('checklist_responses').update({ notes, corrective_status: 'done' })
        .eq('id', rid).eq('corrective_status', 'needed')
        .select('value, item:checklist_template_items(name, unit, item_type), completion:checklist_completions(business_id, site_id, completed_by, template:checklist_templates(name))')
        .maybeSingle())
      if (!r || !r.completion) return null
      const site = r.completion.site_id ? await one(admin.from('sites').select('name').eq('id', r.completion.site_id).maybeSingle()) : null
      const by = r.completion.completed_by ? await one(admin.from('profiles').select('full_name').eq('id', r.completion.completed_by).maybeSingle()) : null
      return {
        templateName: r.completion.template?.name ?? '', itemName: r.item?.name ?? '', value: r.value ?? '',
        unit: r.item?.unit ?? (r.item?.item_type === 'temperature' ? '°C' : null),
        siteName: site?.name ?? '', byName: by?.full_name ?? '', businessId: r.completion.business_id,
      }
    },

    alertManagers: async (b, a) => {
      try { await alertManagers(alertDeps, senders, b, a, clock()) }
      finally { if (cfg.telegramAlertGroups) await alertTelegramAlertsGroups(cfg.telegramAlertGroups, b, a) }   // never throws
    },

    log: async (e) => {
      const { error } = await admin.from('channel_messages_log').insert({ ...e, channel: ch })
      if (!error) return true
      // uq_channel_inbound_msg: this inbound message id was already logged → duplicate webhook delivery.
      if (e.direction === 'in' && error.code === '23505') return false
      console.error('channel_messages_log insert failed', e.kind, (error.message ?? '').slice(0, 200))
      return true
    },

    pendingCorrective: async (pid) => {
      const since = new Date(clock().getTime() - 2 * 86400_000).toISOString()
      const rows = await one(admin.from('checklist_responses')
        .select('id, value, item:checklist_template_items(id, name, item_type, required, min_value, max_value, unit, sort_order), completion:checklist_completions!inner(site_id, template_id, completed_by, completed_at, source)')
        .eq('corrective_status', 'needed').eq('completion.completed_by', pid).eq('completion.source', ch)
        .gte('completion.completed_at', since))
      // deno-lint-ignore no-explicit-any
      return ((rows ?? []) as any[])
        .filter((r) => r.item && r.completion?.site_id)
        .sort((a, b) => String(a.completion.completed_at).localeCompare(String(b.completion.completed_at)))
        .map((r) => ({ response_id: r.id, item: r.item, value: r.value ?? '', site_id: r.completion.site_id, template_id: r.completion.template_id }))
    },

    insertCompletion: core.insertCompletion,
    insertResponses: core.insertResponses,
    managerIds: core.managerIds,
    insertNotifications: core.insertNotifications,
  }
}
