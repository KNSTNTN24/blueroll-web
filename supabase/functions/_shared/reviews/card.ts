// supabase/functions/_shared/reviews/card.ts
// Spec §8: the review card in a Telegram group (HTML, escaped) and its callback_data codec. Pure.
import { escapeHtml } from '../channels/telegram.ts'
import { isSafety } from './draft.ts'
import { NEEDS_REPLY, type Draft, type Review } from './types.ts'

export type CbAction = 'p' | 'y' | 'c' | 'e' | 'a' | 's'
export interface Cb { action: CbAction; reviewId: string; draftVersion: number; at: number | null }
const CB_RE = /^rv:([pycaes]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{1,4})(?::(\d{10}))?$/
const CB_MAX = 64

export function encodeCb(c: Cb): string {
  const s = `rv:${c.action}:${c.reviewId}:${c.draftVersion}${c.at != null ? `:${c.at}` : ''}`
  if (new TextEncoder().encode(s).length > CB_MAX) throw new Error(`callback_data over ${CB_MAX} bytes`)
  return s
}
export function parseCb(s: unknown): Cb | null {
  if (typeof s !== 'string') return null
  const m = CB_RE.exec(s)
  return m ? { action: m[1] as CbAction, reviewId: m[2], draftVersion: Number(m[3]), at: m[4] ? Number(m[4]) : null } : null
}

export type InlineButton = { text: string; callback_data: string } | { text: string; url: string }
export interface CardView {
  review: Review; siteName: string; timezone: string; draft: Draft | null; mapsUri: string | null
  connectionActive: boolean; appUrl: string; confirmAt?: number | null; note?: string | null
}
export interface Card { html: string; keyboard: InlineButton[][] }

export const REVIEW_CLIP = 1500
export const DRAFT_CLIP = 1800
export const CONFIRM_WINDOW_SEC = 60
export const CARD_TEXT = {
  draftFailed: "Couldn't draft a reply — tap Edit to write one",
  confirm: 'Publish this reply?',
  published: (by: string, at: string) => `✅ Published by ${by} · ${at}`,
  skipped: (by: string) => `✖️ Skipped by ${by}`,
  answeredElsewhere: '💬 Answered on Google',
  deleted: '🗑 This review was removed from Google',
  publishing: '⏳ Publishing…',
  disconnected: 'Google disconnected — reconnect in Settings → Google reviews.',
  safety: '🚨 <b>Food safety complaint</b>',
  edited: '✏️ This review was edited on Google — see the new card.',
  noText: '(rating only, no text)',
  more: '… (full text on Google)',
  longReply: '… (open Blueroll to see the full reply)',
}

export const starsLine = (n: number) => '⭐'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n))

export function shortName(display: string): string {
  const p = (display ?? '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return 'A Google user'
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0]
}

function parts(iso: string, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const o = Object.fromEntries(f.formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
  return { day: o.day, month: o.month, hm: `${o.hour}:${o.minute}` }
}
const stamp = (iso: string, tz: string) => { const p = parts(iso, tz); return `${p.day} ${p.month}, ${p.hm}` }
const hhmm = (iso: string, tz: string) => parts(iso, tz).hm
const clip = (s: string, n: number, tail: string) => (s.length > n ? `${s.slice(0, n)}${tail}` : s)

export function renderCard(v: CardView): Card {
  const r = v.review
  const out: string[] = [`${starsLine(r.stars)}  ${escapeHtml(v.siteName || 'Your restaurant')} · Google${r.version > 1 ? ' · edited' : ''}`]
  if (isSafety(r.flags)) out.push(CARD_TEXT.safety)
  const text = r.comment.trim()
  const who = `${escapeHtml(shortName(r.reviewer_name))}, ${stamp(r.update_time, v.timezone)}`
  out.push(text ? `“${escapeHtml(clip(text, REVIEW_CLIP, CARD_TEXT.more))}” — ${who}` : `${CARD_TEXT.noText} — ${who}`)
  const block = (label: string, body: string) => out.push('', label, escapeHtml(clip(body, DRAFT_CLIP, CARD_TEXT.longReply)))
  const kb: InlineButton[][] = []

  switch (r.status) {
    case 'published':
      block('Reply:', r.published_text ?? '')
      out.push('', CARD_TEXT.published(escapeHtml(r.published_by_name ?? 'Blueroll'), r.published_at ? hhmm(r.published_at, v.timezone) : ''))
      break
    case 'skipped':
      out.push('', CARD_TEXT.skipped(escapeHtml(r.skipped_by_name ?? 'Blueroll')))
      break
    case 'answered_elsewhere':
      if (r.google_reply) block('Reply on Google:', r.google_reply)
      out.push('', CARD_TEXT.answeredElsewhere)
      break
    case 'deleted':
      out.push('', CARD_TEXT.deleted)
      break
    default: {
      if (v.draft) block('Suggested reply:', v.draft.text)
      else out.push('', CARD_TEXT.draftFailed)
      if (r.status === 'publishing') { out.push('', CARD_TEXT.publishing); break }
      if (!v.connectionActive) { out.push('', CARD_TEXT.disconnected); break }
      if (v.note) out.push('', `<i>${escapeHtml(v.note)}</i>`)
      const dv = v.draft?.draft_version ?? 0
      const cb = (action: CbAction, at: number | null = null) => encodeCb({ action, reviewId: r.id, draftVersion: dv, at })
      if (v.confirmAt != null && v.draft) {
        out.push('', `<b>${CARD_TEXT.confirm}</b>`)
        kb.push([{ text: '✅ Yes, publish', callback_data: cb('y', v.confirmAt) }, { text: 'Cancel', callback_data: cb('c') }])
      } else {
        kb.push([...(v.draft ? [{ text: '✅ Publish', callback_data: cb('p') }] : []), { text: '✏️ Edit', callback_data: cb('e') }])
        kb.push([...(isSafety(r.flags) ? [] : [{ text: '🔄 Another', callback_data: cb('a') }]), { text: '✖️ Skip', callback_data: cb('s') }])
      }
    }
  }

  if (NEEDS_REPLY.includes(r.status) && v.connectionActive && v.confirmAt == null) {
    const links: InlineButton[] = []
    if (isSafety(r.flags) && r.site_id) links.push({ text: '📝 Log as complaint', url: `${v.appUrl}/incidents?site=${r.site_id}&review=${r.id}` })
    if (text.length > REVIEW_CLIP && v.mapsUri) links.push({ text: 'Open on Google', url: v.mapsUri })
    if (links.length) kb.push(links)
  }
  return { html: out.join('\n'), keyboard: kb }
}

export const cardSend = (chatId: string, c: Card) => ({
  chat_id: chatId, text: c.html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: c.keyboard },
})
export const cardEdit = (chatId: string, messageId: string, c: Card) => ({
  chat_id: chatId, message_id: Number(messageId), text: c.html, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
  reply_markup: { inline_keyboard: c.keyboard },
})
