// src/lib/whatsapp/teams.ts
// Web client for WhatsApp teams (Settings → Messaging). Teams, checklist mappings and removals go through RLS (managers
// only; a DB trigger allows only "remove" on members). Adding a person and resending an invite go through the
// whatsapp-team-member function, because they send the team_invite template.
import { supabase } from '@/lib/supabase'
import { callFn } from './client'

export type MemberStatus = 'invited' | 'active' | 'removed'
export interface TeamMemberRow { id: string; profile_id: string; name: string; phone: string; status: MemberStatus; unreachable: boolean; last_invite_sent_at: string | null }
export interface WhatsAppTeam { id: string; title: string; site_id: string; template_ids: string[]; members: TeamMemberRow[] }
export interface Person { id: string; full_name: string }

export const TEAM_SHARE_HINT = 'Managers can also add people from WhatsApp — share a contact with the Blueroll bot.'
export const RESEND_AFTER_MS = 3600_000

export const memberStatusLabel = (m: Pick<TeamMemberRow, 'status' | 'unreachable'>): 'Not reachable' | 'Active' | 'Invited' =>
  m.unreachable ? 'Not reachable' : m.status === 'active' ? 'Active' : 'Invited'

export const canResend = (m: Pick<TeamMemberRow, 'status' | 'last_invite_sent_at'>, now: number = Date.now()) =>
  m.status === 'invited' && (!m.last_invite_sent_at || now - Date.parse(m.last_invite_sent_at) >= RESEND_AFTER_MS)

/** Team page channel column: active teams by name, else "Invited", else nothing. */
export function teamChannelLabel(rows: { title: string; status: MemberStatus }[]): string | null {
  const active = rows.filter((r) => r.status === 'active').map((r) => r.title)
  if (active.length) return `WhatsApp · ${active.join(', ')}`
  return rows.some((r) => r.status === 'invited') ? 'Invited' : null
}

const API_ERRORS: Record<string, string> = {
  phone: 'Enter a mobile number with the country code, e.g. +44 7700 900123.',
  name: 'Enter their name.',
  profile: 'Pick someone from your team.',
  too_soon: 'An invite went out less than an hour ago — try again later.',
  template: "WhatsApp hasn't approved the invite message yet — try again later.",
  send: "Couldn't send the invite on WhatsApp — check the number and try again.",
  whatsapp_off: 'Turn on WhatsApp checks first.',
  team: 'This team no longer exists.',
  member: 'This person is no longer in the team.',
  not_invited: 'This person has already joined.',
  forbidden: 'Only owners and managers can do this.',
}
/** Sentence for an error code from whatsapp-team-member; any other message (e.g. from the database) passes through. */
export const teamApiError = (code: string) => API_ERRORS[code] ?? code
/** Any thrown value → readable text: Error and PostgrestError-like objects by .message (never "[object Object]"). */
export function teamErrorText(e: unknown): string {
  const m = typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : null
  return teamApiError(m ?? (typeof e === 'string' ? e : 'Something went wrong'))
}

type MemberSel = { id: string; profile_id: string; phone: string; status: MemberStatus; unreachable_at: string | null; last_invite_sent_at: string | null; profile: { full_name: string | null } | null }
type SiteSel = { status: string | null } | null
type TeamSel = { id: string; title: string; site_id: string; site: SiteSel; channel_group_checklists: { template_id: string }[] | null; channel_group_members: MemberSel[] | null }
// Teams at soft-removed sites (removed_at, or legacy status 'removed') are not shown — same rule as the server (teams-db.ts).
const liveSite = (s: SiteSel) => s?.status !== 'removed'

export async function listTeams(businessId: string): Promise<WhatsAppTeam[]> {
  const { data, error } = await supabase.from('channel_groups')
    .select('id, title, site_id, site:sites!channel_groups_site_id_fkey!inner(removed_at, status), channel_group_checklists(template_id), channel_group_members(id, profile_id, phone, status, unreachable_at, last_invite_sent_at, profile:profiles!channel_group_members_profile_id_fkey(full_name))')
    .eq('business_id', businessId).eq('channel', 'whatsapp').is('unlinked_at', null).is('site.removed_at', null).order('title')
  if (error) throw error
  return ((data ?? []) as unknown as TeamSel[]).filter((t) => liveSite(t.site)).map((t) => ({
    id: t.id, title: t.title, site_id: t.site_id,
    template_ids: (t.channel_group_checklists ?? []).map((m) => m.template_id),
    members: (t.channel_group_members ?? []).filter((m) => m.status !== 'removed')
      .map((m) => ({ id: m.id, profile_id: m.profile_id, name: m.profile?.full_name || 'Unnamed', phone: m.phone, status: m.status, unreachable: !!m.unreachable_at, last_invite_sent_at: m.last_invite_sent_at }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
}

export async function listPeople(businessId: string): Promise<Person[]> {
  const { data, error } = await supabase.from('profiles').select('id, full_name').eq('business_id', businessId).is('removed_at', null).order('full_name')
  if (error) throw error
  return ((data ?? []) as { id: string; full_name: string | null }[]).map((p) => ({ id: p.id, full_name: p.full_name || 'Unnamed' }))
}

/** profile id → their WhatsApp teams (not removed) for the Team page. */
export async function listMemberTeams(businessId: string): Promise<Map<string, { title: string; status: MemberStatus }[]>> {
  const { data, error } = await supabase.from('channel_group_members')
    .select('profile_id, status, team:channel_groups!inner(title, channel, business_id, unlinked_at, site:sites!channel_groups_site_id_fkey!inner(removed_at, status))')
    .eq('team.business_id', businessId).eq('team.channel', 'whatsapp').is('team.unlinked_at', null).is('team.site.removed_at', null).neq('status', 'removed')
  if (error) throw error
  const out = new Map<string, { title: string; status: MemberStatus }[]>()
  for (const r of (data ?? []) as unknown as { profile_id: string; status: MemberStatus; team: { title: string; site: SiteSel } }[]) {
    if (!liveSite(r.team.site)) continue
    out.set(r.profile_id, [...(out.get(r.profile_id) ?? []), { title: r.team.title, status: r.status }])
  }
  return out
}

export async function createTeam(a: { businessId: string; title: string; siteId: string }): Promise<void> {
  // linked_by / linked_at are stamped by the DB trigger.
  const { error } = await supabase.from('channel_groups').insert({ business_id: a.businessId, channel: 'whatsapp', title: a.title.trim(), site_id: a.siteId })
  if (error) throw error
}

export async function deleteTeam(groupId: string): Promise<void> {
  // The DB trigger stamps the real time; the value sent only needs to be non-null.
  const { error } = await supabase.from('channel_groups').update({ unlinked_at: new Date().toISOString() }).eq('id', groupId)
  if (error) throw error
}

export async function removeTeamMember(memberId: string): Promise<void> {
  const { error } = await supabase.from('channel_group_members').update({ status: 'removed' }).eq('id', memberId)
  if (error) throw error
}

export async function addTeamPerson(a: { groupId: string; phone: string; fullName?: string; profileId?: string }): Promise<'invited' | 'already_member'> {
  const r = await callFn('whatsapp-team-member', { action: 'add', group_id: a.groupId, phone: a.phone, full_name: a.fullName, profile_id: a.profileId })
  return r.outcome
}

export async function resendTeamInvite(memberId: string): Promise<void> {
  await callFn('whatsapp-team-member', { action: 'resend', member_id: memberId })
}
