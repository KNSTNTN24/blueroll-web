// supabase/functions/_shared/channels/teams-db.ts
// WhatsApp teams (spec 2026-10-12 §7): the data contract (TeamDeps) for membership, the day planner cron, the bot and
// the Settings API, plus its Supabase-backed implementation. `admin` = service-role supabase-js client (typed loosely).
// Never log phone numbers from here (maskPhone).
import type { CoreDb } from '../checklists-core/record.ts'
import type { Person, Template } from '../checklists-core/types.ts'
import type { SiteInfo } from './bot.ts'
import { makeCoreDb, pageAll } from './db.ts'
import { type CompletionWho, completionsWhoSince, firstNamesOf, mappedTemplates } from './groups-db.ts'
import { createChannelOnlyMember, defaultStaffRole } from './members.ts'
import { firstName } from './team-text.ts'

// deno-lint-ignore no-explicit-any
type Any = any

export type MemberStatus = 'invited' | 'active' | 'removed'
export interface Team { id: string; business_id: string; title: string; site_id: string }
export interface TeamMember {
  id: string; group_id: string; profile_id: string; phone: string; status: MemberStatus; full_name: string
  invited_by: string | null; invited_at: string; joined_at: string | null; removed_at: string | null
  last_invite_sent_at: string | null; unreachable_at: string | null
}
export interface TeamRecipient { member_id: string; profile_id: string; phone: string; first_name: string; last_inbound_at: string | null }
export interface ManagerContact { profile_id: string; phone: string; last_inbound_at: string | null }
export interface WaIdentity { id: string; business_id: string; profile_id: string; last_inbound_at: string | null }
export interface TakeKey { group_id: string; template_id: string; site_id: string; period_key: string }
export interface ChannelLog {
  business_id: string | null; site_id: string | null; profile_id: string | null; direction: 'in' | 'out'; kind: string
  template_name?: string; billable: boolean; ref_id?: string; wa_message_id?: string | null
}

export interface TeamDeps extends CoreDb {
  now(): Date
  /** channel_ready(b, 'whatsapp') */
  ready(businessId: string): Promise<boolean>
  businessName(businessId: string): Promise<string>
  /** Every WhatsApp team not deleted, at a site not removed (cron). */
  liveTeams(): Promise<Team[]>
  /** Not deleted, site not removed, by title. */
  teamsForBusiness(businessId: string): Promise<Team[]>
  /** WhatsApp, not deleted, site not removed. */
  teamById(groupId: string): Promise<Team | null>
  /** Mapped, active, same business, site_id null or team.site_id. */
  teamTemplates(team: Team): Promise<Template[]>
  /** Not removed. */
  site(siteId: string): Promise<SiteInfo | null>
  /** Every status, invited_at order. */
  members(groupId: string): Promise<TeamMember[]>
  memberById(memberId: string): Promise<TeamMember | null>
  memberFor(groupId: string, profileId: string): Promise<TeamMember | null>
  /** Status 'active' in WhatsApp teams not deleted, at a site not removed. */
  activeMemberships(profileId: string): Promise<TeamMember[]>
  /** → status 'invited' (keeps last_invite_sent_at). */
  upsertInvited(a: { group_id: string; profile_id: string; phone: string; invited_by: string | null; now: Date }): Promise<TeamMember>
  /** Atomic: last_invite_sent_at null or ≤ now − 1 h → now. */
  claimInviteSend(memberId: string, now: Date): Promise<boolean>
  releaseInviteSend(memberId: string, claimedAtIso: string, previous: string | null): Promise<void>
  /** invited → active (joined_at = now, unreachable cleared). */
  activateMember(memberId: string, now: Date): Promise<boolean>
  /** invited|active → removed. */
  removeMember(memberId: string, now: Date): Promise<boolean>
  /** Every non-removed member row with this phone. */
  setUnreachable(phone: string, at: Date | null): Promise<void>
  /** Active WhatsApp identity of this number (any business). */
  identityByPhone(phone: string): Promise<WaIdentity | null>
  /** consent_source 'team_invite'. */
  linkIdentity(a: { business_id: string; profile_id: string; phone: string; linked_by: string | null; now: Date }): Promise<void>
  /** Channel-only profile id. */
  createStaffMember(a: { businessId: string; siteId: string; fullName: string }): Promise<string>
  /** Active owner/manager. */
  isManager(profileId: string, businessId: string): Promise<boolean>
  person(profileId: string): Promise<Person | null>
  firstNames(profileIds: string[]): Promise<Map<string, string>>
  /** Active members with an active identity in the team's business. */
  recipients(team: Team): Promise<TeamRecipient[]>
  /** Active owners/managers linked on WhatsApp. */
  managerContacts(businessId: string): Promise<ManagerContact[]>
  completionsSince(businessId: string, since: Date): Promise<CompletionWho[]>
  claimEvent(groupId: string, kind: string, key: string): Promise<boolean>
  releaseEvent(groupId: string, kind: string, key: string): Promise<void>
  /**
   * First submit wins across teams (spec §2): one all-or-nothing multi-row INSERT of a take for `k.group_id` AND every
   * other live WhatsApp team that maps `k.template_id` at `k.site_id`, same period. A conflict on any row = lost (false).
   */
  claimTake(k: TakeKey, profileId: string, now: Date): Promise<boolean>
  /** Who holds the take of this checklist/site/period — in any team (k.group_id is not filtered on). */
  takeOwner(k: TakeKey): Promise<{ profile_id: string | null; taken_at: string } | null>
  /** Deletes every team's row of this checklist/site/period held by `profileId` (the whole claim). */
  releaseTake(k: TakeKey, profileId: string): Promise<void>
  /** channel_messages_log, channel 'whatsapp'; never throws. */
  log(e: ChannelLog): Promise<void>
}

