// supabase/functions/_shared/channels/team-text.ts
// WhatsApp team copy (spec 2026-10-12 §3–§6). Plain text, English; tests pin the spec's strings verbatim.
export const TEAM_TEXT = {
  notInTeam: "You're not in a team yet — ask your manager to add you.",
  noLongerIn: (team: string) => `You're no longer in ${team}.`,
  alreadyDone: (by: string | null, time: string) => `Already done ✓${by ? ` by ${by}` : ''} ${time}`,
  allDone: (team: string) => `🎉 All ${team} checks done today`,
  joined: (team: string, site: string) => `You're in ${team} at ${site} ✓`,
  managerJoined: (name: string, team: string) => `${name} joined ${team} ✓`,
  inviteExpired: 'This invite has expired — ask your manager to add you again.',
  unavailable: "Blueroll checks aren't available for your team right now. Please use the Blueroll app.",
  onlyManagers: 'Only managers can add people to teams.',
  noTeams: 'Create a team in Blueroll → Settings → Messaging first.',
  whichTeam: (name: string, masked: string) => `Add ${name} (${masked}) to which team?`,
  moreTeams: (n: number) => `+${n} more team${n === 1 ? '' : 's'} in Blueroll → Settings → Messaging.`,
  inviteSent: (name: string) => `Invite sent to ${name} ✓`,
  alreadyMember: (name: string, team: string) => `${name} is already in ${team}.`,
  inviteTooSoon: (name: string) => `An invite went to ${name} less than an hour ago — try again later.`,
  inviteFailed: (name: string) => `Couldn't send the invite to ${name}. Try again from Blueroll → Settings → Messaging.`,
  teamHeader: (team: string, site: string) => `${team} · ${site}`,
  noPeople: 'No people yet. Share a contact with me to add someone.',
  confirmRemove: (name: string, team: string) => `Remove ${name} from ${team}?`,
  removed: (name: string, team: string) => `${name} removed from ${team}.`,
  cancelled: 'Cancelled.',
  teamGone: 'This team no longer exists.',
  summary: (team: string, site: string, done: number, total: number, missed: string) =>
    `${team} at ${site} today: ${done} of ${total} done. Missed: ${missed}.`,
  joinedTitle: 'Joined WhatsApp team',
  missedTitle: (team: string) => `${team}: checks missed today`,
} as const

/** First word of a full name ('' when empty). */
export const firstName = (fullName: string): string => fullName.trim().split(/\s+/)[0] ?? ''
