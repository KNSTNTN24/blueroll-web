// src/lib/whatsapp/__tests__/fakes/team-deps.ts
// In-memory TeamDeps + WhatsApp send fake for the WhatsApp team tests (planner, membership, cron, bot, admin, API).
import type { ChannelLog, Team, TeamDeps, TeamMember } from '../../../../../supabase/functions/_shared/channels/teams-db'
import type { CompletionWho } from '../../../../../supabase/functions/_shared/channels/groups-db'
import type { SiteInfo } from '../../../../../supabase/functions/_shared/channels/bot'
import type { SendFn, SendResult } from '../../../../../supabase/functions/_shared/channels/types'
import type { Person, Template, TemplateItem } from '../../../../../supabase/functions/_shared/checklists-core/types'
import { firstName } from '../../../../../supabase/functions/_shared/channels/team-text'

export const NOW = new Date('2026-10-14T09:40:00Z')   // 10:40 Europe/London (BST)
export const SITE: SiteInfo = { id: 's1', name: 'Ashfield Row', timezone: 'Europe/London' }
export const TEAM: Team = { id: 'g1', business_id: 'b', title: 'Kitchen', site_id: 's1' }
export const ANNA = { profile_id: 'p1', phone: '447700900123', name: 'Anna Smith' }
export const BEN = { profile_id: 'p2', phone: '447700900456', name: 'Ben Jones' }
export const BOSS = { profile_id: 'm1', phone: '447700900001', name: 'Kostya Boss' }
export const TEMP_ITEM: TemplateItem = { id: 'i1', name: 'Walk-in fridge', item_type: 'temperature', required: true, min_value: 0, max_value: 5, unit: '°C', sort_order: 0 }
export const tpl = (o: Partial<Template> & { id: string; name: string }): Template => ({
  business_id: 'b', site_id: null, frequency: 'daily', deadline_time: null, multi_per_day: false, min_per_day: null,
  assigned_roles: [], assigned_role_ids: [], active: true, ...o,
})
export const member = (o: Partial<TeamMember> & { id: string; profile_id: string; phone: string }): TeamMember => ({
  group_id: 'g1', status: 'active', full_name: '', invited_by: 'm1', invited_at: '2026-10-01T09:00:00Z', joined_at: '2026-10-01T09:05:00Z',
  removed_at: null, last_invite_sent_at: '2026-10-01T09:00:00Z', unreachable_at: null, ...o,
})
const person = (p: { profile_id: string; name: string }, role = 'kitchen_staff'): Person & { removed?: boolean } =>
  ({ profile_id: p.profile_id, business_id: 'b', full_name: p.name, role, role_id: null })

export interface FakeIdentity { id: string; business_id: string; profile_id: string; phone: string; last_inbound_at: string | null; revoked: boolean; consent_source: string }
export interface FakeTeamState {
  now: Date
  teams: (Team & { deleted?: boolean })[]
  mappings: { group_id: string; template_id: string }[]
  templates: Template[]
  sites: SiteInfo[]
  members: TeamMember[]
  identities: FakeIdentity[]
  people: (Person & { removed?: boolean })[]
  managers: string[]
  /** member_sites by profile (none = every site, as can_see_site_row) */
  memberSites: Record<string, string[]>
  groupAdmins: string[]
  completions: CompletionWho[]
  events: Set<string>                                       // `${group}|${kind}|${key}`
  takes: Map<string, { profile_id: string; taken_at: string }>   // `${group}|${template}|${site}|${period}`
  ready: Record<string, boolean>
  businessNames: Record<string, string>
  created: { businessId: string; siteId: string; fullName: string; profile_id: string }[]
  completionRows: any[]
  responses: any[]
  notifications: any[]
  logs: ChannelLog[]
}

