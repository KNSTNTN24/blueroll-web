// supabase/functions/_shared/reviews/connect.ts
// Spec §3, §5: "Connect Google" from Settings. start → Google consent → finish (from the Next callback route, authorised
// by the single-use state alone) → token in Vault, locations listed and matched to sites. Disconnect revokes at Google.
// Pure over ConnectDeps + Google; google-connect/index.ts does auth and wiring.
import { GOOGLE_SCOPE_MANAGE, type Google, type GLocation } from './google.ts'
import { suggestSite } from './match.ts'
import type { Connection, Location, SiteLite } from './types.ts'

export interface OAuthState { state: string; business_id: string; profile_id: string; code_verifier: string; expires_at: string }
export type LocationUpsert = Omit<Location, 'id'>
/** The newest earlier row of a Google location in this business: carried over on reconnect so sync continues. */
export type PrevLocation = Pick<Location, 'site_id' | 'enabled' | 'enabled_at' | 'last_review_update_time' | 'last_full_pass_at'>
export interface ConnectDeps {
  now(): Date
  saveState(s: OAuthState): Promise<void>
  takeState(state: string, now: Date): Promise<OAuthState | null>
  /** The person who started the flow is still an active member of b holding manage_reviews, and b is entitled. */
  stillAllowed(profileId: string, businessId: string): Promise<boolean>
  liveConnection(b: string): Promise<Connection | null>
  storeToken(token: string, name: string): Promise<string>
  readToken(secretId: string): Promise<string | null>
  deleteToken(secretId: string): Promise<void>
  insertConnection(c: { business_id: string; google_email: string; vault_secret_id: string; scopes: string[]; connected_by: string; now: Date }): Promise<Connection>
  markRevoked(id: string, now: Date): Promise<void>
  previousMapping(b: string): Promise<Map<string, PrevLocation>>
  upsertLocations(rows: LocationUpsert[]): Promise<void>
  /** Reviews still on older rows of a Google location (same business) move to this connection's row for it (and its site, when set). */
  repointReviews(businessId: string, connectionId: string): Promise<void>
  sites(b: string): Promise<SiteLite[]>
  onDisconnected(b: string): Promise<void>
}
export interface Caller { profile_id: string; business_id: string; name: string }
export interface ApiRes { status: number; body: Record<string, unknown> }
export const CONNECT_ERRORS = ['denied', 'expired', 'missing_scope', 'no_refresh_token', 'no_accounts', 'no_locations', 'google'] as const
type ConnectError = (typeof CONNECT_ERRORS)[number]

const STATE_TTL_MS = 10 * 60_000
const res = (status: number, body: Record<string, unknown>): ApiRes => ({ status, body })
const fail = (error: ConnectError) => res(200, { error })
// Never log tokens: only the error kind/name and HTTP status.
const logGoogle = (e: unknown) => {
  const x = (e ?? {}) as { kind?: string; name?: string; status?: number }
  console.error('google connect failed', x.kind ?? x.name, x.status ?? '')
}
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200)
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)))
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

interface FoundLocation extends GLocation { account: string; canReply: boolean }

/** Every location the grant can see, once each (a location can sit under a business group and a personal account). */
async function listLocations(google: Google, at: string, opts: { strictVom?: boolean } = {}): Promise<{ accounts: number; locations: FoundLocation[] }> {
  const accounts = await google.accounts(at)
  const seen = new Map<string, FoundLocation>()
  for (const account of accounts) {
    for (const l of await google.locations(at, account)) {
      if (seen.has(l.name)) continue
      // finish treats a failed Voice-of-Merchant check as "cannot reply"; refresh must not switch live locations off on a blip
      const canReply = opts.strictVom ? await google.canReply(at, l.name) : await google.canReply(at, l.name).catch(() => false)
      seen.set(l.name, { ...l, account, canReply })
    }
  }
  return { accounts: accounts.length, locations: [...seen.values()] }
}

// A reconnect carries enabled_at and the cursors, so reviews that arrived while disconnected are still delivered
// (reconcile counts from enabled_at). Inserts skip the DB trigger that stamps enabled_at, so set it here when missing.
function toRows(connectionId: string, businessId: string, found: FoundLocation[], sites: SiteLite[],
  prev: Map<string, PrevLocation>, now: Date): LocationUpsert[] {
  return found.map((l) => {
    const m = prev.get(l.name)
    const site_id = m ? m.site_id : suggestSite({ postcode: l.postcode, title: l.title }, sites)
    const enabled = !!m?.enabled && l.canReply && !!site_id
    return {
      connection_id: connectionId, business_id: businessId, gbp_account: l.account, gbp_location: l.name,
      title: l.title, address: l.address, postcode: l.postcode, maps_uri: l.mapsUri, can_reply: l.canReply,
      site_id, enabled, enabled_at: m?.enabled_at ?? (enabled ? now.toISOString() : null),
      last_review_update_time: m?.last_review_update_time ?? null, last_full_pass_at: m?.last_full_pass_at ?? null,
    }
  })
}

