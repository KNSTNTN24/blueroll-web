// src/lib/whatsapp/__tests__/groups-db.test.ts
import { describe, it, expect } from 'vitest'
import { telegramDisplayName, pickStaffRole, createChannelOnlyMember } from '../../../../supabase/functions/_shared/channels/members'
import { notifyManagers, makeGroupDeps } from '../../../../supabase/functions/_shared/channels/groups-db'

describe('telegramDisplayName', () => {
  it.each([
    ['Anna', 'Smith', 'Anna S.'],
    ['  Anna  ', '', 'Anna'],
    ['', 'Smith', 'Smith'],
    ['', '', 'Telegram user'],
    ['Ána', 'élan', 'Ána É.'],
    ['Mary  Jane', 'Watson', 'Mary Jane W.'],
  ])('%s / %s → %s', (f, l, want) => expect(telegramDisplayName(f, l)).toBe(want))
  it('is at most 80 characters', () => expect([...telegramDisplayName('A'.repeat(100), 'B')]).toHaveLength(80))
})

describe('pickStaffRole', () => {
  it('prefers the system kitchen_staff role, then any kitchen_staff, then any non-manager role', () => {
    expect(pickStaffRole([{ id: 'm', base_tier: 'manager', is_system: true }, { id: 'k2', base_tier: 'kitchen_staff', is_system: false }, { id: 'k', base_tier: 'kitchen_staff', is_system: true }]))
      .toEqual({ id: 'k', base_tier: 'kitchen_staff' })
    expect(pickStaffRole([{ id: 'k2', base_tier: 'kitchen_staff', is_system: false }])).toEqual({ id: 'k2', base_tier: 'kitchen_staff' })
    expect(pickStaffRole([{ id: 'm', base_tier: 'manager', is_system: true }, { id: 'f', base_tier: 'front_of_house', is_system: true }])).toEqual({ id: 'f', base_tier: 'front_of_house' })
    expect(pickStaffRole([{ id: 'm', base_tier: 'manager', is_system: true }])).toBeNull()
  })
})

function fakeAdmin(fail: { create?: boolean; profile?: boolean; membership?: boolean } = {}) {
  const calls: string[] = []
  const admin = {
    auth: { admin: {
      createUser: async (a: any) => {
        calls.push(`createUser ${a.email.split('+')[0]} ${a.user_metadata.full_name} ${a.ban_duration} ${a.app_metadata.channel_only}`)
        return fail.create ? { data: { user: null }, error: { message: 'x' } } : { data: { user: { id: 'u1' } }, error: null }
      },
      deleteUser: async (id: string) => { calls.push(`deleteUser ${id}`); return { error: null } },
    } },
    from: (t: string) => ({
      insert: async (row: any) => { calls.push(`insert ${t} ${row.full_name} ${row.role} ${row.role_id} ${row.business_id} ${row.site_id}`); return { error: fail.profile ? { message: 'x' } : null } },
      upsert: async (row: any) => { calls.push(`upsert ${t} ${row.profile_id} ${row.site_id}`); return { error: fail.membership ? { message: 'x' } : null } },
      delete: () => ({ eq: async (_c: string, v: string) => { calls.push(`delete ${t} ${v}`); return { error: null } } }),
    }),
  }
  return { admin, calls }
}
const ARGS = { businessId: 'b', siteId: 's1', roleId: 'r-ks', roleTier: 'kitchen_staff', fullName: 'Anna S.', emailPrefix: 'tg' as const }

describe('createChannelOnlyMember', () => {
  it('creates a banned, password-less auth user, a profile and the site membership', async () => {
    const f = fakeAdmin()
    expect(await createChannelOnlyMember(f.admin, ARGS)).toEqual({ ok: true, profileId: 'u1' })
    expect(f.calls).toEqual([
      'createUser tg Anna S. 876000h true',
      'insert profiles Anna S. kitchen_staff r-ks b s1',
      'upsert member_sites u1 s1',
    ])
  })
  it('rolls back on failure', async () => {
    expect(await createChannelOnlyMember(fakeAdmin({ create: true }).admin, ARGS)).toEqual({ ok: false, error: 'create' })
    const p = fakeAdmin({ profile: true })
    expect(await createChannelOnlyMember(p.admin, ARGS)).toEqual({ ok: false, error: 'profile' })
    expect(p.calls.slice(-1)).toEqual(['deleteUser u1'])
    const m = fakeAdmin({ membership: true })
    expect(await createChannelOnlyMember(m.admin, ARGS)).toEqual({ ok: false, error: 'membership' })
    expect(m.calls.slice(-2)).toEqual(['delete profiles u1', 'deleteUser u1'])
  })
})

describe('notifyManagers', () => {
  it('one team notification per active manager', async () => {
    const rows: any[] = []
    await notifyManagers({ managerIds: async () => ['m1', 'm2'], insertNotifications: async (r) => { rows.push(...r) } }, 'b', { title: 'T', message: 'M', link: '/team' })
    expect(rows).toEqual([
      { user_id: 'm1', type: 'team', title: 'T', message: 'M', link: '/team' },
      { user_id: 'm2', type: 'team', title: 'T', message: 'M', link: '/team' },
    ])
  })
})

describe('expireTokens', () => {
  function fakeTokens() {
    const calls: any[] = []
    const admin = { from: (t: string) => ({ update: (p: any) => ({ in: (c: string, v: string[]) => ({ is: async (c2: string, v2: any) => { calls.push({ t, p, c, v, c2, v2 }); return { data: null, error: null } } }) }) }) }
    return { admin, calls }
  }
  it('sets expires_at = now on the given unused tokens', async () => {
    const f = fakeTokens()
    await makeGroupDeps(f.admin).expireTokens(['a', 'b'])
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toMatchObject({ t: 'channel_form_tokens', c: 'token', v: ['a', 'b'], c2: 'used_at', v2: null })
    expect(Date.now() - new Date(f.calls[0].p.expires_at).getTime()).toBeLessThan(5000)
  })
  it('is a no-op for an empty array', async () => {
    const f = fakeTokens()
    await makeGroupDeps(f.admin).expireTokens([])
    expect(f.calls).toEqual([])
  })
})
