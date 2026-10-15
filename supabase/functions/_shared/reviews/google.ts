// supabase/functions/_shared/reviews/google.ts
// Google OAuth + Business Profile APIs (spec §2, §5, §6, §10). Pure over fetch; loaded by Deno and Vitest.
// Never puts a token in an error message or a log line.
export const GOOGLE_SCOPE_MANAGE = 'https://www.googleapis.com/auth/business.manage'
export const GOOGLE_SCOPES = [GOOGLE_SCOPE_MANAGE, 'openid', 'email']
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const REVOKE = 'https://oauth2.googleapis.com/revoke'
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo'
const ACCOUNTS = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const VERIFY = 'https://mybusinessverifications.googleapis.com/v1'
const V4 = 'https://mybusiness.googleapis.com/v4'

// deno-lint-ignore no-explicit-any
type Any = any

export type GoogleErrorKind = 'invalid_grant' | 'unauthorized' | 'not_found' | 'rate_limited' | 'bad_request' | 'server'
export class GoogleError extends Error {
  constructor(public kind: GoogleErrorKind, public status: number, message: string) { super(message) }
}
/** The stored grant no longer works: password change, access removed, token revoked (spec §5). */
export const isAuthError = (e: unknown) => e instanceof GoogleError && (e.kind === 'invalid_grant' || e.kind === 'unauthorized')

function kindOf(status: number, body: Any): GoogleErrorKind {
  if (body?.error === 'invalid_grant') return 'invalid_grant'
  if (status === 401) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 400 && status < 500) return 'bad_request'
  return 'server'
}

export interface GoogleCfg { clientId: string; clientSecret: string; redirectUri: string; fetchFn?: typeof fetch }
export interface TokenSet { accessToken: string; refreshToken: string | null; scopes: string[] }
export interface GLocation { name: string; title: string; address: string; postcode: string; mapsUri: string | null }
export interface GReview {
  reviewId: string; name: string; stars: number; comment: string; reviewer: string
  createTime: string; updateTime: string; reply: string | null; replyTime: string | null
}
export interface Google {
  authUrl(state: string, codeChallenge: string): string
  exchangeCode(code: string, codeVerifier: string): Promise<TokenSet>
  /** Fresh access token. Throws GoogleError('invalid_grant') when the grant is gone. */
  refresh(refreshToken: string): Promise<string>
  /** Revokes the whole grant (all tokens of this user for our client). Never throws. */
  revoke(token: string): Promise<void>
  email(accessToken: string): Promise<string>
  accounts(accessToken: string): Promise<string[]>
  locations(accessToken: string, account: string): Promise<GLocation[]>
  canReply(accessToken: string, location: string): Promise<boolean>
  reviews(accessToken: string, account: string, location: string, pageToken?: string): Promise<{ reviews: GReview[]; next: string | null }>
  putReply(accessToken: string, account: string, location: string, reviewId: string, comment: string): Promise<void>
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }

export function parseReview(r: Any): GReview | null {
  const stars = STARS[String(r?.starRating ?? '')]
  if (!stars || typeof r?.reviewId !== 'string' || typeof r?.updateTime !== 'string') return null
  return {
    reviewId: r.reviewId, name: typeof r.name === 'string' ? r.name : '', stars,
    comment: typeof r.comment === 'string' ? r.comment : '',
    reviewer: r.reviewer?.isAnonymous ? '' : String(r.reviewer?.displayName ?? ''),
    createTime: typeof r.createTime === 'string' ? r.createTime : r.updateTime, updateTime: r.updateTime,
    reply: typeof r.reviewReply?.comment === 'string' ? r.reviewReply.comment : null,
    replyTime: typeof r.reviewReply?.updateTime === 'string' ? r.reviewReply.updateTime : null,
  }
}

