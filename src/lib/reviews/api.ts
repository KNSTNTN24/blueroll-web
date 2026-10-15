// Web client for Google reviews (spec §3, §11). Reads and the three client-writable things (location site/sync,
// routes, reply style) go through RLS (manage_reviews); everything else goes through edge functions.
import { supabase } from '@/lib/supabase'
import { routeDiff, type WebReview } from './format'
import { stateCookie, stateFromAuthUrl } from './oauth-state'

export interface GoogleConnection { id: string; google_email: string; status: 'active' | 'error' | 'revoked'; last_error: string | null; connected_at: string; last_sync_at: string | null }
export interface GoogleLocationRow { id: string; title: string; address: string; postcode: string; can_reply: boolean; site_id: string | null; enabled: boolean }
export interface ReviewGroup { id: string; title: string; linked_at: string; site_ids: string[] }
export interface ReplyStyle { tone: 'warm' | 'neutral' | 'formal'; sign_off: string; avoid: string; contact: string; examples: string[] }
export const DEFAULT_STYLE: ReplyStyle = { tone: 'warm', sign_off: '', avoid: '', contact: '', examples: [] }
export const LINK_CODE_TTL_SEC = 900

async function callFn<T = Record<string, unknown>>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const j = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    throw new Error((j && (j.text || j.error)) || error.message)
  }
  return data as T
}

export async function canManageReviews(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_capability', { cap: 'manage_reviews' })
  return !error && !!data
}

export async function getConnection(businessId: string): Promise<GoogleConnection | null> {
  const { data, error } = await supabase.from('google_connections')
    .select('id, google_email, status, last_error, connected_at, last_sync_at')
    .eq('business_id', businessId).neq('status', 'revoked').maybeSingle()
  if (error) throw error
  return data as GoogleConnection | null
}

export async function listLocations(connectionId: string): Promise<GoogleLocationRow[]> {
  const { data, error } = await supabase.from('google_locations')
    .select('id, title, address, postcode, can_reply, site_id, enabled').eq('connection_id', connectionId).order('title')
  if (error) throw error
  return (data ?? []) as GoogleLocationRow[]
}

export async function updateLocation(id: string, patch: { site_id?: string | null; enabled?: boolean }): Promise<void> {
  const { error } = await supabase.from('google_locations').update(patch).eq('id', id)
  if (error) throw error
}

export async function listReviewGroups(businessId: string): Promise<ReviewGroup[]> {
  const { data, error } = await supabase.from('channel_groups')
    .select('id, title, linked_at, review_routes(site_id)')
    .eq('business_id', businessId).eq('channel', 'telegram_reviews').is('unlinked_at', null).order('linked_at')
  if (error) throw error
  return ((data ?? []) as unknown as { id: string; title: string | null; linked_at: string; review_routes: { site_id: string }[] | null }[])
    .map((g) => ({ id: g.id, title: g.title || 'Telegram group', linked_at: g.linked_at, site_ids: (g.review_routes ?? []).map((r) => r.site_id) }))
}

export async function issueReviewsLinkCode(): Promise<string> {
  const { data, error } = await supabase.rpc('issue_group_link_code', { p_channel: 'telegram_reviews' })
  if (error) throw error
  return data as string
}

export async function setGroupSites(businessId: string, groupId: string, current: string[], next: string[]): Promise<void> {
  const { add, remove } = routeDiff(current, next)
  if (remove.length) {
    const { error } = await supabase.from('review_routes').delete().eq('group_id', groupId).in('site_id', remove)
    if (error) throw error
  }
  if (add.length) {
    const { error } = await supabase.from('review_routes').insert(add.map((site_id) => ({ site_id, group_id: groupId, business_id: businessId })))
    if (error) throw error
  }
}

export async function unlinkReviewGroup(groupId: string): Promise<void> {
  const { error } = await supabase.from('channel_groups').update({ unlinked_at: new Date().toISOString() }).eq('id', groupId)
  if (error) throw error
}

export async function getReplyStyle(businessId: string): Promise<ReplyStyle> {
  const { data, error } = await supabase.from('review_settings').select('tone, sign_off, avoid, contact, examples').eq('business_id', businessId).maybeSingle()
  if (error) throw error
  return data ? { ...DEFAULT_STYLE, ...(data as ReplyStyle), examples: (data as ReplyStyle).examples ?? [] } : { ...DEFAULT_STYLE }
}

export async function saveReplyStyle(businessId: string, s: ReplyStyle): Promise<void> {
  const examples = s.examples.map((e) => e.trim()).filter(Boolean).slice(0, 3)
  const { error } = await supabase.from('review_settings').upsert({ business_id: businessId, ...s, examples, updated_at: new Date().toISOString() })
  if (error) throw error
}

/** Returns Google's consent URL; first binds its state to this browser (checked by /api/google/callback). */
export async function startGoogleConnect(): Promise<string> {
  const { url } = await callFn<{ url: string }>('google-connect', { action: 'start' })
  document.cookie = stateCookie(stateFromAuthUrl(url))
  return url
}
export const disconnectGoogle = () => callFn('google-connect', { action: 'disconnect' })
export const refreshLocations = () => callFn('google-connect', { action: 'refresh' })
export const syncNow = () => callFn<{ connections: number; delivered: number }>('google-connect', { action: 'sync_now' })

export async function listReviews(businessId: string, siteId: string | null): Promise<WebReview[]> {
  let q = supabase.from('reviews')
    .select('id, site_id, stars, comment, reviewer_name, update_time, status, flags, version, google_reply, published_text, published_at, published_by_name, skipped_by_name, review_drafts(review_version, draft_version, text, source, author_name, created_at)')
    .eq('business_id', businessId).order('update_time', { ascending: false }).limit(200)
  if (siteId) q = q.eq('site_id', siteId)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as WebReview[]).map((r) => ({ ...r, flags: r.flags ?? [], review_drafts: r.review_drafts ?? [] }))
}

export type ReviewActionBody =
  | { action: 'publish'; review_id: string; draft_version: number }
  | { action: 'skip' | 'another' | 'draft'; review_id: string }
  | { action: 'edit'; review_id: string; review_version: number; text: string }
export const reviewAction = (body: ReviewActionBody) => callFn<{ ok: boolean; outcome: string; text: string }>('reviews-action', body)