/** channel_group_members has two FKs to profiles (profile_id, invited_by): embeds must name this one. */
export const MEMBER_PROFILE_FK = 'channel_group_members_profile_id_fkey'
export const INVITE_RESEND_MS = 3600_000
/** Teams carry their site embed so soft-removed sites (removed_at, or legacy status 'removed') are skipped. */
const TEAM_COLS = 'id, business_id, title, site_id, site:sites!inner(removed_at, status)'
const MEMBER_COLS = `id, group_id, profile_id, phone, status, invited_by, invited_at, joined_at, removed_at, last_invite_sent_at, unreachable_at, profile:profiles!${MEMBER_PROFILE_FK}(full_name)`

export function makeTeamDeps(admin: Any): TeamDeps {
  const one = async (q: Any) => { const { data, error } = await q; if (error) throw error; return data }
  const errMsg = (e: Any) => String(e?.message ?? e).slice(0, 200)
  const core = makeCoreDb(admin)
  const asMember = (r: Any): TeamMember => { const { profile, ...m } = r; return { ...m, full_name: String(profile?.full_name ?? '') } }
  const liveSite = (r: Any) => r.site?.status !== 'removed'
  const asTeam = (r: Any): Team => ({ id: r.id, business_id: r.business_id, title: r.title, site_id: r.site_id })
  const teams = () => admin.from('channel_groups').select(TEAM_COLS).eq('channel', 'whatsapp').is('unlinked_at', null).is('site.removed_at', null)
  /** Insert-as-claim: true = this caller claimed the key(s); a duplicate (23505) = someone already did. */
  const claimInsert = async (table: string, rows: Record<string, unknown> | Record<string, unknown>[]) => {
    const { error } = await admin.from(table).insert(rows)
    if (!error) return true
    if (error.code === '23505') return false
    throw error
  }
  const TAKE_LOST = new Set(['23505', '40P01'])   // duplicate key, or a deadlock with a concurrent claim of the same take

  return {
    now: () => new Date(),
    ready: async (b) => !!(await one(admin.rpc('channel_ready', { b, ch: 'whatsapp' }))),
    businessName: async (b) => (await one(admin.from('businesses').select('name').eq('id', b).maybeSingle()))?.name || 'your team',

    liveTeams: async () => (await pageAll<Any>((from, to) => teams().order('id').range(from, to))).filter(liveSite).map(asTeam),
    teamsForBusiness: async (b) => (((await one(teams().eq('business_id', b).order('title'))) ?? []) as Any[]).filter(liveSite).map(asTeam),
    teamById: async (id) => {
      const r = await one(teams().eq('id', id).maybeSingle())
      return r && liveSite(r) ? asTeam(r) : null
    },
    teamTemplates: async (team) => (await mappedTemplates(admin, team.id))
      .filter((t) => t.business_id === team.business_id && (t.site_id === null || t.site_id === team.site_id)),
    site: async (id) => {
      const s = await one(admin.from('sites').select('id, name, timezone, status').eq('id', id).is('removed_at', null).maybeSingle())
      return s && s.status !== 'removed' ? { id: s.id, name: s.name ?? '', timezone: s.timezone ?? 'Europe/London' } : null
    },

    members: async (gid) => ((await one(admin.from('channel_group_members').select(MEMBER_COLS).eq('group_id', gid).order('invited_at'))) ?? []).map(asMember),
    memberById: async (id) => { const r = await one(admin.from('channel_group_members').select(MEMBER_COLS).eq('id', id).maybeSingle()); return r ? asMember(r) : null },
    memberFor: async (gid, pid) => {
      const r = await one(admin.from('channel_group_members').select(MEMBER_COLS).eq('group_id', gid).eq('profile_id', pid).maybeSingle())
      return r ? asMember(r) : null
    },
    activeMemberships: async (pid) => {
      const rows = await one(admin.from('channel_group_members')
        .select(`${MEMBER_COLS}, team:channel_groups!inner(channel, unlinked_at, site:sites!inner(removed_at, status))`)
        .eq('profile_id', pid).eq('status', 'active').eq('team.channel', 'whatsapp').is('team.unlinked_at', null).is('team.site.removed_at', null))
      return ((rows ?? []) as Any[]).filter((r) => liveSite(r.team ?? {})).map(({ team: _team, ...r }) => asMember(r))
    },
    upsertInvited: async (a) => asMember(await one(admin.from('channel_group_members').upsert({
      group_id: a.group_id, profile_id: a.profile_id, phone: a.phone, status: 'invited', invited_by: a.invited_by,
      invited_at: a.now.toISOString(), joined_at: null, removed_at: null, unreachable_at: null,
    }, { onConflict: 'group_id,profile_id' }).select(MEMBER_COLS).single())),
    // Two UPDATEs = the OR (never sent / sent over an hour ago) without filter strings; the row lock makes it atomic.
    claimInviteSend: async (id, now) => {
      const at = now.toISOString()
      const first = await one(admin.from('channel_group_members').update({ last_invite_sent_at: at }).eq('id', id).is('last_invite_sent_at', null).select('id'))
      if (first?.length) return true
      const later = await one(admin.from('channel_group_members').update({ last_invite_sent_at: at }).eq('id', id)
        .lte('last_invite_sent_at', new Date(now.getTime() - INVITE_RESEND_MS).toISOString()).select('id'))
      return !!later?.length
    },
    releaseInviteSend: async (id, claimedAt, previous) => {
      await one(admin.from('channel_group_members').update({ last_invite_sent_at: previous }).eq('id', id).eq('last_invite_sent_at', claimedAt))
    },
    activateMember: async (id, now) => !!(await one(admin.from('channel_group_members')
      .update({ status: 'active', joined_at: now.toISOString(), unreachable_at: null }).eq('id', id).eq('status', 'invited').select('id')))?.length,
    removeMember: async (id, now) => !!(await one(admin.from('channel_group_members')
      .update({ status: 'removed', removed_at: now.toISOString() }).eq('id', id).in('status', ['invited', 'active']).select('id')))?.length,
    setUnreachable: async (phone, at) => {
      let q = admin.from('channel_group_members').update({ unreachable_at: at ? at.toISOString() : null }).eq('phone', phone).neq('status', 'removed')
      q = at ? q.is('unreachable_at', null) : q.not('unreachable_at', 'is', null)
      await one(q)
    },

    identityByPhone: async (phone) => (await one(admin.from('channel_identities').select('id, business_id, profile_id, last_inbound_at')
      .eq('channel', 'whatsapp').eq('external_id', phone).is('revoked_at', null).maybeSingle())) ?? null,
    linkIdentity: async (a) => {
      const at = a.now.toISOString()
      const cur = await one(admin.from('channel_identities').select('id, business_id, profile_id')
        .eq('channel', 'whatsapp').eq('external_id', a.phone).is('revoked_at', null).maybeSingle())
      if (cur && cur.business_id === a.business_id && cur.profile_id === a.profile_id) {
        await one(admin.from('channel_identities').update({ last_inbound_at: at }).eq('id', cur.id))
        return
      }
      // One active WhatsApp identity per number and per profile (uq indexes): revoke both, then link — as LINK used to.
      await one(admin.from('channel_identities').update({ revoked_at: at }).eq('channel', 'whatsapp').eq('external_id', a.phone).is('revoked_at', null))
      await one(admin.from('channel_identities').update({ revoked_at: at }).eq('channel', 'whatsapp').eq('profile_id', a.profile_id).is('revoked_at', null))
      await one(admin.from('channel_identities').insert({
        business_id: a.business_id, profile_id: a.profile_id, channel: 'whatsapp', external_id: a.phone,
        consent_source: 'team_invite', consent_text_version: 1, linked_by: a.linked_by, last_inbound_at: at,
      }))
    },
    createStaffMember: async (a) => {
      const role = await defaultStaffRole(admin, a.businessId)
      if (!role) throw new Error('no staff role to give a new team member')
      const m = await createChannelOnlyMember(admin, { businessId: a.businessId, siteId: a.siteId, roleId: role.id, roleTier: role.base_tier, fullName: a.fullName, emailPrefix: 'wa' })
      if (!m.ok) throw new Error(`whatsapp member: ${m.error}`)
      return m.profileId
    },
    isManager: async (pid, b) => !!(await one(admin.from('profiles').select('id')
      .eq('id', pid).eq('business_id', b).in('role', ['owner', 'manager']).is('removed_at', null).maybeSingle())),
    person: core.person,
    firstNames: (ids) => firstNamesOf(admin, ids),
    recipients: async (team) => {
      const ms: Any[] = (await one(admin.from('channel_group_members').select('id, profile_id').eq('group_id', team.id).eq('status', 'active'))) ?? []
      if (!ms.length) return []
      const pids = ms.map((m) => m.profile_id)
      const ids: Any[] = (await one(admin.from('channel_identities').select('profile_id, external_id, last_inbound_at')
        .eq('channel', 'whatsapp').eq('business_id', team.business_id).is('revoked_at', null).in('profile_id', pids))) ?? []
      const people: Any[] = (await one(admin.from('profiles').select('id, full_name').eq('business_id', team.business_id).is('removed_at', null).in('id', pids))) ?? []
      return ms.flatMap((m) => {
        const i = ids.find((x) => x.profile_id === m.profile_id)
        const p = people.find((x) => x.id === m.profile_id)
        return i && p ? [{ member_id: m.id, profile_id: m.profile_id, phone: i.external_id, first_name: firstName(String(p.full_name ?? '')), last_inbound_at: i.last_inbound_at ?? null }] : []
      })
    },
    managerContacts: async (b) => {
      const mgr = await core.managerIds(b)
      if (!mgr.length) return []
      const ids: Any[] = (await one(admin.from('channel_identities').select('profile_id, external_id, last_inbound_at')
        .eq('channel', 'whatsapp').eq('business_id', b).is('revoked_at', null).in('profile_id', mgr))) ?? []
      return ids.map((i) => ({ profile_id: i.profile_id, phone: i.external_id, last_inbound_at: i.last_inbound_at ?? null }))
    },
    completionsSince: (b, since) => completionsWhoSince(admin, b, since),

    claimEvent: (gid, kind, key) => claimInsert('channel_group_events', { group_id: gid, kind, key }),
    releaseEvent: async (gid, kind, key) => {
      const { error } = await admin.from('channel_group_events').delete().eq('group_id', gid).eq('kind', kind).eq('key', key)
      if (error) console.error('team event release failed', gid, kind, errMsg(error))
    },
    claimTake: async (k, pid, now) => {
      const mapped: Any[] = (await one(admin.from('channel_group_checklists').select('group_id, team:channel_groups!inner(channel, site_id, unlinked_at)')
        .eq('template_id', k.template_id).eq('team.channel', 'whatsapp').eq('team.site_id', k.site_id).is('team.unlinked_at', null))) ?? []
      // Sorted: concurrent claims insert in the same order, so they block rather than deadlock.
      const groups = [...new Set([k.group_id, ...mapped.map((m) => m.group_id as string)])].sort()
      const at = now.toISOString()
      // One statement: Postgres inserts every row or none, so a take held by any team loses the whole claim.
      const { error } = await admin.from('channel_group_takes').insert(groups.map((g) => ({
        group_id: g, template_id: k.template_id, site_id: k.site_id, period_key: k.period_key, profile_id: pid, taken_at: at,
      })))
      if (!error) return true
      if (TAKE_LOST.has(error.code)) return false
      throw error
    },
    takeOwner: async (k) => ((await one(admin.from('channel_group_takes').select('profile_id, taken_at')
      .eq('template_id', k.template_id).eq('site_id', k.site_id).eq('period_key', k.period_key).order('taken_at').limit(1))) ?? [])[0] ?? null,
    releaseTake: async (k, pid) => {
      const { error } = await admin.from('channel_group_takes').delete()
        .eq('template_id', k.template_id).eq('site_id', k.site_id).eq('period_key', k.period_key).eq('profile_id', pid)
      if (error) console.error('team take release failed', k.group_id, k.template_id, errMsg(error))
    },
    log: async (e) => {
      const { error } = await admin.from('channel_messages_log').insert({ ...e, channel: 'whatsapp' })
      if (error) console.error('channel_messages_log insert failed', e.kind, errMsg(error))
    },

    insertCompletion: core.insertCompletion,
    insertResponses: core.insertResponses,
    managerIds: core.managerIds,
    insertNotifications: core.insertNotifications,
  }
}
