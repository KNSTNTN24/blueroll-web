// supabase/functions/_shared/reviews/reviews-db.ts
// Supabase (service role) implementation of ReviewDeps and ConnectDeps. `admin` is typed loosely to keep this file
// import-free (Vitest loads it). Never logs tokens or Telegram user ids.
import { pageAll } from '../channels/db.ts'
import { GoogleError, type Google } from './google.ts'
import type { ReviewDeps } from './deps.ts'
import type { ConnectDeps, PrevLocation } from './connect.ts'
import { DEFAULT_SETTINGS, type Connection, type Review } from './types.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const CONN_COLS = 'id, business_id, google_email, vault_secret_id, status, connected_at, last_sync_at'
const LOC_COLS = 'id, connection_id, business_id, gbp_account, gbp_location, title, address, postcode, maps_uri, can_reply, site_id, enabled, enabled_at, last_review_update_time, last_full_pass_at'
const REVIEW_COLS = 'id, business_id, location_id, site_id, google_review_id, version, delivered_version, stars, comment, reviewer_name, create_time, update_time, google_reply, google_reply_time, language, flags, notify, status, published_text, published_at, published_by_name, skipped_at, skipped_by_name'
const DRAFT_COLS = 'id, review_id, review_version, draft_version, text, source, author_name, created_at'
const OPEN = ['new', 'drafted']
const PUBLISHABLE = ['new', 'drafted', 'skipped']
const TOKEN_TTL_MS = 50 * 60_000   // Google access tokens live 60 min; a warm function instance reuses ours for 50

// Rethrows the ORIGINAL error object: callers rely on its Postgres `code` (insertDraft's unique violation is '23505').
async function one(q: Any): Promise<Any> { const { data, error } = await q; if (error) throw error; return data }
// profiles_with_capability returns setof uuid; PostgREST may send bare ids or { profiles_with_capability: id } rows.
const capabilityIds = (rows: Any): string[] => ((rows ?? []) as Any[])
  .map((x: Any) => (typeof x === 'string' ? x : String(Object.values(x ?? {})[0] ?? ''))).filter(Boolean)
const asReview = (r: Any): Review => ({ ...r, flags: r.flags ?? [] })

