// supabase/functions/_shared/channels/team-members.ts
// WhatsApp team membership (spec 2026-10-12 §4): add a person (reuse a linked profile or create a chat-only one),
// send / resend the team_invite template, Join = consent, delivery statuses → "Not reachable".
// Pure over TeamDeps + SendFn (unit-tested with fakes). Never logs raw phone numbers.
import type { DeliveryStatus, OutboundMessage, SendFn, SendResult } from './types.ts'
import { templateMessage, textMessage } from './whatsapp.ts'
import { isBillable } from './service-window.ts'
import { maskPhone } from './mask.ts'
import { TEAM_TEXT, firstName } from './team-text.ts'
import type { Team, TeamDeps, TeamMember } from './teams-db.ts'

export const INVITE_TTL_MS = 14 * 86400_000
export const UNREACHABLE_CODES = new Set([131026, 131047, 131051])
export const TEMPLATE_MISSING_CODES = new Set([132001])
export type InviteOutcome = 'invited' | 'already_member' | 'too_soon' | 'failed' | 'template_missing'

export interface TrackedSend {
  to: string; msg: OutboundMessage; business_id: string | null; site_id: string | null; profile_id: string | null
  kind: string; template_name?: string; lastInboundAt: string | null
}

/** Send, log (billable = a template outside the 24 h window), flag the number on Meta's "can't reach" errors. */
export async function sendTracked(t: TeamDeps, send: SendFn, a: TrackedSend): Promise<SendResult> {
  const r = await send(a.msg)
  const now = t.now()
  if (!r.ok) {
    console.error('whatsapp team send failed', a.kind, maskPhone(a.to), r.status, r.errorCode ?? '')
    if (r.errorCode != null && UNREACHABLE_CODES.has(r.errorCode)) await t.setUnreachable(a.to, now)
  }
  await t.log({ business_id: a.business_id, site_id: a.site_id, profile_id: a.profile_id, direction: 'out', kind: a.kind,
    template_name: a.template_name, billable: r.ok && !!a.template_name && isBillable(a.lastInboundAt, now), wa_message_id: r.id })
  return r
}

export const inviteMessage = (to: string, a: { business: string; team: string; site: string; memberId: string }): OutboundMessage =>
  templateMessage(to, 'team_invite', [a.business, a.team, a.site], [`join:${a.memberId}`])

async function sendInvite(t: TeamDeps, send: SendFn, team: Team, m: TeamMember): Promise<InviteOutcome> {
  const now = t.now()
  if (!(await t.claimInviteSend(m.id, now))) return 'too_soon'
  const [business, site, ident] = await Promise.all([t.businessName(team.business_id), t.site(team.site_id), t.identityByPhone(m.phone)])
  const r = await sendTracked(t, send, {
    to: m.phone, msg: inviteMessage(m.phone, { business, team: team.title, site: site?.name ?? '', memberId: m.id }),
    business_id: team.business_id, site_id: team.site_id, profile_id: m.profile_id, kind: 'team_invite', template_name: 'team_invite',
    lastInboundAt: ident?.last_inbound_at ?? null,
  })
  if (r.ok) return 'invited'
  await t.releaseInviteSend(m.id, now.toISOString(), m.last_invite_sent_at)   // a failed send doesn't use up the hourly resend
  return r.errorCode != null && TEMPLATE_MISSING_CODES.has(r.errorCode) ? 'template_missing' : 'failed'
}

export interface AddPerson { team: Team; phone: string; name: string; profileId?: string | null; invitedBy: string }

/**
 * Spec §4 Add: a number linked in this business reuses that profile; a number already in this team's member list
 * (e.g. removed earlier) reuses its profile; otherwise a chat-only member is created at the team's site.
 */
export async function addPersonToTeam(t: TeamDeps, send: SendFn, a: AddPerson): Promise<{ outcome: InviteOutcome; member: TeamMember | null }> {
  const ident = await t.identityByPhone(a.phone)
  const linkedHere = ident && ident.business_id === a.team.business_id ? ident : null
  let profileId = a.profileId ?? linkedHere?.profile_id ?? null
  if (!profileId) {
    const prior = (await t.members(a.team.id)).find((m) => m.phone === a.phone)
    profileId = prior?.profile_id ?? await t.createStaffMember({ businessId: a.team.business_id, siteId: a.team.site_id, fullName: a.name })
  }
  const existing = await t.memberFor(a.team.id, profileId)
  const connected = !!linkedHere && linkedHere.profile_id === profileId
  if (existing?.status === 'active' && existing.phone === a.phone && connected) return { outcome: 'already_member', member: existing }
  const m = await t.upsertInvited({ group_id: a.team.id, profile_id: profileId, phone: a.phone, invited_by: a.invitedBy, now: t.now() })
  return { outcome: await sendInvite(t, send, a.team, m), member: m }
}

