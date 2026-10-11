// Telegram Bot API adapter: webhook secret check, update parsing, message builders, Mini App initData check, sender.
// Pure WebCrypto; no Node imports. Never logs the bot token.
import type { OutboundMessage, SendFn } from './types.ts'

export const TG_API = 'https://api.telegram.org'
export const BOT_USERNAME = 'BluerollChecksBot'
/** Telegram Mini App checklist form (web). */
export const TG_MINI_APP_URL = 'https://app.blueroll.app/tg/form'

/**
 * Mini App short name registered in BotFather (/newapp, URL https://app.blueroll.app/tg/form). Kostya picks it in
 * BotFather; if he chooses another name, change only this constant. Groups can't use web_app buttons (private chats
 * only), so the live list opens the Mini App through this direct link.
 */
export const TG_MINI_APP_SHORT_NAME = 'form'
export const miniAppLink = (token: string) => `https://t.me/${BOT_USERNAME}/${TG_MINI_APP_SHORT_NAME}?startapp=${encodeURIComponent(token)}`

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

export type TgEvent =
  | { kind: 'private'; chatId: string; id: string }
  | { kind: 'command'; chatId: string; chatTitle: string; userId: string; command: 'link' | 'checks' | 'help'; arg: string; id: string }
  | { kind: 'bot_removed'; chatId: string; id: string }
  | { kind: 'migrated'; chatId: string; newChatId: string; id: string }

const GROUP_COMMANDS: Record<string, 'link' | 'checks' | 'help'> = { link: 'link', checks: 'checks', help: 'help', start: 'help' }
const isGroupChat = (t: unknown) => t === 'group' || t === 'supergroup'
const isChatId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v !== 0

/**
 * Groups-only bot (spec §3, §7). Privacy mode stays on, so in groups we only see commands and service messages.
 * Any private message → 'private' (the caller answers "use your team's group"). Never throws.
 */
