// Google redirects here after consent (spec §5 step 2). We forward code + state to the google-connect edge function,
// which validates the single-use state, and send the browser back to Settings → Google reviews with the result.
import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
const KNOWN = new Set(['denied', 'expired', 'missing_scope', 'no_refresh_token', 'no_accounts', 'no_locations', 'google'])

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const back = (query: string) => NextResponse.redirect(new URL(`/settings?tab=reviews&${query}`, request.nextUrl.origin))
  const state = q.get('state') ?? ''
  if (!state) return back('google_error=expired')
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!base || !anon) return back('google_error=google')
  try {
    const r = await fetch(`${base}/functions/v1/google-connect`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ action: 'finish', state, code: q.get('code') ?? '', error: q.get('error') }),
    })
    const j = (await r.json().catch(() => ({}))) as { result?: string; error?: string }
    if (j.result === 'connected') return back('google=connected')
    return back(`google_error=${j.error && KNOWN.has(j.error) ? j.error : 'google'}`)
  } catch {
    return back('google_error=google')
  }
}