export function makeReviewDeps(admin: Any, google: Google): ReviewDeps {
  const tokens = new Map<string, { at: string; exp: number }>()
  const readToken = async (id: string): Promise<string | null> => (await one(admin.rpc('reviews_read_token', { p_id: id }))) ?? null

  return {
    now: () => new Date(),
    entitled: async (b) => !!(await one(admin.rpc('is_business_entitled', { p_business_id: b }))),
    businessName: async (b) => (await one(admin.from('businesses').select('name').eq('id', b).maybeSingle()))?.name || 'your restaurant',
    settings: async (b) => {
      const r = await one(admin.from('review_settings').select('tone, sign_off, avoid, contact, examples').eq('business_id', b).maybeSingle())
      return r ? { ...DEFAULT_SETTINGS, ...r, examples: r.examples ?? [] } : { ...DEFAULT_SETTINGS }
    },
    site: async (id) => {
      const s = await one(admin.from('sites').select('id, name, timezone, postcode').eq('id', id).maybeSingle())
      return s ? { id: s.id, name: s.name ?? '', timezone: s.timezone ?? 'Europe/London', postcode: s.postcode ?? '' } : null
    },

    activeConnections: async () => (await one(admin.from('google_connections').select(CONN_COLS).eq('status', 'active').order('id'))) ?? [],
    activeConnection: async (b) => (await one(admin.from('google_connections').select(CONN_COLS).eq('business_id', b).eq('status', 'active').maybeSingle())) ?? null,
    accessToken: async (c: Connection) => {
      const hit = tokens.get(c.id)
      if (hit && hit.exp > Date.now()) return hit.at
      const rt = c.vault_secret_id ? await readToken(c.vault_secret_id) : null
      if (!rt) throw new GoogleError('invalid_grant', 400, 'no stored token')
      const at = await google.refresh(rt)
      tokens.set(c.id, { at, exp: Date.now() + TOKEN_TTL_MS })
      return at
    },
    connectionFailed: async (c, message) => {
      tokens.delete(c.id)
      return !!(await one(admin.from('google_connections').update({ status: 'error', last_error: message.slice(0, 300) }).eq('id', c.id).eq('status', 'active').select('id')))?.length
    },
    touchConnection: async (id, now) => { await one(admin.from('google_connections').update({ last_sync_at: now.toISOString() }).eq('id', id)) },
    location: async (id) => (await one(admin.from('google_locations').select(LOC_COLS).eq('id', id).maybeSingle())) ?? null,
    // A removed site keeps its location rows; sync skips them (inner join also drops rows with no site, which sync skips anyway).
    enabledLocations: async (cid) => ((await one(admin.from('google_locations').select(`${LOC_COLS}, site:sites!inner(removed_at)`)
      .eq('connection_id', cid).eq('enabled', true).is('site.removed_at', null))) ?? [])
      .filter((l: Any) => !l.site?.removed_at).map(({ site: _s, ...l }: Any) => l),
    saveCursor: async (id, p) => { await one(admin.from('google_locations').update(p).eq('id', id)) },

    review: async (id) => { const r = await one(admin.from('reviews').select(REVIEW_COLS).eq('id', id).maybeSingle()); return r ? asReview(r) : null },
    reviewsByGoogleId: async (b, ids) => {
      if (!ids.length) return new Map()
      const rows = (await one(admin.from('reviews').select(REVIEW_COLS).eq('business_id', b).in('google_review_id', ids))) ?? []
      return new Map((rows as Any[]).map((r) => [r.google_review_id as string, asReview(r)]))
    },
    insertReview: async (n) => asReview(await one(admin.from('reviews').insert(n).select(REVIEW_COLS).single())),
    patchReview: async (id, p) => { await one(admin.from('reviews').update(p).eq('id', id)) },
    liveReviewsAt: async (lid) => (await pageAll<Any>((from, to) => admin.from('reviews').select(REVIEW_COLS).eq('location_id', lid)
      .neq('status', 'deleted').order('id').range(from, to))).map(asReview),
    pending: async (b, limit) => ((await one(admin.from('reviews').select(REVIEW_COLS).eq('business_id', b).eq('notify', true)
      .in('status', OPEN).not('site_id', 'is', null).order('update_time', { ascending: true }).limit(limit))) ?? []).map(asReview),
    claimDelivery: async (id, v) => !!(await one(admin.from('reviews').update({ notify: false })
      .eq('id', id).eq('version', v).eq('notify', true).select('id')))?.length,
    setNotify: async (id, v, value) => { await one(admin.from('reviews').update({ notify: value }).eq('id', id).eq('version', v)) },
    markDelivered: async (id, v) => { await one(admin.from('reviews').update({ delivered_version: v, notify: false }).eq('id', id).eq('version', v)) },
    openReviewsWithCards: async (b) => ((await one(admin.from('reviews').select(`${REVIEW_COLS}, review_cards!inner(message_id)`)
      .eq('business_id', b).in('status', OPEN))) ?? []).map(({ review_cards: _c, ...r }: Any) => asReview(r)),
    openReviewsForSites: async (b, siteIds, limit) => ((await one(admin.from('reviews').select(REVIEW_COLS).eq('business_id', b)
      .in('site_id', siteIds).in('status', OPEN).order('update_time', { ascending: false }).limit(limit))) ?? []).map(asReview),
    claimPublishing: async (id, v, actor) => !!(await one(admin.from('reviews')
      .update({ status: 'publishing', publishing_by: actor.name, publishing_at: new Date().toISOString() })
      .eq('id', id).eq('version', v).in('status', PUBLISHABLE).select('id')))?.length,
    releaseStalePublishing: async (olderThan) => ((await one(admin.from('reviews')
      .update({ status: 'drafted', publishing_by: null, publishing_at: null })
      .eq('status', 'publishing').lt('publishing_at', olderThan.toISOString()).select('id'))) ?? []).length,
    releasePublishing: async (id) => {
      await one(admin.from('reviews').update({ status: 'drafted', publishing_by: null, publishing_at: null }).eq('id', id).eq('status', 'publishing'))
    },
    markPublished: async (id, p) => {
      await one(admin.from('reviews').update({
        status: 'published', published_text: p.text, published_at: p.at, published_by_name: p.actor.name,
        published_by_profile: p.actor.profile_id, published_by_channel: p.actor.channel,
        google_reply: p.text, google_reply_time: p.at, publishing_by: null, publishing_at: null,
      }).eq('id', id).eq('status', 'publishing'))
    },
    markSkipped: async (id, actor, at) => !!(await one(admin.from('reviews').update({ status: 'skipped', skipped_by_name: actor.name, skipped_at: at })
      .eq('id', id).in('status', OPEN).select('id')))?.length,
    setDrafted: async (id, p) => {
      const patch: Record<string, unknown> = {}
      if (p.language !== undefined) patch.language = p.language
      if (p.flags) patch.flags = p.flags
      if (Object.keys(patch).length) await one(admin.from('reviews').update(patch).eq('id', id))
      await one(admin.from('reviews').update({ status: 'drafted' }).eq('id', id).in('status', ['new', 'skipped']))
    },

    drafts: async (rid, v) => (await one(admin.from('review_drafts').select(DRAFT_COLS).eq('review_id', rid).eq('review_version', v)
      .order('draft_version', { ascending: true }))) ?? [],
    lastDraftVersion: async (rid) => {
      const rows = (await one(admin.from('review_drafts').select('draft_version').eq('review_id', rid).order('draft_version', { ascending: false }).limit(1))) ?? []
      return rows[0]?.draft_version ?? 0
    },
    // A unique violation on (review_id, review_version, draft_version) surfaces as the supabase-js error with code '23505'
    // (one() rethrows it untouched); callers retry with the next number.
    insertDraft: async (x) => await one(admin.from('review_drafts').insert({
      review_id: x.review_id, review_version: x.review_version, draft_version: x.draft_version, text: x.text, source: x.source,
      author_profile: x.actor?.profile_id ?? null, author_channel: x.actor?.channel ?? null,
      author_external_id: x.actor?.external_id ?? null, author_name: x.actor?.name ?? null,
    }).select(DRAFT_COLS).single()),

    routedGroups: async (b, siteId) => ((await one(admin.from('review_routes')
      .select('site:sites!inner(removed_at), group:channel_groups!inner(id, business_id, chat_id, channel, unlinked_at)')
      .eq('site_id', siteId).eq('business_id', b).eq('group.channel', 'telegram_reviews').is('group.unlinked_at', null)
      .is('site.removed_at', null))) ?? [])
      .filter((r: Any) => !r.site?.removed_at).map((r: Any) => r.group).filter((g: Any) => g && g.business_id === b && g.channel === 'telegram_reviews' && !g.unlinked_at)
      .map((g: Any) => ({ id: g.id, business_id: g.business_id, chat_id: g.chat_id })),
    groupSites: async (gid) => ((await one(admin.from('review_routes').select('site_id').eq('group_id', gid))) ?? []).map((r: Any) => r.site_id as string),
    reviewGroups: async (b) => (await one(admin.from('channel_groups').select('id, business_id, chat_id').eq('business_id', b)
      .eq('channel', 'telegram_reviews').is('unlinked_at', null))) ?? [],
    deleteRoutes: async (gid) => { await one(admin.from('review_routes').delete().eq('group_id', gid)) },
    cards: async (rid) => (await one(admin.from('review_cards').select('review_id, chat_id, message_id').eq('review_id', rid))) ?? [],
    saveCard: async (c) => { await one(admin.from('review_cards').insert(c)) },
    dropCard: async (c) => { await one(admin.from('review_cards').delete().eq('chat_id', c.chat_id).eq('message_id', c.message_id)) },
    migrateCards: async (o, n) => { await one(admin.from('review_cards').update({ chat_id: n }).eq('chat_id', o)) },
    saveEditPrompt: async (p) => { await one(admin.from('review_edit_prompts').insert(p)) },
    editPrompt: async (c, m) => (await one(admin.from('review_edit_prompts')
      .select('chat_id, prompt_message_id, card_message_id, review_id, review_version, user_id, expires_at')
      .eq('chat_id', c).eq('prompt_message_id', m).maybeSingle())) ?? null,
    dropEditPrompt: async (c, m) => { await one(admin.from('review_edit_prompts').delete().eq('chat_id', c).eq('prompt_message_id', m)) },

    reviewManagerIds: async (b) => capabilityIds(await one(admin.rpc('profiles_with_capability', { b, cap: 'manage_reviews' }))),
    notify: async (rows) => {
      if (!rows.length) return
      await one(admin.from('notifications').insert(rows.map((r) => ({ ...r, type: 'team' }))))
    },
    audit: async (a) => {
      await one(admin.from('review_audit').insert({
        review_id: a.review_id, business_id: a.business_id, action: a.action, actor_profile: a.actor.profile_id,
        actor_channel: a.actor.channel, actor_external_id: a.actor.external_id, actor_name: a.actor.name, details: a.details ?? {},
      }))
    },
    logOut: async (a) => {
      const { error } = await admin.from('channel_messages_log').insert({
        business_id: a.business_id, site_id: a.site_id, profile_id: null, channel: 'telegram_reviews', direction: 'out',
        kind: a.kind, billable: false, ref_id: a.ref_id,
      })
      if (error) console.error('review log failed', String(error.message ?? error).slice(0, 200))
    },

    deletedBusinessConnections: async () => ((await one(admin.from('google_connections').select(`${CONN_COLS}, business:businesses!inner(deleted_at)`)
      .neq('status', 'revoked').not('business.deleted_at', 'is', null))) ?? []).map(({ business: _b, ...c }: Any) => c),
    readToken,
    deleteToken: async (id) => { await one(admin.rpc('reviews_delete_token', { p_id: id })) },
    markRevoked: async (id, now) => {
      tokens.delete(id)
      await one(admin.from('google_connections').update({ status: 'revoked', revoked_at: now.toISOString(), vault_secret_id: null }).eq('id', id))
    },
    cleanup: async (now) => {
      await one(admin.from('google_oauth_states').delete().lt('expires_at', new Date(now.getTime() - 86_400_000).toISOString()))
      await one(admin.from('review_edit_prompts').delete().lt('expires_at', now.toISOString()))
      await one(admin.from('review_audit').delete().lt('at', new Date(now.getTime() - 730 * 86_400_000).toISOString()))
    },
  }
}

