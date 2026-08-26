// HACCP template nurture drip: sends the 3-letter sequence via Resend and
// serves its own open pixel, click redirects and unsubscribe. Fired hourly by
// pg_cron (POST ?a=send with x-drip-secret); pixels/clicks are public GETs.
//
// Letters (see templates/): 1 immediately after download, 2 on day 4,
// 3 (breakup) on day 9. Skips unsubscribed leads, obvious non-prospects and
// anyone who already has a Blueroll account.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const DRIP_SECRET = Deno.env.get('DRIP_SECRET') ?? ''

const FN_URL = `${SUPABASE_URL}/functions/v1/drip`
const FROM = 'Maria at Blueroll <hello@blueroll.app>'
const REPLY_TO = 'hello@blueroll.app'
const EXCLUDE = new Set(['hello@planb.london', 'botfredthebot@gmail.com'])
const SUBJECTS: Record<number, string> = {
  1: 'Your HACCP pack. Print page 3.',
  2: 'Who signed fridge two today?',
  3: 'Closing your folder',
}
const MAX_PER_RUN = 40
const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))

import { TEMPLATES as templates } from './templates.ts'

async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`db ${path}: ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

function render(letter: number, token: string): string {
  return templates[letter]
    .replaceAll('{{T}}', token)
    .replaceAll('{{UNSUB}}', `${FN_URL}?a=u&t=${token}`)
}

async function sendLetter(email: string, letter: number): Promise<{ ok: boolean; error?: string }> {
  const [log] = await db('template_email_log', {
    method: 'POST',
    body: JSON.stringify({ email, letter }),
  })
  const html = render(letter, log.token)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [email], reply_to: REPLY_TO,
      subject: SUBJECTS[letter], html,
      headers: { 'List-Unsubscribe': `<${FN_URL}?a=u&t=${log.token}>` },
    }),
  })
  const data = await res.json()
  await db(`template_email_log?id=eq.${log.id}`, {
    method: 'PATCH',
    body: JSON.stringify(res.ok ? { resend_id: data.id } : { error: data?.message || `resend ${res.status}` }),
  })
  return res.ok ? { ok: true } : { ok: false, error: data?.message }
}

async function runSend(testTo?: string, testLetter?: number) {
  if (testTo) {
    // Re-sending a test must not trip the one-letter-per-email unique index.
    await db(`template_email_log?email=eq.${encodeURIComponent(testTo)}&letter=eq.${testLetter ?? 1}`, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' },
    }).catch(() => {})
    const r = await sendLetter(testTo, testLetter ?? 1)
    return { test: testTo, letter: testLetter ?? 1, ...r }
  }

  const leads: { email: string; unsubscribed_at: string | null; source: string }[] =
    await db(`template_leads?select=email,unsubscribed_at,source&source=like.haccp-template*&unsubscribed_at=is.null`)
  const logs: { email: string; letter: number; sent_at: string; error: string | null }[] =
    await db('template_email_log?select=email,letter,sent_at,error&error=is.null')

  const emails = [...new Set(leads.map((l) => l.email.toLowerCase()))]
    .filter((e) => !EXCLUDE.has(e) && e.includes('@') && !e.endsWith('@test.com') && !e.endsWith('@blueroll.app') && !e.endsWith('@blueroll.test'))

  // Already-converted downloaders don't need selling to.
  const registered = new Set<string>()
  for (let i = 0; i < emails.length; i += 50) {
    const chunk = emails.slice(i, i + 50)
    const rows: { email: string }[] = await db(`profiles?select=email&email=in.(${chunk.map((e) => `"${e}"`).join(',')})`)
    rows.forEach((r) => registered.add(r.email.toLowerCase()))
  }

  const byEmail = new Map<string, Map<number, string>>()
  for (const g of logs) {
    const m = byEmail.get(g.email.toLowerCase()) ?? new Map()
    m.set(g.letter, g.sent_at)
    byEmail.set(g.email.toLowerCase(), m)
  }

  const now = Date.now(), day = 864e5
  const hour = new Date().getUTCHours()
  const sent: Record<string, number[]> = {}
  let count = 0
  for (const email of emails) {
    if (count >= MAX_PER_RUN) break
    if (registered.has(email)) continue
    const m = byEmail.get(email) ?? new Map<number, string>()
    let letter: number | null = null
    if (!m.has(1)) letter = 1
    else if (!m.has(2) && now - Date.parse(m.get(1)!) > 4 * day) letter = 2
    else if (m.has(2) && !m.has(3) && now - Date.parse(m.get(1)!) > 9 * day) letter = 3
    if (letter === null) continue
    // Follow-ups only at humane hours; letter 1 goes out whenever the download happens.
    if (letter > 1 && (hour < 8 || hour > 17)) continue
    const r = await sendLetter(email, letter)
    if (r.ok) { (sent[letter] ??= [] as unknown as number[]); (sent[letter] as unknown as string[]).push(email) }
    count++
  }
  return { sent }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const a = url.searchParams.get('a')
  const t = url.searchParams.get('t') ?? ''
  const tok = /^[a-f0-9]{24}$/.test(t) ? t : ''

  if (a === 'o' && tok) {
    await db(`template_email_log?token=eq.${tok}&opened_at=is.null`, {
      method: 'PATCH', body: JSON.stringify({ opened_at: new Date().toISOString() }),
    }).catch(() => {})
    return new Response(GIF, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' } })
  }

  if (a === 'c' && tok) {
    const u = url.searchParams.get('u') ?? 'https://blueroll.app/'
    const safe = /^https:\/\/(app\.)?blueroll\.app\//.test(u) ? u : 'https://blueroll.app/'
    await db(`template_email_log?token=eq.${tok}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ clicked_at: new Date().toISOString(), click_target: safe.split('?')[0] }),
    }).catch(() => {})
    // Opening a link implies the mail was opened even if images were blocked.
    await db(`template_email_log?token=eq.${tok}&opened_at=is.null`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ opened_at: new Date().toISOString() }),
    }).catch(() => {})
    return Response.redirect(safe, 302)
  }

  if (a === 'u' && tok) {
    const rows = await db(`template_email_log?select=email&token=eq.${tok}`)
    if (rows?.[0]) {
      await db(`template_leads?email=eq.${encodeURIComponent(rows[0].email)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ unsubscribed_at: new Date().toISOString() }),
      })
    }
    return new Response(
      '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:48px;text-align:center;color:#16181d"><h2>You are unsubscribed</h2><p style="color:#5c626b">No more emails from this sequence. The template is still yours to keep.</p></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }

  if (a === 'send' && req.method === 'POST') {
    if (!DRIP_SECRET || req.headers.get('x-drip-secret') !== DRIP_SECRET) {
      return new Response('forbidden', { status: 403 })
    }
    const body = await req.json().catch(() => ({}))
    const result = await runSend(body.test_to, body.letter)
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
  }

  return new Response('not found', { status: 404 })
})