async function start(d: ConnectDeps, google: Google, me: Caller): Promise<ApiRes> {
  const state = randomToken(32)
  const code_verifier = randomToken(48)
  const now = d.now()
  await d.saveState({ state, business_id: me.business_id, profile_id: me.profile_id, code_verifier, expires_at: new Date(now.getTime() + STATE_TTL_MS).toISOString() })
  return res(200, { url: google.authUrl(state, await pkceChallenge(code_verifier)) })
}

async function finish(d: ConnectDeps, google: Google, body: Record<string, unknown>): Promise<ApiRes> {
  const now = d.now()
  const st = typeof body.state === 'string' ? await d.takeState(body.state, now) : null
  if (body.error) return fail('denied')
  if (!st) return fail('expired')
  // Up to 10 minutes may have passed since start: re-check the person and the subscription before using the code.
  if (!(await d.stillAllowed(st.profile_id, st.business_id))) return fail('denied')
  if (typeof body.code !== 'string' || !body.code) return fail('denied')

  let tokens
  try { tokens = await google.exchangeCode(body.code, st.code_verifier) } catch (e) { logGoogle(e); return fail('google') }

  // Google's /revoke kills the whole grant. If the business already has a live connection, a retry from the same
  // Google account shares that grant, so we only revoke when there is nothing live to break.
  const live = await d.liveConnection(st.business_id)
  const revokeNew = async (t: string) => { if (!live) await google.revoke(t) }
  if (!tokens.scopes.includes(GOOGLE_SCOPE_MANAGE)) { await revokeNew(tokens.refreshToken ?? tokens.accessToken); return fail('missing_scope') }
  if (!tokens.refreshToken) { await revokeNew(tokens.accessToken); return fail('no_refresh_token') }
  const rt = tokens.refreshToken
  const abandon = async (e: ConnectError) => { await revokeNew(rt); return fail(e) }

  let email: string, found
  try {
    email = await google.email(tokens.accessToken)
    found = await listLocations(google, tokens.accessToken)
  } catch (e) { logGoogle(e); return abandon('google') }
  if (!found.accounts) return abandon('no_accounts')
  if (!found.locations.length) return abandon('no_locations')

  const prevMap = await d.previousMapping(st.business_id)
  let secretId: string | null = null
  let conn: Connection
  try {
    secretId = await d.storeToken(rt, `google_reviews_${st.business_id}_${now.getTime()}`)
    // Never revoke at Google here (see above). Only our copy of the old token goes, and only after the new
    // connection exists, so a failure cannot leave the business without one.
    if (live) await d.markRevoked(live.id, now)
    conn = await d.insertConnection({ business_id: st.business_id, google_email: email, vault_secret_id: secretId, scopes: tokens.scopes, connected_by: st.profile_id, now })
  } catch (e) {
    console.error('google connect persist failed', errText(e))
    if (secretId) await d.deleteToken(secretId).catch(() => {})
    await revokeNew(rt)
    return fail('google')
  }
  if (live?.vault_secret_id) await d.deleteToken(live.vault_secret_id)
  try {
    await d.upsertLocations(toRows(conn.id, st.business_id, found.locations, await d.sites(st.business_id), prevMap, now))
    await d.repointReviews(st.business_id, conn.id)
  } catch (e) {
    // The connection is kept; "Check Google again" (refresh) recovers the locations.
    console.error('google connect locations failed', errText(e))
    return fail('google')
  }
  return res(200, { result: 'connected' })
}

async function disconnect(d: ConnectDeps, google: Google, me: Caller): Promise<ApiRes> {
  const conn = await d.liveConnection(me.business_id)
  if (!conn) return res(200, { ok: true })
  if (conn.vault_secret_id) {
    const token = await d.readToken(conn.vault_secret_id)
    if (token) await google.revoke(token)
    await d.deleteToken(conn.vault_secret_id)
  }
  await d.markRevoked(conn.id, d.now())
  await d.onDisconnected(me.business_id)
  return res(200, { ok: true })
}

async function refresh(d: ConnectDeps, google: Google, me: Caller): Promise<ApiRes> {
  const conn = await d.liveConnection(me.business_id)
  const token = conn?.status === 'active' && conn.vault_secret_id ? await d.readToken(conn.vault_secret_id) : null
  if (!conn || !token) return res(409, { error: 'not_connected' })
  let found
  try { found = await listLocations(google, await google.refresh(token), { strictVom: true }) } catch (e) { logGoogle(e); return res(502, { error: 'google' }) }
  const rows = toRows(conn.id, me.business_id, found.locations, await d.sites(me.business_id), await d.previousMapping(me.business_id), d.now())
  await d.upsertLocations(rows)
  // Normally a no-op; recovers the re-point when finish failed after inserting the connection.
  await d.repointReviews(me.business_id, conn.id)
  return res(200, { ok: true, locations: rows.length })
}

export async function handleConnect(d: ConnectDeps, google: Google, me: Caller | null, body: unknown): Promise<ApiRes> {
  if (!isObj(body)) return res(400, { error: 'body' })
  if (body.action === 'finish') return finish(d, google, body)
  if (!me) return res(401, { error: 'auth' })
  if (body.action === 'start') return start(d, google, me)
  if (body.action === 'disconnect') return disconnect(d, google, me)
  if (body.action === 'refresh') return refresh(d, google, me)
  return res(400, { error: 'action' })
}
