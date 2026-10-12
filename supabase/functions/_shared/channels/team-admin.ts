// supabase/functions/_shared/channels/team-admin.ts
// Manager commands in WhatsApp (spec 2026-10-12 §6): share a contact → pick a team → invite; `team` → members with
// "Remove <name>" → confirm. Only numbers linked to an active owner/manager of the business. Pure over TeamDeps + SendFn;
// the contact travels inside the pick button's id, so there is no pending state.
import type { Person } from '../checklists-core/types.ts'
import type { OutboundMessage, SendFn, SendResult } from './types.ts'
import type { Team, TeamDeps, TeamMember } from './teams-db.ts'
import { addPersonToTeam, sendTracked, type InviteOutcome } from './team-members.ts'
import { buttonsMessage, listMessage, textMessage } from './whatsapp.ts'
import { TEAM_TEXT, firstName } from './team-text.ts'
import { maskPhone } from './mask.ts'
import { clip } from './live-list.ts'

export const TEAM_BUTTONS_MAX = 3
export const TEAM_LIST_MAX = 10
export const MEMBER_ROWS_MAX = 10
const NAME_MAX = 60
const ADD_RE = /^add:([0-9a-zA-Z-]+):(\d{10,15}):(.*)$/

interface Who { t: TeamDeps; send: SendFn; from: string; person: Person }
// The manager just wrote to us, so their window is open: these replies are free.
const post = (w: Who, msg: OutboundMessage) => sendTracked(w.t, w.send, { to: w.from, msg, business_id: w.person.business_id, site_id: null,
  profile_id: w.person.profile_id, kind: 'reply', lastInboundAt: w.t.now().toISOString() })
const say = (w: Who, body: string) => post(w, textMessage(w.from, body))

/** Collapse whitespace, trim, cap at NAME_MAX characters (code points). Shared with the Settings API (team-api.ts). */
export const cleanName = (raw: string) => [...raw.replace(/\s+/g, ' ').trim()].slice(0, NAME_MAX).join('')
const memberName = (m: TeamMember) => m.full_name || maskPhone(m.phone)
export const memberStatusText = (m: Pick<TeamMember, 'status' | 'unreachable_at'>): 'Not reachable' | 'Active' | 'Invited' =>
  m.unreachable_at ? 'Not reachable' : m.status === 'active' ? 'Active' : 'Invited'
const outcomeText = (o: InviteOutcome, name: string, team: string) =>
  o === 'invited' ? TEAM_TEXT.inviteSent(name)
    : o === 'already_member' ? TEAM_TEXT.alreadyMember(name, team)
      : o === 'too_soon' ? TEAM_TEXT.inviteTooSoon(name)
        : TEAM_TEXT.inviteFailed(name)

const isManager = (w: Who) => w.t.isManager(w.person.profile_id, w.person.business_id)

async function addAndReport(w: Who, team: Team, phone: string, name: string) {
  const r = await addPersonToTeam(w.t, w.send, { team, phone, name, invitedBy: w.person.profile_id })
  await say(w, outcomeText(r.outcome, name, team.title))
}

/** A team of the manager's business; answers itself (not a manager / team gone) and returns null otherwise. */
async function managedTeam(w: Who, groupId: string): Promise<Team | null> {
  if (!(await isManager(w))) { await say(w, TEAM_TEXT.onlyManagers); return null }
  const team = await w.t.teamById(groupId)
  if (!team || team.business_id !== w.person.business_id) { await say(w, TEAM_TEXT.teamGone); return null }
  return team
}

/**
 * Meta rejects a message whose reply-button or list-row titles repeat, and businesses often name every team "Kitchen":
 * the team name if it is unique (after clipping to `max`), else "name · site", else numbered "(2)", "(3)"…
 */
export function teamTitles(items: { title: string; site: string }[], max: number): string[] {
  const norm = (x: string) => x.replace(/\s+/g, ' ').trim()
  const key = (x: string) => x.toLowerCase()
  const clashes = (list: string[], i: number) => list.filter((y) => key(y) === key(list[i])).length > 1
  const plain = items.map((x) => clip(norm(x.title) || 'Team', max))
  const sited = plain.map((t, i) => (clashes(plain, i) ? clip(`${norm(items[i].title) || 'Team'} · ${norm(items[i].site)}`, max) : t))
  const used = new Set(sited.filter((_, i) => !clashes(sited, i)).map(key))
  return sited.map((t, i) => {
    if (!clashes(sited, i)) return t
    for (let n = 1; ; n++) {
      const suffix = ` (${n})`
      const c = clip(t, max - [...suffix].length) + suffix
      if (!used.has(key(c))) { used.add(key(c)); return c }
    }
  })
}

/** At most TEAM_LIST_MAX teams per message; the rest are named as a count, never dropped silently. */
const firstTeams = (all: Team[]) => ({ shown: all.slice(0, TEAM_LIST_MAX), more: Math.max(0, all.length - TEAM_LIST_MAX) })

