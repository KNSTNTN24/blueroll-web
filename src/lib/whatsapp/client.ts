import { supabase } from '@/lib/supabase'

export type Channel = 'whatsapp' | 'telegram'

export const WA_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? ''   // E.164 without '+'

/** Whether a channel can be offered in the UI: WhatsApp needs its number configured (NEXT_PUBLIC_WHATSAPP_NUMBER); Telegram always. */
export const channelAvailable = (c: Channel, waNumber: string = WA_NUMBER) => c === 'telegram' || !!waNumber

export function maskNumber(e164: string): string {
  const d = e164.replace(/\D/g, '')
  return d.length < 6 ? '+••' : `+${d.slice(0, 2)} ${d.slice(2, 3)}••• ••${d.slice(-2)}`
}

export async function listIdentities(businessId: string, channel: Channel = 'whatsapp') {
  const { data, error } = await supabase.from('channel_identities').select('id, profile_id, external_id, consent_at, consent_source')
    .eq('business_id', businessId).eq('channel', channel).is('revoked_at', null)
  if (error) throw error
  return (data ?? []) as { id: string; profile_id: string; external_id: string; consent_at: string; consent_source: string }[]
}

/** POST to an edge function as the signed-in user; a non-2xx reply throws Error(<its error code>). */
export async function callFn(name: string, body: unknown) {
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

export async function syncTemplateFlows(templateId: string): Promise<void> {
  try { await callFn('whatsapp-sync-flows', { template_id: templateId }) } catch { /* best effort; nightly sync catches up */ }
}

/** Publish Flows for every active checklist of the caller's business (right after WhatsApp is turned on). */
export async function syncAllFlows(): Promise<void> {
  try { await callFn('whatsapp-sync-flows', { all: true }) } catch { /* best effort; nightly sync catches up */ }
}
