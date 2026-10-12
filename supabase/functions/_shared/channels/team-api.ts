// supabase/functions/_shared/channels/team-api.ts
// Settings → Messaging → WhatsApp teams, server side (spec 2026-10-12 §4, §8): add a person, resend an invite.
// Pure over TeamDeps + SendFn; whatsapp-team-member/index.ts does the auth and wiring.
// Every lookup is checked against the caller's business: another business's team, member or person is never touched.
import type { SendFn } from './types.ts'
import type { TeamDeps } from './teams-db.ts'
import { normalisePhone } from './whatsapp.ts'
import { addPersonToTeam, resendInvite, type InviteOutcome } from './team-members.ts'
import { cleanName } from './team-admin.ts'

export interface ApiCaller { profile_id: string; business_id: string }
export interface ApiRes { status: number; body: Record<string, unknown> }
const res = (status: number, body: Record<string, unknown>): ApiRes => ({ status, body })
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

function outcomeRes(o: InviteOutcome, memberId: string | null): ApiRes {
  if (o === 'invited' || o === 'already_member') return res(200, { outcome: o, member_id: memberId })
  if (o === 'too_soon') return res(429, { error: 'too_soon' })
  if (o === 'template_missing') return res(502, { error: 'template' })
  return res(502, { error: 'send' })
}

export async function handleTeamMemberRequest(t: TeamDeps, send: SendFn, me: ApiCaller, body: unknown): Promise<ApiRes> {
  if (!isObj(body)) return res(400, { error: 'body' })
  if (!(await t.isManager(me.profile_id, me.business_id))) return res(403, { error: 'forbidden' })
  if (body.action === 'add') {
    // teamById skips deleted teams and teams at soft-removed sites.
    const team = typeof body.group_id === 'string' ? await t.teamById(body.group_id) : null
    if (!team || team.business_id !== me.business_id) return res(404, { error: 'team' })
    const phone = typeof body.phone === 'string' ? normalisePhone(body.phone) : null
    if (!phone) return res(400, { error: 'phone' })
    let name = typeof body.full_name === 'string' ? cleanName(body.full_name) : ''
    let profileId: string | null = null
    if (typeof body.profile_id === 'string') {
      const p = await t.person(body.profile_id)
      if (!p || p.business_id !== me.business_id) return res(400, { error: 'profile' })
      profileId = p.profile_id
      name = cleanName(p.full_name) || name
    }
    if (!name) return res(400, { error: 'name' })
    if (!(await t.ready(me.business_id))) return res(409, { error: 'whatsapp_off' })
    const r = await addPersonToTeam(t, send, { team, phone, name, profileId, invitedBy: me.profile_id })
    return outcomeRes(r.outcome, r.member?.id ?? null)
  }
  if (body.action === 'resend') {
    const m = typeof body.member_id === 'string' ? await t.memberById(body.member_id) : null
    const team = m ? await t.teamById(m.group_id) : null
    if (!m || !team || team.business_id !== me.business_id) return res(404, { error: 'member' })
    if (!(await t.ready(me.business_id))) return res(409, { error: 'whatsapp_off' })
    const r = await resendInvite(t, send, m.id)
    if (r.outcome === 'not_invited') return res(409, { error: 'not_invited' })
    return outcomeRes(r.outcome, m.id)
  }
  return res(400, { error: 'action' })
}