export async function handleContactShare(t: TeamDeps, send: SendFn, from: string, person: Person, contact: { name: string; phone: string }): Promise<void> {
  const w: Who = { t, send, from, person }
  if (!(await isManager(w))) { await say(w, TEAM_TEXT.onlyManagers); return }
  const { shown: teams, more } = firstTeams(await t.teamsForBusiness(person.business_id))
  if (!teams.length) { await say(w, TEAM_TEXT.noTeams); return }
  const name = cleanName(contact.name) || 'New person'
  if (teams.length === 1 && !more) return addAndReport(w, teams[0], contact.phone, name)
  const body = TEAM_TEXT.whichTeam(name, maskPhone(contact.phone)) + (more ? `\n${TEAM_TEXT.moreTeams(more)}` : '')
  const id = (team: Team) => `add:${team.id}:${contact.phone}:${name}`
  const sites: string[] = []
  for (const x of teams) sites.push((await t.site(x.site_id))?.name ?? '')
  let r: SendResult
  if (teams.length <= TEAM_BUTTONS_MAX) {
    const titles = teamTitles(teams.map((x, i) => ({ title: x.title, site: sites[i] })), 20)
    r = await post(w, buttonsMessage(from, body, teams.map((x, i) => ({ id: id(x), title: titles[i] }))))
  } else {
    const titles = teamTitles(teams.map((x, i) => ({ title: x.title, site: sites[i] })), 24)
    const rows = teams.map((x, i) => ({ id: id(x), title: titles[i], description: clip(sites[i], 72) }))
    r = await post(w, listMessage(from, { header: 'Add to a team', body, footer: 'Blueroll', button: 'Choose a team', section: 'Teams', rows }))
  }
  // sendTracked already logged the send failure; this says which flow lost its reply (the manager sees nothing).
  if (!r.ok) console.error('whatsapp team picker not delivered', person.business_id, teams.length, r.status, r.errorCode ?? '')
}

export async function sendTeamOverview(t: TeamDeps, send: SendFn, from: string, person: Person): Promise<void> {
  const w: Who = { t, send, from, person }
  if (!(await isManager(w))) { await say(w, TEAM_TEXT.onlyManagers); return }
  const { shown: teams, more } = firstTeams(await t.teamsForBusiness(person.business_id))
  if (!teams.length) { await say(w, TEAM_TEXT.noTeams); return }
  for (const team of teams) {
    const head = TEAM_TEXT.teamHeader(team.title, (await t.site(team.site_id))?.name ?? '')
    const people = (await t.members(team.id)).filter((m) => m.status !== 'removed')
    if (!people.length) { await say(w, `${head}\n${TEAM_TEXT.noPeople}`); continue }
    for (let i = 0; i < people.length; i += MEMBER_ROWS_MAX) {
      const chunk = people.slice(i, i + MEMBER_ROWS_MAX)
      await post(w, listMessage(from, {
        header: clip(head, 60), body: chunk.map((m) => `${memberName(m)} — ${memberStatusText(m)}`).join('\n'),
        footer: 'Blueroll', button: 'Remove someone', section: 'People',
        rows: chunk.map((m) => ({ id: `rm:${m.id}`, title: clip(`Remove ${m.full_name ? firstName(m.full_name) : maskPhone(m.phone)}`, 24), description: clip(memberName(m), 72) })),
      }))
    }
  }
  if (more) await say(w, TEAM_TEXT.moreTeams(more))
}

async function memberOfManagedTeam(w: Who, memberId: string): Promise<{ m: TeamMember; team: Team } | null> {
  if (!(await isManager(w))) { await say(w, TEAM_TEXT.onlyManagers); return null }
  const m = await w.t.memberById(memberId)
  const team = m ? await w.t.teamById(m.group_id) : null
  if (!m || !team || team.business_id !== w.person.business_id) { await say(w, TEAM_TEXT.teamGone); return null }
  return { m, team }
}

/** Buttons and list rows of the manager flows; false = not an admin payload. */
export async function handleAdminButton(t: TeamDeps, send: SendFn, from: string, person: Person, payload: string): Promise<boolean> {
  const w: Who = { t, send, from, person }
  const add = payload.match(ADD_RE)
  if (add) {
    const team = await managedTeam(w, add[1])
    if (team) await addAndReport(w, team, add[2], cleanName(add[3]) || 'New person')
    return true
  }
  const rm = payload.match(/^rm:([0-9a-zA-Z-]+)$/)
  if (rm) {
    const x = await memberOfManagedTeam(w, rm[1])
    if (!x) return true
    if (x.m.status === 'removed') { await say(w, TEAM_TEXT.removed(memberName(x.m), x.team.title)); return true }
    await post(w, buttonsMessage(from, TEAM_TEXT.confirmRemove(memberName(x.m), x.team.title), [{ id: `rmyes:${x.m.id}`, title: 'Remove' }, { id: 'rmno', title: 'Cancel' }]))
    return true
  }
  const yes = payload.match(/^rmyes:([0-9a-zA-Z-]+)$/)
  if (yes) {
    const x = await memberOfManagedTeam(w, yes[1])
    if (!x) return true
    await t.removeMember(x.m.id, t.now())
    await say(w, TEAM_TEXT.removed(memberName(x.m), x.team.title))
    return true
  }
  if (payload === 'rmno') { await say(w, TEAM_TEXT.cancelled); return true }
  return false
}
