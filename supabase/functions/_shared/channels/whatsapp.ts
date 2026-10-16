// WhatsApp Cloud API: signature check, inbound parsing, outbound message builders. No runtime imports.
import type { DeliveryStatus, InboundEvent, OutboundMessage, SendFn } from './types.ts'

// Latest Graph API version per developers.facebook.com/docs/graph-api/changelog (released 2026-07-29).
export const GRAPH_VERSION = 'v26.0'

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !header.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)))
  const got = header.slice(7)
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

// deno-lint-ignore no-explicit-any
type Any = any

const arr = (v: unknown): Any[] => (Array.isArray(v) ? v : [])
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== ''

/**
 * Phone number → E.164 digits without '+' (10–15 digits), or null. '+' / '00' prefixes are international; a single
 * leading 0 is a national number in `defaultCountryCode` (Blueroll businesses are UK: '44'). "(0)" is dropped.
 */
export function normalisePhone(raw: string, defaultCountryCode = '44'): string | null {
  const s = String(raw ?? '').replace(/\(0\)/g, '').trim()
  if (!s || /[a-z]/i.test(s)) return null
  let d = s.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = defaultCountryCode + d.slice(1)
  return /^\d{10,15}$/.test(d) ? d : null
}

// Never throws: anything malformed is skipped.
export function parseInbound(body: unknown): InboundEvent[] {
  const out: InboundEvent[] = []
  for (const e of arr((body as Any)?.entry)) for (const c of arr(e?.changes)) for (const m of arr(c?.value?.messages)) {
    const from = m?.from; const id = String(m?.id ?? '')
    if (typeof from !== 'string' || !/^\d+$/.test(from)) continue
    if (m.type === 'text' && typeof m.text?.body === 'string') out.push({ kind: 'text', from, text: m.text.body, id })
    else if (m.type === 'button') { if (nonEmpty(m.button?.payload)) out.push({ kind: 'button', from, payload: m.button.payload, id }) }
    else if (m.type === 'interactive' && m.interactive?.type === 'button_reply') {
      const payload = m.interactive.button_reply?.id
      if (nonEmpty(payload)) out.push({ kind: 'button', from, payload, id })
    } else if (m.type === 'interactive' && m.interactive?.type === 'list_reply') {
      const payload = m.interactive.list_reply?.id
      if (nonEmpty(payload)) out.push({ kind: 'button', from, payload, id })
    } else if (m.type === 'interactive' && m.interactive?.type === 'nfm_reply') {
      try {
        const parsed = JSON.parse(m.interactive.nfm_reply?.response_json ?? '')
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
        const { flow_token, ...response } = parsed
        if (typeof flow_token === 'string') out.push({ kind: 'flow', from, token: flow_token, response, id })
      } catch { /* malformed flow reply: ignore */ }
    }
    else if (m.type === 'contacts') {
      // Shared contact card: the first contact with a usable number (wa_id preferred — already E.164 digits).
      for (const c of arr(m.contacts)) {
        const phone = arr(c?.phones).map((p: Any) => normalisePhone(String(p?.wa_id || p?.phone || ''))).find((x): x is string => !!x)
        if (!phone) continue
        const n = c?.name ?? {}
        const name = String(n.formatted_name || [n.first_name, n.last_name].filter(Boolean).join(' ') || '').replace(/\s+/g, ' ').trim()
        out.push({ kind: 'contact', from, name, phone, id })
        break
      }
    }
  }
  return out
}

// Never throws: anything malformed is skipped.
export function parseStatuses(body: unknown): DeliveryStatus[] {
  const out: DeliveryStatus[] = []
  for (const e of arr((body as Any)?.entry)) for (const c of arr(e?.changes)) for (const s of arr(c?.value?.statuses)) {
    const recipient = s?.recipient_id
    if (typeof recipient !== 'string' || !/^\d+$/.test(recipient)) continue
    const err = arr(s.errors)[0]
    const code = err?.code
    const title = [err?.title, err?.error_data?.details].filter((x) => typeof x === 'string' && x).join(': ').slice(0, 300)
    out.push({ id: String(s.id ?? ''), recipient, status: String(s.status ?? ''), errorCode: typeof code === 'number' ? code : null, errorTitle: title || null })
  }
  return out
}

