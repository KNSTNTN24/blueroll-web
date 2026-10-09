// WhatsApp Cloud API: signature check, inbound parsing, outbound message builders. No runtime imports.
import type { InboundEvent, OutboundMessage, SendFn } from './types.ts'

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
    } else if (m.type === 'interactive' && m.interactive?.type === 'nfm_reply') {
      try {
        const parsed = JSON.parse(m.interactive.nfm_reply?.response_json ?? '')
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
        const { flow_token, ...response } = parsed
        if (typeof flow_token === 'string') out.push({ kind: 'flow', from, token: flow_token, response, id })
      } catch { /* malformed flow reply: ignore */ }
    }
  }
  return out
}

export const textMessage = (to: string, body: string): OutboundMessage =>
  ({ messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } })

export const buttonsMessage = (to: string, body: string, buttons: { id: string; title: string }[]): OutboundMessage => ({
  messaging_product: 'whatsapp', to, type: 'interactive',
  interactive: { type: 'button', body: { text: body }, action: {
    buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.length > 20 ? b.title.slice(0, 19) + '…' : b.title } })),
  } },
})

export const templateMessage = (to: string, name: string, bodyParams: string[], quickReplies: string[]): OutboundMessage => ({
  messaging_product: 'whatsapp', to, type: 'template',
  template: { name, language: { code: 'en_GB' }, components: [
    { type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) },
    ...quickReplies.map((payload, i) => ({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload }] })),
  ] },
})

export const flowMessage = (to: string, o: { flowId: string; token: string; cta: string; body: string; screen: string; data?: Record<string, unknown> }): OutboundMessage => ({
  messaging_product: 'whatsapp', to, type: 'interactive',
  interactive: { type: 'flow', body: { text: o.body }, action: { name: 'flow', parameters: {
    flow_message_version: '3', flow_id: o.flowId, flow_token: o.token, flow_cta: o.cta, flow_action: 'navigate',
    flow_action_payload: { screen: o.screen, ...(o.data ? { data: o.data } : {}) },
  } } },
})

export function makeSender(cfg: { token: string; phoneNumberId: string; fetchFn?: typeof fetch }): SendFn {
  const f = cfg.fetchFn ?? fetch
  return async (msg) => {
    try {
      const r = await f(`https://graph.facebook.com/${GRAPH_VERSION}/${cfg.phoneNumberId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
      })
      const j = await r.json().catch(() => ({}))
      return { id: r.ok ? (j?.messages?.[0]?.id ?? null) : null, ok: r.ok, status: r.status }
    } catch {
      return { id: null, ok: false, status: 0 }
    }
  }
}
