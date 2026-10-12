// src/lib/whatsapp/__tests__/teams.test.ts
import { describe, it, expect } from 'vitest'
import { memberStatusLabel, canResend, teamChannelLabel, teamApiError, TEAM_SHARE_HINT } from '../teams'

describe('WhatsApp teams web helpers', () => {
  it('status labels: Not reachable wins, then Active / Invited', () => {
    expect(memberStatusLabel({ status: 'active', unreachable: false })).toBe('Active')
    expect(memberStatusLabel({ status: 'invited', unreachable: false })).toBe('Invited')
    expect(memberStatusLabel({ status: 'invited', unreachable: true })).toBe('Not reachable')
  })
  it('resend: invited members, at most once per hour', () => {
    const now = Date.parse('2026-10-14T10:00:00Z')
    expect(canResend({ status: 'invited', last_invite_sent_at: '2026-10-14T09:00:00Z' }, now)).toBe(true)
    expect(canResend({ status: 'invited', last_invite_sent_at: '2026-10-14T09:30:00Z' }, now)).toBe(false)
    expect(canResend({ status: 'invited', last_invite_sent_at: null }, now)).toBe(true)
    expect(canResend({ status: 'active', last_invite_sent_at: null }, now)).toBe(false)
  })
  it('Team page channel column: "WhatsApp · <team>", else "Invited", else nothing', () => {
    expect(teamChannelLabel([{ title: 'Kitchen', status: 'active' }, { title: 'Bar', status: 'active' }])).toBe('WhatsApp · Kitchen, Bar')
    expect(teamChannelLabel([{ title: 'Kitchen', status: 'invited' }])).toBe('Invited')
    expect(teamChannelLabel([{ title: 'Kitchen', status: 'invited' }, { title: 'Bar', status: 'active' }])).toBe('WhatsApp · Bar')
    expect(teamChannelLabel([])).toBeNull()
  })
  it('error codes become sentences; unknown messages pass through', () => {
    expect(teamApiError('too_soon')).toBe('An invite went out less than an hour ago — try again later.')
    expect(teamApiError('template')).toBe("WhatsApp hasn't approved the invite message yet — try again later.")
    expect(teamApiError('new row violates row-level security policy')).toBe('new row violates row-level security policy')
    expect(TEAM_SHARE_HINT).toBe('Managers can also add people from WhatsApp — share a contact with the Blueroll bot.')
  })
})