export function parseLocation(l: Any): GLocation | null {
  if (typeof l?.name !== 'string') return null
  const a = l.storefrontAddress ?? {}
  const parts = [...(Array.isArray(a.addressLines) ? a.addressLines : []), a.locality, a.postalCode]
    .filter((x: unknown): x is string => typeof x === 'string' && x.trim() !== '')
  return {
    name: l.name, title: typeof l.title === 'string' ? l.title : '', address: parts.join(', '),
    postcode: typeof a.postalCode === 'string' ? a.postalCode : '',
    mapsUri: typeof l.metadata?.mapsUri === 'string' ? l.metadata.mapsUri : null,
  }
}

export function makeGoogle(cfg: GoogleCfg): Google {
  const f = cfg.fetchFn ?? fetch
  const call = async (url: string, init: RequestInit = {}): Promise<Any> => {
    let r: Response
    try { r = await f(url, init) } catch { throw new GoogleError('server', 0, 'network') }
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = body?.error_description ?? body?.error?.message ?? body?.error ?? `HTTP ${r.status}`
      throw new GoogleError(kindOf(r.status, body), r.status, String(msg).slice(0, 200))
    }
    return body
  }
  const bearer = (at: string, extra: Record<string, string> = {}): RequestInit => ({ headers: { Authorization: `Bearer ${at}`, ...extra } })
  const form = (p: Record<string, string>): RequestInit => ({
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(p).toString(),
  })
  const pageQs = (page: string) => (page ? `&pageToken=${encodeURIComponent(page)}` : '')

  return {
    authUrl: (state, challenge) => `${AUTH}?${new URLSearchParams({
      client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
      code_challenge: challenge, code_challenge_method: 'S256',
    })}`,
    exchangeCode: async (code, verifier) => {
      const j = await call(TOKEN, form({
        code, code_verifier: verifier, client_id: cfg.clientId, client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri, grant_type: 'authorization_code',
      }))
      return {
        accessToken: String(j.access_token ?? ''),
        refreshToken: typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : null,
        scopes: String(j.scope ?? '').split(' ').filter(Boolean),
      }
    },
    refresh: async (rt) => String((await call(TOKEN, form({
      refresh_token: rt, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token',
    }))).access_token ?? ''),
    revoke: async (token) => { try { await call(REVOKE, form({ token })) } catch { /* already revoked or expired */ } },
    email: async (at) => String((await call(USERINFO, bearer(at))).email ?? ''),
    accounts: async (at) => {
      const out: string[] = []
      let page = ''
      do {
        const j = await call(`${ACCOUNTS}?pageSize=20${pageQs(page)}`, bearer(at))
        for (const a of j.accounts ?? []) if (typeof a?.name === 'string') out.push(a.name)
        page = typeof j.nextPageToken === 'string' ? j.nextPageToken : ''
      } while (page && out.length < 200)
      return out
    },
    locations: async (at, account) => {
      const out: GLocation[] = []
      let page = ''
      do {
        const j = await call(`${INFO}/${account}/locations?readMask=name,title,storefrontAddress,metadata&pageSize=100${pageQs(page)}`, bearer(at))
        for (const l of j.locations ?? []) { const p = parseLocation(l); if (p) out.push(p) }
        page = typeof j.nextPageToken === 'string' ? j.nextPageToken : ''
      } while (page && out.length < 1000)
      return out
    },
    canReply: async (at, location) => (await call(`${VERIFY}/${location}/VoiceOfMerchantState`, bearer(at))).hasVoiceOfMerchant === true,
    reviews: async (at, account, location, pageToken) => {
      const j = await call(`${V4}/${account}/${location}/reviews?pageSize=50&orderBy=${encodeURIComponent('updateTime desc')}${pageQs(pageToken ?? '')}`, bearer(at))
      return {
        reviews: ((j.reviews ?? []) as Any[]).map(parseReview).filter((r): r is GReview => r !== null),
        next: typeof j.nextPageToken === 'string' && j.nextPageToken ? j.nextPageToken : null,
      }
    },
    putReply: async (at, account, location, reviewId, comment) => {
      await call(`${V4}/${account}/${location}/reviews/${encodeURIComponent(reviewId)}/reply`, {
        method: 'PUT', ...bearer(at, { 'Content-Type': 'application/json' }), body: JSON.stringify({ comment }),
      })
    },
  }
}
