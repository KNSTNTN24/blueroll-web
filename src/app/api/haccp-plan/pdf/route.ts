import { NextResponse } from 'next/server'
import { TOKEN_RE, renderPlanPdf, contentDisposition } from '@/lib/haccp-plan/pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('t') ?? ''
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // Cheap pre-check so bad links never start Chromium.
  const check = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/haccp-plan?t=${token}`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, cache: 'no-store',
  })
  if (check.status === 404) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!check.ok) return NextResponse.json({ error: 'upstream' }, { status: 502 })
  const origin = process.env.PLAN_RENDER_ORIGIN ?? url.origin
  const r = await renderPlanPdf({ origin, token, bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET, timeoutMs: 25_000 })
  if (r.status === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (r.status === 'timeout') return NextResponse.json({ error: 'timeout' }, { status: 504 })
  if (r.status === 'error') return NextResponse.json({ error: 'render_failed' }, { status: 500 })
  return new NextResponse(Buffer.from(r.pdf), { headers: {
    'Content-Type': 'application/pdf', 'Content-Disposition': contentDisposition(r.fileName),
    'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex',
  } })
}
