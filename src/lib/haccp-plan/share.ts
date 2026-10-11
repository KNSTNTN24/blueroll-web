import { supabase } from '@/lib/supabase'

// HACCP Plan share links. The token is shown once; only sha256(token) is stored.

export const TTL = { pdf: 10 * 60_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 }

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function planUrl(origin: string, token: string): string {
  return `${origin}/plan/${token}`
}

export async function createShare(p: {
  kind: 'inspector' | 'pdf'
  businessId: string
  siteId: string | null
  userId: string
  label?: string
  ttlMs: number
}): Promise<{ token: string; url: string; expiresAt: string }> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + p.ttlMs).toISOString()
  const { error } = await supabase.from('haccp_plan_shares').insert({
    business_id: p.businessId,
    site_id: p.siteId,
    kind: p.kind,
    token_hash: await sha256Hex(token),
    label: p.label?.trim() ? p.label.trim().slice(0, 80) : null,
    created_by: p.userId,
    expires_at: expiresAt,
  })
  if (error) throw error
  return { token, url: planUrl(window.location.origin, token), expiresAt }
}

export interface InspectorShare {
  id: string
  label: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
  view_count: number
  last_viewed_at: string | null
}

export async function listInspectorShares(businessId: string, siteId: string | null): Promise<InspectorShare[]> {
  let q = supabase
    .from('haccp_plan_shares')
    .select('id, label, created_at, expires_at, revoked_at, view_count, last_viewed_at')
    .eq('business_id', businessId)
    .eq('kind', 'inspector')
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  q = siteId ? q.eq('site_id', siteId) : q.is('site_id', null)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as InspectorShare[]
}

export async function revokeShare(id: string): Promise<void> {
  const { error } = await supabase.from('haccp_plan_shares').update({ revoked_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
