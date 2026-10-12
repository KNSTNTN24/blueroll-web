import { describe, it, expect } from 'vitest'
import { TEAM_TEXT, firstName } from '../../../../supabase/functions/_shared/channels/team-text'
import { SERVICE_WINDOW_MS, isBillable } from '../../../../supabase/functions/_shared/channels/service-window'
import { isBillable as fromBot } from '../../../../supabase/functions/_shared/channels/bot'

describe('team copy (spec strings, verbatim)', () => {
  it('member side', () => {
    expect(TEAM_TEXT.notInTeam).toBe("You're not in a team yet — ask your manager to add you.")
    expect(TEAM_TEXT.noLongerIn('Kitchen')).toBe("You're no longer in Kitchen.")
    expect(TEAM_TEXT.alreadyDone('Anna', '08:47')).toBe('Already done ✓ by Anna 08:47')
    expect(TEAM_TEXT.alreadyDone(null, '08:47')).toBe('Already done ✓ 08:47')
    expect(TEAM_TEXT.allDone('Kitchen')).toBe('🎉 All Kitchen checks done today')
    expect(TEAM_TEXT.joined('Kitchen', 'Ashfield Row')).toBe("You're in Kitchen at Ashfield Row ✓")
    expect(TEAM_TEXT.managerJoined('Anna', 'Kitchen')).toBe('Anna joined Kitchen ✓')
    expect(TEAM_TEXT.inviteExpired).toBe('This invite has expired — ask your manager to add you again.')
    expect(TEAM_TEXT.summary('Kitchen', 'Ashfield Row', 2, 3, 'Fridge temps')).toBe('Kitchen at Ashfield Row today: 2 of 3 done. Missed: Fridge temps.')
  })
  it('manager side', () => {
    expect(TEAM_TEXT.onlyManagers).toBe('Only managers can add people to teams.')
    expect(TEAM_TEXT.noTeams).toBe('Create a team in Blueroll → Settings → Messaging first.')
    expect(TEAM_TEXT.whichTeam('Maria', '+44 7••• ••23')).toBe('Add Maria (+44 7••• ••23) to which team?')
    expect(TEAM_TEXT.inviteSent('Maria')).toBe('Invite sent to Maria ✓')
  })
  it('firstName', () => {
    expect(firstName('  Anna   Smith ')).toBe('Anna')
    expect(firstName('')).toBe('')
  })
  it('service window: free within 24 h of the last inbound; bot.ts re-exports the same function', () => {
    const now = new Date('2026-10-14T09:40:00Z')
    expect(SERVICE_WINDOW_MS).toBe(24 * 3600 * 1000)
    expect(isBillable('2026-10-14T01:00:00Z', now)).toBe(false)
    expect(isBillable('2026-10-13T09:00:00Z', now)).toBe(true)
    expect(isBillable(null, now)).toBe(true)
    expect(fromBot).toBe(isBillable)
  })
})
