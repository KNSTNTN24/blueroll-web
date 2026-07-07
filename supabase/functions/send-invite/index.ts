// Sends a BlueRoll team invite email via Resend.
// Body: { to, code, groupName?, siteName?, inviterName?, appUrl? }
// Requires an Authorization bearer (any signed-in user); the invite code itself
// is minted by create_invite() which already enforces owner/manager via RLS.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
// Prefer the branded sender; auto-fall back to Resend's shared sender until the
// blueroll.app domain finishes verifying (then it upgrades itself, no redeploy).
const FROM_PRIMARY = Deno.env.get('RESEND_FROM') ?? 'BlueRoll <noreply@blueroll.app>'
const FROM_FALLBACK = 'BlueRoll <onboarding@resend.dev>'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!req.headers.get('Authorization')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
    const { to, code, groupName, siteName, inviterName, appUrl } = await req.json()
    if (!to || !code) {
      return new Response(JSON.stringify({ error: 'Missing to or code' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const base = (appUrl ?? 'https://app.blueroll.app').replace(/\/$/, '')
    const joinUrl = `${base}/onboarding?invite=${encodeURIComponent(code)}`
    const group = groupName || 'a BlueRoll team'
    const who = inviterName ? `${inviterName} invited you` : 'You have been invited'
    const siteLine = siteName ? `<p style="margin:0 0 18px;color:#5c626b;font-size:14px">Site: <strong>${siteName}</strong></p>` : ''

    const html = `<!doctype html><html><body style="margin:0;background:#f6f7f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:460px;margin:0 auto;padding:32px 20px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:22px">
      <div style="width:30px;height:30px;border-radius:9px;background:#1f9d63;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px">b</div>
      <span style="font-weight:700;font-size:17px;color:#16181d">BlueRoll</span>
    </div>
    <div style="background:#fff;border:1px solid #e9eaed;border-radius:16px;padding:28px 26px">
      <h1 style="margin:0 0 6px;font-size:20px;color:#16181d">${who} to join ${group}</h1>
      <p style="margin:0 0 18px;color:#5c626b;font-size:14px;line-height:1.5">Join on BlueRoll to run food-safety checks, log incidents and stay inspection-ready.</p>
      ${siteLine}
      <p style="margin:0 0 8px;color:#9aa0a8;font-size:11px;letter-spacing:.05em;text-transform:uppercase;font-weight:600">Your invite code</p>
      <div style="font-family:monospace;font-size:26px;font-weight:700;letter-spacing:.12em;color:#1c1f24;background:#f5f6f7;border-radius:10px;padding:14px;text-align:center;margin-bottom:20px">${code}</div>
      <a href="${joinUrl}" style="display:block;background:#1f9d63;color:#fff;text-decoration:none;font-weight:600;font-size:15px;text-align:center;padding:14px;border-radius:11px">Join the team</a>
      <p style="margin:16px 0 0;color:#9aa0a8;font-size:12px;line-height:1.5">Or go to app.blueroll.app, choose “Joining a team” and enter the code above.</p>
    </div>
  </div>
</body></html>`

    const subject = `You're invited to join ${group} on BlueRoll`
    const send = (from: string) => fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    })

    let res = await send(FROM_PRIMARY)
    let data = await res.json()
    // Domain not verified yet → fall back to Resend's shared sender.
    if (!res.ok && res.status === 403 && FROM_PRIMARY !== FROM_FALLBACK) {
      res = await send(FROM_FALLBACK)
      data = await res.json()
    }
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.message || 'Resend error', detail: data }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: true, id: data?.id }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
