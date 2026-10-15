// supabase/functions/_shared/reviews/connect.ts
// Spec §3, §5: "Connect Google" from Settings. start → Google consent → finish (from the Next callback route, authorised
// by the single-use state alone) → token in Vault, locations listed and matched to sites. Disconnect revokes at Google.
// Pure over ConnectDeps + Google; google-connect/index.ts does auth and wiring.
import { GOOGLE_SCOPE_MANAGE, type Google, type GLocation } from './google.ts'
import { suggestSite } from './match.ts'
import type { Connection, Location, SiteLite } from './types.ts'

export interface OAuthState { state: string; business_id: string; profile_id: string; code_verifier: string; expires_at: string }
export type LocationUpsert = Omit<Location, 'id' | 'enabled_at' | 'last_review_update_time' | 'last_full_pass_at'>
export interface ConnectDeps {
  now(): Date
  saveState(s: OAuthState): Promise<void>
  takeState(state: string, now: Date): Promise<OAuthState | null>
  liveConnection(b: string): Promise<Connection | null>
  storeToken(token: string, name: string): Promise<string>
  readToken(secretId: string): Promise<string | null>
  deleteToken(secretId: string): Promise<void>
  insertConnection(c: { business_id: string; google_email: string; vault_secret_id: string; scopes: string[]; connected_by: string; now: Date }): Promise<Connection>
  markRevoked(id: string, now: Date): Promise<void>
  previousMapping(b: string): Promise<Map<string, { site_id: string | null; enabled: boolean }>>
  upsertLocations(rows: LocationUpsert[]): Promise<void>
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
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)))
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

interface FoundLocation extends GLocation { account: string; canReply: boolean }

/** Every location the grant can see, once each (a location can sit under a business group and a personal account). */
async function listLocations(google: Google, at: string): Promise<{ accounts: number; locations: FoundLocation[] }> {
  const accounts = await google.accounts(at)
  const seen = new Map<string, FoundLocation>()
  for (const account of accounts) {
    for (const l of await google.locations(at, account)) {
      if (seen.has(l.name)) continue
      const canReply = await google.canReply(at, l.name).catch(() => false)
      seen.set(l.name, { ...l, account, canReply })
    }
  }
  return { accounts: accounts.length, locations: [...seen.values()] }
}

function toRows(connectionId: string, businessId: string, found: FoundLocation[], sites: SiteLite[],
  prev: Map<string, { site_id: string | null; enabled: boolean }>): LocationUpsert[] {
  return found.map((l) => {
    const m = prev.get(l.name)
    const site_id = m ? m.site_id : suggestSite({ postcode: l.postcode, title: l.title }, sites)
    return {
      connection_id: connectionId, business_id: businessId, gbp_account: l.account, gbp_location: l.name,
      title: l.title, address: l.address, postcode: l.postcode, maps_uri: l.mapsUri, can_reply: l.canReply,
      site_id, enabled: !!m?.enabled && l.canReply && !!site_id,
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
  if (typeof body.code !== 'string' || !body.code) return fail('denied')

  let tokens
  try { tokens = await google.exchangeCode(body.code, st.code_verifier) } catch { return fail('google') }
  if (!tokens.scopes.includes(GOOGLE_SCOPE_MANAGE)) { await google.revoke(tokens.refreshToken ?? tokens.accessToken).catch(() => {}); return fail('missing_scope') }
  if (!tokens.refreshToken) return fail('no_refresh_token')
  const rt = tokens.refreshToken
  const abandon = async (e: ConnectError) => { await google.revoke(rt).catch(() => {}); return fail(e) }

  let email: string, found
  try {
    email = await google.email(tokens.accessToken)
    found = await listLocations(google, tokens.accessToken)
  } catch { return abandon('google') }
  if (!found.accounts) return abandon('no_accounts')
  if (!found.locations.length) return abandon('no_locations')

  const prevMap = await d.previousMapping(st.business_id)
  const prev = await d.liveConnection(st.business_id)
  if (prev) {
    // Never revoke at Google here: /revoke kills the whole grant, i.e. the token we just received too
    // when the same Google account reconnects. Only our copy goes.
    await d.markRevoked(prev.id, now)
    if (prev.vault_secret_id) await d.deleteToken(prev.vault_secret_id)
  }
  const secretId = await d.storeToken(rt, `google_reviews_${st.business_id}_${now.getTime()}`)
  const conn = await d.insertConnection({ business_id: st.business_id, google_email: email, vault_secret_id: secretId, scopes: tokens.scopes, connected_by: st.profile_id, now })
  await d.upsertLocations(toRows(conn.id, st.business_id, found.locations, await d.sites(st.business_id), prevMap))
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
  try { found = await listLocations(google, await google.refresh(token)) } catch { return res(502, { error: 'google' }) }
  const rows = toRows(conn.id, me.business_id, found.locations, await d.sites(me.business_id), await d.previousMapping(me.business_id))
  await d.upsertLocations(rows)
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