export const textMessage = (to: string, body: string): OutboundMessage =>
  ({ messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } })

export const PARAM_MAX = 200

/**
 * Meta rejects template parameters containing newlines, tabs or runs of spaces, and empty parameters.
 * Collapse all whitespace to single spaces, trim, use '—' when empty, cap at `max` chars.
 */
export function sanitizeParam(s: string | null | undefined, max: number = PARAM_MAX): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return '—'
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

export const buttonsMessage = (to: string, body: string, buttons: { id: string; title: string }[]): OutboundMessage => ({
  messaging_product: 'whatsapp', to, type: 'interactive',
  interactive: { type: 'button', body: { text: body }, action: {
    buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: sanitizeParam(b.title, 20) } })),
  } },
})

/** Interactive list: one button opens a menu of rows. Limits are applied by the caller (see due-menu.ts). */
export const listMessage = (to: string, m: { header: string; body: string; footer: string; button: string; rows: { id: string; title: string; description: string }[]; section?: string }): OutboundMessage => ({
  messaging_product: 'whatsapp', to, type: 'interactive',
  interactive: {
    type: 'list', header: { type: 'text', text: m.header }, body: { text: m.body }, footer: { text: m.footer },
    action: { button: m.button, sections: [{ title: m.section ?? 'Open checks', rows: m.rows }] },
  },
})

export const templateMessage = (to: string, name: string, bodyParams: string[], quickReplies: string[]): OutboundMessage => ({
  messaging_product: 'whatsapp', to, type: 'template',
  template: { name, language: { code: 'en_GB' }, components: [
    { type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text: sanitizeParam(text) })) },
    ...quickReplies.map((payload, i) => ({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload }] })),
  ] },
})

/**
 * WA_FLOWS_DRAFT=1: flows are created but never published (Meta blocks publishing until the number has an approved
 * display name and message quality), and sent with mode "draft", which Meta allows for testing.
 * Read at call time via globalThis so this module still loads under Node (vitest).
 */
// deno-lint-ignore no-explicit-any
export const flowsDraftMode = (): boolean => (globalThis as any).Deno?.env?.get?.('WA_FLOWS_DRAFT') === '1'

export const flowMessage = (to: string, o: { flowId: string; token: string; cta: string; body: string; screen: string; data?: Record<string, unknown> }): OutboundMessage => ({
  messaging_product: 'whatsapp', to, type: 'interactive',
  interactive: { type: 'flow', body: { text: o.body }, action: { name: 'flow', parameters: {
    ...(flowsDraftMode() ? { mode: 'draft' } : {}),
    flow_message_version: '3', flow_id: o.flowId, flow_token: o.token, flow_cta: o.cta, flow_action: 'navigate',
    flow_action_payload: { screen: o.screen, ...(o.data ? { data: o.data } : {}) },
  } } },
})

/** A Meta call that hangs longer than this is aborted and reported as a transient failure (status 0): the cron has 60 s. */
export const SEND_TIMEOUT_MS = 10_000

export function makeSender(cfg: { token: string; phoneNumberId: string; fetchFn?: typeof fetch; timeoutMs?: number }): SendFn {
  const f = cfg.fetchFn ?? fetch
  return async (msg) => {
    try {
      const r = await f(`https://graph.facebook.com/${GRAPH_VERSION}/${cfg.phoneNumberId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? SEND_TIMEOUT_MS),
      })
      const j = await r.json().catch(() => ({}))
      const code = r.ok ? undefined : j?.error?.code
      return { id: r.ok ? (j?.messages?.[0]?.id ?? null) : null, ok: r.ok, status: r.status, ...(typeof code === 'number' ? { errorCode: code } : {}) }
    } catch {
      return { id: null, ok: false, status: 0 }
    }
  }
}
