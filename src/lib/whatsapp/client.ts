import { supabase } from '@/lib/supabase'

export type Channel = 'whatsapp' | 'telegram'

export const WA_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? ''   // E.164 without '+'

export const waLink = (number: string, code: string) => `https://wa.me/${number}?text=${encodeURIComponent(`LINK ${code}`)}`

export function maskNumber(e164: string): string {
  const d = e164.replace(/\D/g, '')
  return d.length < 6 ? '+••' : `+${d.slice(0, 2)} ${d.slice(2, 3)}••• ••${d.slice(-2)}`
}

export const TELEGRAM_BOT = 'BluerollChecksBot'

// Per-channel config. buildLink returns null when the channel's destination is
// not configured (dialog then shows the code only). Telegram is never null.
export const CHANNELS: Record<Channel, { label: string; buildLink: (code: string) => string | null; codeText: (code: string) => string; displayId: (externalId: string) => string; notConfiguredNote: string; scanInstruction: string; codeInstruction: string }> = {
  whatsapp: {
    label: 'WhatsApp',
    buildLink: (code) => (WA_NUMBER ? waLink(WA_NUMBER, code) : null),
    codeText: (code) => `LINK ${code}`,
    displayId: (id) => maskNumber(id),
    notConfiguredNote: 'WhatsApp number not configured yet',
    scanInstruction: 'Ask them to scan this with their phone camera and press Send in WhatsApp.',
    codeInstruction: 'Send this code to Blueroll on WhatsApp from their phone.',
  },
  telegram: {
    label: 'Telegram',
    buildLink: (code) => `https://t.me/${TELEGRAM_BOT}?start=${code}`,
    codeText: (code) => `/start ${code}`,
    displayId: () => 'connected',
    notConfiguredNote: 'Telegram bot not configured yet',
    scanInstruction: 'Scan with the phone camera, then tap Start in Telegram.',
    codeInstruction: 'Send this code to Blueroll on Telegram from their phone.',
  },
}

/** Server-generated 6-digit code (RPC checks the caller manages the member). */
export async function issueLinkCode(a: { profileId: string; siteId: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc('issue_link_code', { p_profile: a.profileId, p_site: a.siteId })
  if (error) throw error
  return data as string
}

export async function listIdentities(businessId: string, channel: Channel = 'whatsapp') {
  const { data, error } = await supabase.from('channel_identities').select('id, profile_id, external_id, consent_at')
    .eq('business_id', businessId).eq('channel', channel).is('revoked_at', null)
  if (error) throw error
  return (data ?? []) as { id: string; profile_id: string; external_id: string; consent_at: string }[]
}

export async function revokeIdentity(id: string) {
  const { error } = await supabase.rpc('revoke_channel_identity', { p_id: id })
  if (error) throw error
}

async function callFn(name: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
  return j
}

export async function createWhatsAppMember(a: { full_name: string; role_id: string; site_id: string }): Promise<string> {
  return (await callFn('team-create-channel-member', a)).profile_id
}

export async function syncTemplateFlows(templateId: string): Promise<void> {
  try { await callFn('whatsapp-sync-flows', { template_id: templateId }) } catch { /* best effort; nightly sync catches up */ }
}

/** Publish Flows for every active checklist of the caller's business (right after WhatsApp is turned on). */
export async function syncAllFlows(): Promise<void> {
  try { await callFn('whatsapp-sync-flows', { all: true }) } catch { /* best effort; nightly sync catches up */ }
}