/** Defaults: team Kitchen at Ashfield Row; Anna an active, linked member; Ben a person without a number; Kostya the owner, linked. */
export function fakeTeamDeps(init: Partial<FakeTeamState> = {}, over: Partial<TeamDeps> = {}) {
  const s: FakeTeamState = {
    now: NOW, teams: [{ ...TEAM }], mappings: [], templates: [], sites: [SITE],
    members: [member({ id: 'gm1', profile_id: ANNA.profile_id, phone: ANNA.phone, full_name: ANNA.name })],
    identities: [
      { id: 'id1', business_id: 'b', profile_id: ANNA.profile_id, phone: ANNA.phone, last_inbound_at: null, revoked: false, consent_source: 'team_invite' },
      { id: 'idm', business_id: 'b', profile_id: BOSS.profile_id, phone: BOSS.phone, last_inbound_at: null, revoked: false, consent_source: 'qr_code' },
    ],
    people: [person(ANNA), person(BEN), person(BOSS, 'owner')], managers: [BOSS.profile_id], memberSites: {}, groupAdmins: [], completions: [],
    events: new Set(), takes: new Map(), ready: { b: true }, businessNames: { b: 'Fern & Fig' },
    created: [], completionRows: [], responses: [], notifications: [], logs: [], ...init,
  }
  let n = 0
  // A team is live while not deleted and its site is still listed (a site missing from s.sites = soft-removed).
  const isLive = (t: Team & { deleted?: boolean }) => !t.deleted && s.sites.some((x) => x.id === t.site_id)
  const live = (id: string) => s.teams.find((t) => t.id === id && isLive(t)) ?? null
  const pub = (t: Team): Team => ({ id: t.id, business_id: t.business_id, title: t.title, site_id: t.site_id })
  type K = { group_id: string; template_id: string; site_id: string; period_key: string }
  const takeKey = (k: K) => `${k.group_id}|${k.template_id}|${k.site_id}|${k.period_key}`
  const sameTake = (key: string, k: K) => key.slice(key.indexOf('|') + 1) === `${k.template_id}|${k.site_id}|${k.period_key}`
  const activeIdentity = (phone: string) => s.identities.find((i) => i.phone === phone && !i.revoked) ?? null
  const alive = (pid: string) => s.people.find((p) => p.profile_id === pid && !p.removed) ?? null
  const d: TeamDeps = {
    now: () => s.now,
    ready: async (b) => !!s.ready[b],
    businessName: async (b) => s.businessNames[b] ?? 'your team',
    liveTeams: async () => s.teams.filter(isLive).map(pub),
    teamsForBusiness: async (b) => s.teams.filter((t) => t.business_id === b && isLive(t)).sort((x, y) => x.title.localeCompare(y.title)).map(pub),
    teamById: async (id) => { const t = live(id); return t ? pub(t) : null },
    teamTemplates: async (team) => s.templates.filter((t) => t.active && t.business_id === team.business_id && (t.site_id === null || t.site_id === team.site_id)
      && s.mappings.some((m) => m.group_id === team.id && m.template_id === t.id)),
    site: async (id) => s.sites.find((x) => x.id === id) ?? null,
    members: async (gid) => s.members.filter((m) => m.group_id === gid).map((m) => ({ ...m })),
    memberById: async (id) => { const m = s.members.find((x) => x.id === id); return m ? { ...m } : null },
    memberFor: async (gid, pid) => { const m = s.members.find((x) => x.group_id === gid && x.profile_id === pid); return m ? { ...m } : null },
    activeMemberships: async (pid) => s.members.filter((m) => m.profile_id === pid && m.status === 'active' && live(m.group_id)).map((m) => ({ ...m })),
    upsertInvited: async (a) => {
      const at = a.now.toISOString()
      let m = s.members.find((x) => x.group_id === a.group_id && x.profile_id === a.profile_id)
      const name = s.people.find((p) => p.profile_id === a.profile_id)?.full_name ?? ''
      if (m) Object.assign(m, { phone: a.phone, status: 'invited', invited_by: a.invited_by, invited_at: at, joined_at: null, removed_at: null, unreachable_at: null })
      else { m = member({ id: `gm${s.members.length + 1}`, group_id: a.group_id, profile_id: a.profile_id, phone: a.phone, status: 'invited', full_name: name, invited_by: a.invited_by, invited_at: at, joined_at: null, last_invite_sent_at: null }); s.members.push(m) }
      return { ...m }
    },
    claimInviteSend: async (id, now) => {
      const m = s.members.find((x) => x.id === id)
      if (!m || (m.last_invite_sent_at && now.getTime() - new Date(m.last_invite_sent_at).getTime() < 3600_000)) return false
      m.last_invite_sent_at = now.toISOString(); return true
    },
    releaseInviteSend: async (id, claimed, previous) => { const m = s.members.find((x) => x.id === id && x.last_invite_sent_at === claimed); if (m) m.last_invite_sent_at = previous },
    activateMember: async (id, now) => {
      const m = s.members.find((x) => x.id === id && x.status === 'invited')
      if (!m) return false
      Object.assign(m, { status: 'active', joined_at: now.toISOString(), unreachable_at: null }); return true
    },
    removeMember: async (id, now) => {
      const m = s.members.find((x) => x.id === id && x.status !== 'removed')
      if (!m) return false
      Object.assign(m, { status: 'removed', removed_at: now.toISOString() }); return true
    },
    removeMembershipsElsewhere: async (phone, b, now) => {
      for (const m of s.members) {
        const team = s.teams.find((t) => t.id === m.group_id)
        if (m.phone === phone && m.status !== 'removed' && team && team.business_id !== b) Object.assign(m, { status: 'removed', removed_at: now.toISOString() })
      }
    },
    setUnreachable: async (phone, at) => { for (const m of s.members) if (m.phone === phone && m.status !== 'removed') m.unreachable_at = at ? at.toISOString() : null },
    identityByPhone: async (phone) => { const i = activeIdentity(phone); return i ? { id: i.id, business_id: i.business_id, profile_id: i.profile_id, last_inbound_at: i.last_inbound_at } : null },
    linkIdentity: async (a) => {
      const cur = activeIdentity(a.phone)
      if (cur && cur.business_id === a.business_id && cur.profile_id === a.profile_id) { cur.last_inbound_at = a.now.toISOString(); return }
      for (const i of s.identities) if (!i.revoked && (i.phone === a.phone || i.profile_id === a.profile_id)) i.revoked = true
      s.identities.push({ id: `id${s.identities.length + 1}`, business_id: a.business_id, profile_id: a.profile_id, phone: a.phone, last_inbound_at: a.now.toISOString(), revoked: false, consent_source: 'team_invite' })
    },
    createStaffMember: async (a) => {
      const pid = `new${++n}`
      s.created.push({ ...a, profile_id: pid })
      s.people.push({ profile_id: pid, business_id: a.businessId, full_name: a.fullName, role: 'kitchen_staff', role_id: 'r-staff' })
      return pid
    },
    isManager: async (pid, b) => s.managers.includes(pid) && !!s.people.find((p) => p.profile_id === pid && p.business_id === b && !p.removed),
    person: async (pid) => { const p = alive(pid); return p ? { profile_id: p.profile_id, business_id: p.business_id, full_name: p.full_name, role: p.role, role_id: p.role_id } : null },
    firstNames: async (ids) => new Map(ids.flatMap((i) => { const p = s.people.find((x) => x.profile_id === i); return p ? [[i, firstName(p.full_name)] as [string, string]] : [] })),
    recipients: async (team) => s.members.filter((m) => m.group_id === team.id && m.status === 'active').flatMap((m) => {
      const i = s.identities.find((x) => x.profile_id === m.profile_id && x.business_id === team.business_id && !x.revoked)
      const p = alive(m.profile_id)
      return i && p ? [{ member_id: m.id, profile_id: m.profile_id, phone: i.phone, first_name: firstName(p.full_name), last_inbound_at: i.last_inbound_at }] : []
    }),
    managerContacts: async (b) => s.identities.filter((i) => i.business_id === b && !i.revoked && s.managers.includes(i.profile_id) && alive(i.profile_id))
      .map((i) => ({ profile_id: i.profile_id, phone: i.phone, last_inbound_at: i.last_inbound_at })),
    summaryManagerIds: async (team) => s.managers.filter((pid) => {
      const p = s.people.find((x) => x.profile_id === pid && x.business_id === team.business_id && !x.removed)
      const sites = s.memberSites[pid] ?? []
      return !!p && (p.role === 'owner' || s.groupAdmins.includes(pid) || !sites.length || sites.includes(team.site_id))
    }),
    completionsSince: async (_b, since) => s.completions.filter((c) => new Date(c.completed_at) >= since),
    claimEvent: async (g, kind, key) => { const k = `${g}|${kind}|${key}`; if (s.events.has(k)) return false; s.events.add(k); return true },
    releaseEvent: async (g, kind, key) => { s.events.delete(`${g}|${kind}|${key}`) },
    // First submit wins across teams: the taker's team + every other live team mapping it at that site, all or nothing.
    claimTake: async (k, pid, now) => {
      await Promise.resolve()   // the team lookup is a round trip: lets concurrent claims interleave before the atomic insert
      const others = s.mappings.filter((m) => m.template_id === k.template_id && m.group_id !== k.group_id
        && s.teams.some((t) => t.id === m.group_id && !t.deleted && t.site_id === k.site_id)).map((m) => m.group_id)
      const keys = [...new Set([k.group_id, ...others])].sort().map((group_id) => takeKey({ ...k, group_id }))
      // Check-and-set with no await in between = the single all-or-nothing INSERT.
      if (keys.some((x) => s.takes.has(x))) return false
      for (const x of keys) s.takes.set(x, { profile_id: pid, taken_at: now.toISOString() })
      return true
    },
    takeOwner: async (k) => [...s.takes].find(([key]) => sameTake(key, k))?.[1] ?? null,
    releaseTake: async (k, pid) => { for (const [key, t] of [...s.takes]) if (sameTake(key, k) && t.profile_id === pid) s.takes.delete(key) },
    log: async (e) => { s.logs.push(e) },
    insertCompletion: async (row) => {
      s.completionRows.push({ ...row })
      s.completions.push({ template_id: row.template_id, site_id: row.site_id, completed_at: row.completed_at, completed_by: row.completed_by })
      return { id: `c${s.completionRows.length}` }
    },
    insertResponses: async (rows) => {
      const start = s.responses.length
      s.responses.push(...rows)
      return rows.map((r, i) => ({ id: `resp${start + i}`, item_id: r.item_id }))
    },
    managerIds: async () => [...s.managers],
    insertNotifications: async (rows) => { s.notifications.push(...rows) },
    ...over,
  }
  return { d, s }
}

/** WhatsApp send fake: succeeds unless `respond` overrides; message ids w1, w2, … */
export function fakeSend(respond: (msg: any) => Partial<SendResult> | undefined = () => undefined) {
  const sent: any[] = []
  const send: SendFn = async (m) => { sent.push(m); return { id: `w${sent.length}`, ok: true, status: 200, ...respond(m) } }
  return { send, sent }
}
