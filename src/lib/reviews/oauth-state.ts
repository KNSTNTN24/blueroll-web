// "Connect Google" login-CSRF guard: the browser that started the flow keeps the OAuth state in a short-lived cookie,
// and /api/google/callback only forwards a code whose state matches it. No imports: shared by the client and the route.
export const OAUTH_STATE_COOKIE = 'g_oauth_state'
export const OAUTH_STATE_COOKIE_PATH = '/api/google'

export const stateCookie = (state: string) =>
  `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Path=${OAUTH_STATE_COOKIE_PATH}; Max-Age=600; Secure; SameSite=Lax`

export const stateFromAuthUrl = (url: string) => new URL(url).searchParams.get('state') ?? ''

/** forward = hand code + state to the edge function; expired = this browser did not start this flow (or it timed out). */
export function decideCallback(state: string, cookie: string | undefined): 'forward' | 'expired' {
  return state && cookie && cookie === state ? 'forward' : 'expired'
}
