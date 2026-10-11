// supabase/functions/_shared/channels/members.ts
// Channel-only team members: no email login, no password (banned auth user + profile + site membership).
// Used by team-create-channel-member (WhatsApp, created by a manager) and the Telegram group form (created on a
// person's first submit). `admin` = service-role supabase-js client, typed loosely. Never logs the synthetic email.
// deno-lint-ignore no-explicit-any
type Any = any

/** Telegram first name + last-name initial: "Anna S."; first name alone; last name alone; else "Telegram user". */
export function telegramDisplayName(first: string, last: string): string {
  const f = first.replace(/\s+/g, ' ').trim()
  const l = last.replace(/\s+/g, ' ').trim()
  const name = f ? (l ? `${f} ${[...l][0].toUpperCase()}.` : f) : (l || 'Telegram user')
  return [...name].slice(0, 80).join('')
}

export function pickStaffRole(roles: { id: string; base_tier: string; is_system: boolean }[]): { id: string; base_tier: string } | null {
  const r = roles.find((x) => x.base_tier === 'kitchen_staff' && x.is_system)
    ?? roles.find((x) => x.base_tier === 'kitchen_staff')
    ?? roles.find((x) => x.base_tier !== 'manager' && x.base_tier !== 'owner')
  return r ? { id: r.id, base_tier: r.base_tier } : null
}

export async function defaultStaffRole(admin: Any, businessId: string): Promise<{ id: string; base_tier: string } | null> {
  const { data, error } = await admin.from('roles').select('id, base_tier, is_system').eq('business_id', businessId).neq('base_tier', 'owner')
  if (error) throw error
  return pickStaffRole((data ?? []) as { id: string; base_tier: string; is_system: boolean }[])
}

/** Undo a half-created member. Logs the user id only when a step fails. */
export async function rollbackMember(admin: Any, pid: string, deleteProfile: boolean): Promise<void> {
  try {
    if (deleteProfile) {
      const { error } = await admin.from('profiles').delete().eq('id', pid)
      if (error) console.error('rollback: profile delete failed', pid)
    }
    const { error } = await admin.auth.admin.deleteUser(pid)
    if (error) console.error('rollback: deleteUser failed', pid)
  } catch (_e) {
    console.error('rollback: exception', pid)
  }
}

export async function createChannelOnlyMember(admin: Any, a: {
  businessId: string; siteId: string; roleId: string; roleTier: string; fullName: string; emailPrefix: 'wa' | 'tg'
}): Promise<{ ok: true; profileId: string } | { ok: false; error: 'create' | 'profile' | 'membership' }> {
  // Synthetic address: never logged, never used for login (no password set). The Team page shows "Chat only" for it.
  const email = `${a.emailPrefix}+${crypto.randomUUID()}@noreply.blueroll.app`
  const { data: created, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, ban_duration: '876000h', app_metadata: { channel_only: true }, user_metadata: { full_name: a.fullName },
  })
  if (error || !created?.user) return { ok: false, error: 'create' }
  const pid = created.user.id as string
  // No trigger on auth.users creates a profile (only the ntfy notifier), so INSERT, as join_with_invite does.
  const { error: pErr } = await admin.from('profiles').insert({
    id: pid, email, full_name: a.fullName, role: a.roleTier, role_id: a.roleId, business_id: a.businessId, site_id: a.siteId,
  })
  if (pErr) { await rollbackMember(admin, pid, false); return { ok: false, error: 'profile' } }
  const { error: mErr } = await admin.from('member_sites').upsert({ profile_id: pid, site_id: a.siteId }, { onConflict: 'profile_id,site_id', ignoreDuplicates: true })
  if (mErr) { await rollbackMember(admin, pid, true); return { ok: false, error: 'membership' } }
  return { ok: true, profileId: pid }
}