export function parseGroupUpdate(update: unknown): TgEvent[] {
  try {
    const u = update as Any
    const id = String(u?.update_id ?? '')
    const mcm = u?.my_chat_member
    if (mcm && typeof mcm === 'object') {
      if (!isGroupChat(mcm.chat?.type) || !isChatId(mcm.chat?.id)) return []
      const st = mcm.new_chat_member?.status
      return st === 'left' || st === 'kicked' ? [{ kind: 'bot_removed', chatId: String(mcm.chat.id), id }] : []
    }
    const m = u?.message
    if (!m || typeof m !== 'object' || !isChatId(m.chat?.id)) return []
    const chatId = String(m.chat.id)
    if (m.chat.type === 'private') {
      return m.from?.is_bot === true || !isUserId(m.from?.id) ? [] : [{ kind: 'private', chatId, id }]
    }
    if (!isGroupChat(m.chat.type)) return []
    if (isChatId(m.migrate_to_chat_id)) return [{ kind: 'migrated', chatId, newChatId: String(m.migrate_to_chat_id), id }]
    // Anonymous group admins post as GroupAnonymousBot (is_bot) with sender_chat = the group itself.
    const anonymousAdmin = m.from?.is_bot === true && m.sender_chat?.id === m.chat.id
    if (!anonymousAdmin && (m.from?.is_bot === true || !isUserId(m.from?.id))) return []
    if (typeof m.text !== 'string') return []
    const cmd = /^\/([A-Za-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(m.text.trim())
    if (!cmd) return []
    const [, name, target, arg] = cmd
    if (target && target.toLowerCase() !== BOT_USERNAME.toLowerCase()) return []
    const key = name.toLowerCase()
    const command = Object.prototype.hasOwnProperty.call(GROUP_COMMANDS, key) ? GROUP_COMMANDS[key] : undefined
    if (!command) return []
    return [{
      kind: 'command', chatId, chatTitle: typeof m.chat.title === 'string' ? m.chat.title : '',
      userId: anonymousAdmin ? '' : String(m.from.id), command, arg: (arg ?? '').trim(), id,
    }]
  } catch { /* malformed: ignore */ }
  return []
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type TgKeyboard = { text: string; url: string }[][]

/** sendMessage body: HTML parse mode, no link previews, optional URL buttons (one per row as given). */
export const tgHtml = (chatId: string, html: string, keyboard: TgKeyboard = []): OutboundMessage => ({
  chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
  ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
})

/** editMessageText body. reply_markup is always sent: an empty keyboard removes buttons left from the previous state. */
export const tgEditHtml = (chatId: string, messageId: string, html: string, keyboard: TgKeyboard): OutboundMessage => ({
  chat_id: chatId, message_id: Number(messageId), text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
  reply_markup: { inline_keyboard: keyboard },
})

export interface TgApiResult { ok: boolean; status: number; description: string; result: Any; migrateTo: string | null }
/** One Bot API call. Never throws; never returns the token in `description`. */
export type TgApi = (method: string, body: Record<string, unknown>) => Promise<TgApiResult>

export function makeTelegramApi(cfg: { token: string; fetchFn?: typeof fetch }): TgApi {
  const f = cfg.fetchFn ?? fetch
  const scrub = (s: string) => (cfg.token ? s.replaceAll(cfg.token, '***') : s)
  return async (method, body) => {
    try {
      const r = await f(`${TG_API}/bot${cfg.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      const mig = j?.parameters?.migrate_to_chat_id
      return {
        ok: r.ok && j?.ok !== false, status: r.status, description: scrub(String(j?.description ?? '')),
        result: j?.result ?? null, migrateTo: typeof mig === 'number' ? String(mig) : null,
      }
    } catch {
      return { ok: false, status: 0, description: 'network', result: null, migrateTo: null }
    }
  }
}

export type TgOutcome = 'ok' | 'not_modified' | 'gone' | 'kicked' | 'migrated' | 'retry'

/** Live-list error mapping (spec §4). */
export function tgOutcome(r: TgApiResult): TgOutcome {
  if (r.ok) return 'ok'
  const d = r.description.toLowerCase()
  if (d.includes('message is not modified')) return 'not_modified'
  if (r.migrateTo) return 'migrated'
  if (r.status === 403 || d.includes('bot was kicked') || d.includes('bot is not a member') || d.includes('chat not found')) return 'kicked'
  if (d.includes('message to edit not found') || d.includes('message to delete not found')
    || d.includes("message can't be deleted") || d.includes("message can't be edited") || d.includes('message_id_invalid')) return 'gone'
  return 'retry'
}

/** getChatMember → may this user fill in this group's checks? (spec §5: creator, administrator, member, restricted+is_member). */
export function memberStatus(r: TgApiResult): 'member' | 'not_member' | 'unknown' {
  if (r.ok) {
    const s = r.result?.status
    if (s === 'creator' || s === 'administrator' || s === 'member') return 'member'
    if (s === 'restricted') return r.result?.is_member === true ? 'member' : 'not_member'
    return 'not_member'
  }
  if (r.status === 400 && /user not found|participant_id_invalid|member not found/i.test(r.description)) return 'not_member'
  return 'unknown'
}

/** getChat → can ordinary members add people? null when Telegram didn't answer. */
export function membersCanInvite(r: TgApiResult): boolean | null {
  if (!r.ok) return null
  return r.result?.permissions?.can_invite_users === true
}

export const tgText = (chatId: string, text: string): OutboundMessage => ({ chat_id: chatId, text })

/** Telegram rejects callback_data over 64 bytes; never truncate silently (a cut id can't be routed back). */
const CB_MAX = 64

export const tgButtons = (chatId: string, text: string, buttons: { id: string; title: string }[]): OutboundMessage => ({
  chat_id: chatId, text,
  reply_markup: { inline_keyboard: buttons.map((b) => {
    if (enc.encode(b.id).length > CB_MAX) throw new Error(`telegram callback_data over ${CB_MAX} bytes`)
    return [{ text: b.title, callback_data: b.id }]
  }) },
})

export const tgWebAppButton = (chatId: string, text: string, buttons: { title: string; url: string }[]): OutboundMessage => ({
  chat_id: chatId, text,
  reply_markup: { inline_keyboard: buttons.map((b) => [{ text: b.title, web_app: { url: b.url } }]) },
})

async function hmac(key: BufferSource, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(msg))
}

export interface TgUser { userId: string; firstName: string; lastName: string }

export async function verifyInitData(initData: string, botToken: string, now: Date, maxAgeSec = 86400): Promise<TgUser | null> {
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
    const user = JSON.parse(params.get('user') ?? '')
    if (!isUserId(user?.id)) return null
    return {
      userId: String(user.id),
      firstName: typeof user.first_name === 'string' ? user.first_name : '',
      lastName: typeof user.last_name === 'string' ? user.last_name : '',
    }
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
      const r = await post('sendMessage', msg)
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
  await call('setWebhook', { url: cfg.webhookUrl, secret_token: cfg.secret, allowed_updates: ['message', 'my_chat_member'] })
  // Private chats: only /help (the bot answers every private message with "use your team's group").
  await call('setMyCommands', { commands: [{ command: 'help', description: 'How Blueroll checks work' }] })
  await call('setMyCommands', { scope: { type: 'all_group_chats' }, commands: [
    { command: 'checks', description: "Show today's checks" },
    { command: 'link', description: 'Link this group to Blueroll' },
    { command: 'help', description: 'How Blueroll checks work' },
  ] })
  return { ok: errors.length === 0, errors }
}