/** Settings "Resend invite": invited members only, at most once per hour. */
export async function resendInvite(t: TeamDeps, send: SendFn, memberId: string): Promise<{ outcome: InviteOutcome | 'not_invited'; member: TeamMember | null }> {
  const m = await t.memberById(memberId)
  const team = m ? await t.teamById(m.group_id) : null
  if (!m || !team || m.status !== 'invited') return { outcome: 'not_invited', member: m }
  return { outcome: await sendInvite(t, send, team, m), member: m }
}

/** Inbound quick reply `join:<member id>`. Only the invited phone may use it; anything else is ignored silently. */
export async function handleJoin(t: TeamDeps, send: SendFn, a: { from: string; memberId: string }): Promise<void> {
  const now = t.now()
  const m = await t.memberById(a.memberId)
  if (!m || m.phone !== a.from) return
  const team = await t.teamById(m.group_id)
  // The person just wrote to us: their window is open, so these replies are free.
  const reply = (body: string) => sendTracked(t, send, { to: a.from, msg: textMessage(a.from, body), business_id: team?.business_id ?? null,
    site_id: team?.site_id ?? null, profile_id: m.profile_id, kind: 'reply', lastInboundAt: now.toISOString() })
  if (!team || m.status === 'removed') { await reply(TEAM_TEXT.inviteExpired); return }
  const site = await t.site(team.site_id)
  const joined = TEAM_TEXT.joined(team.title, site?.name ?? '')
  if (m.status === 'active') { await reply(joined); return }
  if (now.getTime() - new Date(m.last_invite_sent_at ?? m.invited_at).getTime() > INVITE_TTL_MS) { await reply(TEAM_TEXT.inviteExpired); return }
  if (!(await t.ready(team.business_id))) { await reply(TEAM_TEXT.unavailable); return }
  await t.linkIdentity({ business_id: team.business_id, profile_id: m.profile_id, phone: m.phone, linked_by: m.invited_by, now })
  await t.activateMember(m.id, now)
  await t.setUnreachable(m.phone, null)
  console.log('whatsapp team joined', team.id, maskPhone(m.phone))
  await reply(joined)
  await tellInviter(t, send, team, m, now)
}

/** "<first name> joined <team> ✓" to whoever added them: WhatsApp if linked and inside their window, else the app. */
async function tellInviter(t: TeamDeps, send: SendFn, team: Team, m: TeamMember, now: Date): Promise<void> {
  if (!m.invited_by) return
  const body = TEAM_TEXT.managerJoined(firstName(m.full_name) || 'Someone', team.title)
  const mc = (await t.managerContacts(team.business_id)).find((x) => x.profile_id === m.invited_by)
  if (mc && !isBillable(mc.last_inbound_at, now)) {
    const r = await sendTracked(t, send, { to: mc.phone, msg: textMessage(mc.phone, body), business_id: team.business_id, site_id: team.site_id,
      profile_id: mc.profile_id, kind: 'team_joined', lastInboundAt: mc.last_inbound_at })
    if (r.ok) return
  }
  await t.insertNotifications([{ user_id: m.invited_by, type: 'team', title: TEAM_TEXT.joinedTitle, message: body, link: '/settings' }])
}

/** Webhook `statuses`: Meta's "can't reach this number" errors flag it; a delivered/read message clears the flag. */
export async function applyDeliveryStatuses(t: TeamDeps, list: DeliveryStatus[]): Promise<void> {
  const now = t.now()
  for (const s of list) {
    if (s.status === 'failed' && s.errorCode != null && UNREACHABLE_CODES.has(s.errorCode)) await t.setUnreachable(s.recipient, now)
    else if (s.status === 'delivered' || s.status === 'read') await t.setUnreachable(s.recipient, null)
  }
}
