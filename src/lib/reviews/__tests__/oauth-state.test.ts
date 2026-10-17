// Final review I1: the OAuth state is bound to the browser that started "Connect Google" (login CSRF).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { decideCallback, stateCookie, OAUTH_STATE_COOKIE } from '../oauth-state'

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: async () => ({ data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=St4te_-x&code_challenge=c' }, error: null }) } },
}))

describe('decideCallback', () => {
  it('forwards only when the cookie matches the query state', () => {
    expect(decideCallback('S1', 'S1')).toBe('forward')
    expect(decideCallback('S1', undefined)).toBe('expired')
    expect(decideCallback('S1', '')).toBe('expired')
    expect(decideCallback('S1', 'S2')).toBe('expired')
    expect(decideCallback('', '')).toBe('expired')
  })
  it('the cookie is scoped to /api/google, 10 minutes, Secure, SameSite=Lax', () => {
    expect(stateCookie('abc')).toBe('g_oauth_state=abc; Path=/api/google; Max-Age=600; Secure; SameSite=Lax')
  })
})

describe('startGoogleConnect', () => {
  const doc = { cookie: '' }
  beforeEach(() => { doc.cookie = ''; vi.stubGlobal('document', doc) })
  afterEach(() => { vi.unstubAllGlobals() })
  it('sets the state cookie from the returned URL before handing the URL back', async () => {
    const { startGoogleConnect } = await import('../api')
    const url = await startGoogleConnect()
    expect(url).toContain('state=St4te_-x')
    expect(doc.cookie).toBe('g_oauth_state=St4te_-x; Path=/api/google; Max-Age=600; Secure; SameSite=Lax')
  })
})

describe('GET /api/google/callback', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ result: 'connected' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  const call = async (cookie?: string) => {
    const { GET } = await import('@/app/api/google/callback/route')
    const req = new NextRequest('https://app.blueroll.app/api/google/callback?state=S1&code=C', cookie ? { headers: { cookie } } : undefined)
    return GET(req)
  }
  const cleared = (res: Response) => {
    const sc = res.headers.get('set-cookie') ?? ''
    expect(sc).toContain(`${OAUTH_STATE_COOKIE}=`)
    expect(sc).toMatch(/Max-Age=0/i)
    expect(sc).toMatch(/Path=\/api\/google/i)
  }
  it('matching cookie → forwards to the edge function, back to Settings connected, cookie cleared', async () => {
    const res = await call(`${OAUTH_STATE_COOKIE}=S1`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ action: 'finish', state: 'S1', code: 'C' })
    expect(res.headers.get('location')).toBe('https://app.blueroll.app/settings?tab=reviews&google=connected')
    cleared(res)
  })
  it('missing cookie → expired, edge function not called, cookie cleared', async () => {
    const res = await call()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe('https://app.blueroll.app/settings?tab=reviews&google_error=expired')
    cleared(res)
  })
  it("a different browser's state → expired, edge function not called", async () => {
    const res = await call(`${OAUTH_STATE_COOKIE}=OTHER`)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toContain('google_error=expired')
    cleared(res)
  })
})
