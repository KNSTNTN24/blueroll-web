// Telegram Bot API adapter: webhook secret check, update parsing, message builders, Mini App initData check, sender.
// Pure WebCrypto; no Node imports. Never logs the bot token.
import type { InboundEvent, OutboundMessage, SendFn } from './types.ts'

export const TG_API = 'https://api.telegram.org'
export const BOT_USERNAME = 'BluerollChecksBot'

// deno-lint-ignore no-explicit-any
type Any = any

const enc = new TextEncoder()
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function verifyWebhookSecret(header: string | null, secret: string): boolean {
  if (!header || !secret) return false
  return constEq(header, secret)
}

const isUserId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0

// Never throws: anything malformed yields no events.
export function parseUpdate(update: unknown): InboundEvent[] {
  try {
    const u = update as Any
    const uid = String(u?.update_id ?? '')
    const m = u?.message
    if (m && typeof m === 'object') {
      if (m.chat?.type !== 'private' || m.from?.is_bot === true || !isUserId(m.from?.id) || typeof m.text !== 'string') return []
      const from = String(m.from.id)
      const raw = m.text.trim()
      const cmd = /^\/([A-Za-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(raw)
      if (!cmd) return [{ kind: 'text', from, text: m.text, id: uid }]
      const [, name, target, arg] = cmd
      if (target && target.toLowerCase() !== BOT_USERNAME.toLowerCase()) return []
      const text = (t: string): InboundEvent[] => [{ kind: 'text', from, text: t, id: uid }]
      switch (name.toLowerCase()) {
        case 'start': return /^\d{6}$/.test((arg ?? '').trim()) ? text(`LINK ${arg!.trim()}`) : text('help')
        case 'checks': return text('checks')
        case 'stop': return text('stop')
        case 'help': return text('help')
        default: return text(m.text)
      }
    }
    const cq = u?.callback_query
    if (cq && typeof cq === 'object') {
      if (!isUserId(cq.from?.id) || cq.from?.is_bot === true) return []
      if (cq.message?.chat?.type !== 'private') return []
      if (typeof cq.data !== 'string' || cq.data === '') return []
      const ev: InboundEvent = { kind: 'button', from: String(cq.from.id), payload: cq.data, id: uid }
      if (typeof cq.id === 'string' && cq.id) ev.callbackId = cq.id
      return [ev]
    }
  } catch { /* malformed: ignore */ }
  return []
}

export const tgText = (chatId: string, text: string): OutboundMessage => ({ chat_id: chatId, text })

const CB_MAX = 64
const truncBytes = (s: string, max: number): string => {
  const e = enc.encode(s)
  if (e.length <= max) return s
  let out = ''
  for (const ch of s) { if (enc.encode(out + ch).length > max) break; out += ch }
  return out
}

export const tgButtons = (chatId: string, text: string, buttons: { id: string; title: string }[]): OutboundMessage => ({
  chat_id: chatId, text,
  reply_markup: { inline_keyboard: buttons.map((b) => [{ text: b.title, callback_data: truncBytes(b.id, CB_MAX) }]) },
})

export const tgWebAppButton = (chatId: string, text: string, buttons: { title: string; url: string }[]): OutboundMessage => ({
  chat_id: chatId, text,
  reply_markup: { inline_keyboard: buttons.map((b) => [{ text: b.title, web_app: { url: b.url } }]) },
})

async function hmac(key: BufferSource, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(msg))
}

export async function verifyInitData(initData: string, botToken: string, now: Date, maxAgeSec = 86400): Promise<{ userId: string } | null> {
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash) return null
    params.delete('hash')
    const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n')
    const secret = await hmac(enc.encode('WebAppData'), botToken)
    const expected = hex(await hmac(secret, dcs))
    if (!constEq(expected, hash.toLowerCase())) return null
    const authDate = Number(params.get('auth_date'))
    if (!Number.isFinite(authDate) || authDate <= 0) return null
    const age = now.getTime() / 1000 - authDate
    if (age > maxAgeSec || age < -300) return null
    const id = JSON.parse(params.get('user') ?? '')?.id
    if (!isUserId(id)) return null
    return { userId: String(id) }
  } catch {
    return null
  }
}

export function makeTelegramSender(cfg: { token: string; fetchFn?: typeof fetch }): SendFn {
  const f = cfg.fetchFn ?? fetch
  const post = (method: string, body: unknown) =>
    f(`${TG_API}/bot${cfg.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return async (msg) => {
    try {
      const { callback_query_id, ...body } = msg as Record<string, unknown>
      if (typeof callback_query_id === 'string' && callback_query_id) {
        await post('answerCallbackQuery', { callback_query_id }).catch(() => undefined)   // best-effort: stops the button spinner
      }
      const r = await post('sendMessage', body)
      const j = await r.json().catch(() => ({}))
      const mid = j?.result?.message_id
      return { id: r.ok && mid != null ? String(mid) : null, ok: r.ok, status: r.status }
    } catch {
      return { id: null, ok: false, status: 0 }
    }
  }
}

export async function setupBot(cfg: { token: string; webhookUrl: string; secret: string; fetchFn?: typeof fetch }): Promise<{ ok: boolean; errors: string[] }> {
  const f = cfg.fetchFn ?? fetch
  const errors: string[] = []
  const call = async (method: string, body: unknown) => {
    try {
      const r = await f(`${TG_API}/bot${cfg.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) errors.push(`${method}: ${r.status} ${String(j?.description ?? '').replaceAll(cfg.token, '***')}`.trim())
    } catch (e) {
      errors.push(`${method}: ${String((e as Error)?.message ?? e).replaceAll(cfg.token, '***')}`)
    }
  }
  await call('setWebhook', { url: cfg.webhookUrl, secret_token: cfg.secret, allowed_updates: ['message', 'callback_query'] })
  await call('setMyCommands', { commands: [
    { command: 'checks', description: 'Show my checks' },
    { command: 'help', description: 'How this bot works' },
    { command: 'stop', description: 'Stop reminders' },
  ] })
  return { ok: errors.length === 0, errors }
}