export function makeConnectDeps(admin: Any, onDisconnected: (b: string) => Promise<void>): ConnectDeps {
  return {
    now: () => new Date(),
    saveState: async (s) => { await one(admin.from('google_oauth_states').insert(s)) },
    takeState: async (state, now) => {
      const nowIso = now.toISOString()
      const rows = await one(admin.from('google_oauth_states').update({ used_at: nowIso }).eq('state', state)
        .is('used_at', null).gt('expires_at', nowIso).select('state, business_id, profile_id, code_verifier, expires_at'))
      return rows?.[0] ?? null
    },
    stillAllowed: async (p, b) => {
      const me = await one(admin.from('profiles').select('id').eq('id', p).eq('business_id', b).is('removed_at', null).maybeSingle())
      if (!me) return false
      if (!capabilityIds(await one(admin.rpc('profiles_with_capability', { b, cap: 'manage_reviews' }))).includes(p)) return false
      return !!(await one(admin.rpc('is_business_entitled', { p_business_id: b })))
    },
    liveConnection: async (b) => (await one(admin.from('google_connections').select(CONN_COLS).eq('business_id', b).neq('status', 'revoked').maybeSingle())) ?? null,
    storeToken: async (token, name) => String(await one(admin.rpc('reviews_store_token', { p_token: token, p_name: name }))),
    readToken: async (id) => (await one(admin.rpc('reviews_read_token', { p_id: id }))) ?? null,
    deleteToken: async (id) => { await one(admin.rpc('reviews_delete_token', { p_id: id })) },
    insertConnection: async (c) => await one(admin.from('google_connections').insert({
      business_id: c.business_id, google_email: c.google_email, vault_secret_id: c.vault_secret_id, scopes: c.scopes,
      connected_by: c.connected_by, connected_at: c.now.toISOString(), status: 'active',
    }).select(CONN_COLS).single()),
    markRevoked: async (id, now) => {
      await one(admin.from('google_connections').update({ status: 'revoked', revoked_at: now.toISOString(), vault_secret_id: null }).eq('id', id))
    },
    previousMapping: async (b) => {
      const rows = (await one(admin.from('google_locations')
        .select('gbp_location, site_id, enabled, enabled_at, last_review_update_time, last_full_pass_at').eq('business_id', b)
        .order('created_at', { ascending: false }))) ?? []
      const m = new Map<string, PrevLocation>()
      for (const r of rows as Any[]) {
        if (m.has(r.gbp_location)) continue
        m.set(r.gbp_location, {
          site_id: r.site_id, enabled: !!r.enabled, enabled_at: r.enabled_at ?? null,
          last_review_update_time: r.last_review_update_time ?? null, last_full_pass_at: r.last_full_pass_at ?? null,
        })
      }
      return m
    },
    upsertLocations: async (rows) => {
      for (const r of rows) {
        const ex = await one(admin.from('google_locations').select('id').eq('connection_id', r.connection_id).eq('gbp_location', r.gbp_location).maybeSingle())
        if (!ex) { await one(admin.from('google_locations').insert(r)); continue }
        await one(admin.from('google_locations').update({
          gbp_account: r.gbp_account, title: r.title, address: r.address, postcode: r.postcode, maps_uri: r.maps_uri, can_reply: r.can_reply,
          ...(r.can_reply ? {} : { enabled: false }),
        }).eq('id', ex.id))
      }
    },
    // No UPDATE … FROM over PostgREST: one select of the older rows and one conditional update per location.
    repointReviews: async (b, cid) => {
      for (const l of ((await one(admin.from('google_locations').select('id, gbp_location, site_id').eq('connection_id', cid))) ?? []) as Any[]) {
        const older = ((await one(admin.from('google_locations').select('id').eq('business_id', b).eq('gbp_location', l.gbp_location)
          .neq('id', l.id))) ?? []).map((x: Any) => x.id as string)
        if (!older.length) continue
        await one(admin.from('reviews').update({ location_id: l.id, ...(l.site_id ? { site_id: l.site_id } : {}) })
          .eq('business_id', b).in('location_id', older))
      }
    },
    sites: async (b) => ((await one(admin.from('sites').select('id, name, timezone, postcode, status').eq('business_id', b).is('removed_at', null))) ?? [])
      .filter((s: Any) => s.status !== 'removed')
      .map((s: Any) => ({ id: s.id, name: s.name ?? '', timezone: s.timezone ?? 'Europe/London', postcode: s.postcode ?? '' })),
    onDisconnected,
  }
}