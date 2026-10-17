import { describe, it, expect } from 'vitest'
import { renderCard, encodeCb, parseCb, shortName, starsLine, cardSend, cardEdit, CARD_TEXT, REVIEW_CLIP, type CardView } from '../../../../supabase/functions/_shared/reviews/card'
import type { Review, Draft } from '../../../../supabase/functions/_shared/reviews/types'

const RID = '0b6f5c1e-4a2b-4c3d-8e9f-0123456789ab'
export const review = (o: Partial<Review> = {}): Review => ({
  id: RID, business_id: 'b1', location_id: 'l1', site_id: 's1', google_review_id: 'g1', version: 1, delivered_version: 0,
  stars: 2, comment: 'Waited 40 minutes for mains, pasta was cold', reviewer_name: 'Sarah Kim',
  create_time: '2026-10-15T13:02:00Z', update_time: '2026-10-15T13:02:00Z', google_reply: null, google_reply_time: null,
  language: 'en', flags: [], notify: true, status: 'drafted', published_text: null, published_at: null, published_by_name: null,
  skipped_at: null, skipped_by_name: null, ...o,
})
const draft = (o: Partial<Draft> = {}): Draft => ({ id: 'd1', review_id: RID, review_version: 1, draft_version: 1, text: 'Hi Sarah, thank you for letting us know…', source: 'ai', author_name: null, created_at: '2026-10-15T13:05:00Z', ...o })
const view = (o: Partial<CardView> = {}): CardView => ({ review: review(), siteName: 'Casa-Mia Wharf Side', timezone: 'Europe/London', draft: draft(), mapsUri: 'https://maps.google.com/?cid=9', connectionActive: true, appUrl: 'https://app.blueroll.app', ...o })
const texts = (kb: { text: string }[][]) => kb.map((row) => row.map((b) => b.text))

describe('callback codec', () => {
  it('round-trips and fits 64 bytes', () => {
    for (const c of [{ action: 'p', reviewId: RID, draftVersion: 12, at: null }, { action: 'y', reviewId: RID, draftVersion: 9999, at: 1760533200 }] as const) {
      const s = encodeCb(c)
      expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(64)
      expect(parseCb(s)).toEqual(c)
    }
  })
  it('rejects junk', () => {
    for (const s of ['rv:x:' + RID + ':1', 'rv:p:not-a-uuid:1', 'rv:p:' + RID, 'cl:p:' + RID + ':1', 42, null]) expect(parseCb(s)).toBeNull()
  })
})

describe('helpers', () => {
  it('shortName', () => {
    expect(shortName('Sarah Kim')).toBe('Sarah K.')
    expect(shortName('  Anna  ')).toBe('Anna')
    expect(shortName('Mary Jane watson')).toBe('Mary W.')
    expect(shortName('')).toBe('A Google user')
  })
  it('starsLine', () => expect(starsLine(2)).toBe('⭐⭐☆☆☆'))
})

describe('renderCard', () => {
  it('open card: spec layout and buttons', () => {
    const c = renderCard(view())
    expect(c.html).toBe([
      '⭐⭐☆☆☆  Casa-Mia Wharf Side · Google',
      '“Waited 40 minutes for mains, pasta was cold” — Sarah K., 15 Oct, 14:02',
      '',
      'Suggested reply:',
      'Hi Sarah, thank you for letting us know…',
    ].join('\n'))
    expect(texts(c.keyboard)).toEqual([['✅ Publish', '✏️ Edit'], ['🔄 Another', '✖️ Skip']])
    expect((c.keyboard[0][0] as { callback_data: string }).callback_data).toBe(`rv:p:${RID}:1`)
  })
  it('escapes HTML in review, name and draft', () => {
    const c = renderCard(view({ review: review({ comment: '<b>bad</b> & co', reviewer_name: 'A<i>' }), draft: draft({ text: '<script>' }) }))
    expect(c.html).toContain('“&lt;b&gt;bad&lt;/b&gt; &amp; co” — A&lt;i&gt;')
    expect(c.html).toContain('&lt;script&gt;')
  })
  it('long review is clipped with a link to Google', () => {
    const c = renderCard(view({ review: review({ comment: 'x'.repeat(REVIEW_CLIP + 10) }) }))
    expect(c.html).toContain(`${'x'.repeat(REVIEW_CLIP)}${CARD_TEXT.more}”`)
    expect(c.keyboard.at(-1)).toEqual([{ text: 'Open on Google', url: 'https://maps.google.com/?cid=9' }])
  })
  it('rating only', () => expect(renderCard(view({ review: review({ comment: '' }) })).html.split('\n')[1]).toBe('(rating only, no text) — Sarah K., 15 Oct, 14:02'))
  it('edited review is marked', () => expect(renderCard(view({ review: review({ version: 2 }) })).html.split('\n')[0]).toBe('⭐⭐☆☆☆  Casa-Mia Wharf Side · Google · edited'))
  it('food safety: 🚨 line, no Another, Log as complaint link', () => {
    const c = renderCard(view({ review: review({ flags: ['allergy'] }) }))
    expect(c.html.split('\n')[1]).toBe('🚨 <b>Food safety complaint</b>')
    expect(texts(c.keyboard)).toEqual([['✅ Publish', '✏️ Edit'], ['✖️ Skip'], ['📝 Log as complaint']])
    expect(c.keyboard[2][0]).toEqual({ text: '📝 Log as complaint', url: `https://app.blueroll.app/incidents?site=s1&review=${RID}` })
  })
  it('no draft: says so, no Publish', () => {
    const c = renderCard(view({ draft: null, review: review({ status: 'new' }) }))
    expect(c.html).toContain(CARD_TEXT.draftFailed)
    expect(texts(c.keyboard)).toEqual([['✏️ Edit'], ['🔄 Another', '✖️ Skip']])
    expect((c.keyboard[0][0] as { callback_data: string }).callback_data).toBe(`rv:e:${RID}:0`)
  })
  it('confirm state', () => {
    const c = renderCard(view({ confirmAt: 1760533200 }))
    expect(c.html.endsWith('\n\n<b>Publish this reply?</b>')).toBe(true)
    expect(c.keyboard).toEqual([[{ text: '✅ Yes, publish', callback_data: `rv:y:${RID}:1:1760533200` }, { text: 'Cancel', callback_data: `rv:c:${RID}:1` }]])
  })
  it('note is shown in italics', () => expect(renderCard(view({ note: "Couldn't publish — try again" })).html).toContain("<i>Couldn't publish — try again</i>"))
  it.each([
    [{ status: 'published', published_text: 'Hi Sarah, sorry', published_by_name: 'Anna S.', published_at: '2026-10-15T13:07:00Z' }, ['Reply:', 'Hi Sarah, sorry', '', '✅ Published by Anna S. · 14:07']],
    [{ status: 'skipped', skipped_by_name: 'Anna S.' }, ['✖️ Skipped by Anna S.']],
    [{ status: 'answered_elsewhere', google_reply: 'Thanks!' }, ['Reply on Google:', 'Thanks!', '', '💬 Answered on Google']],
    [{ status: 'deleted' }, ['🗑 This review was removed from Google']],
    [{ status: 'publishing' }, ['⏳ Publishing…']],
  ] as [Partial<Review>, string[]][])('final state %o has no buttons', (patch, tail) => {
    const c = renderCard(view({ review: review(patch) }))
    expect(c.keyboard).toEqual([])
    expect(c.html.split('\n').slice(-tail.length)).toEqual(tail)
  })
  it('disconnected: no buttons', () => {
    const c = renderCard(view({ connectionActive: false }))
    expect(c.keyboard).toEqual([])
    expect(c.html.endsWith(CARD_TEXT.disconnected)).toBe(true)
  })
})

describe('bodies', () => {
  it('send and edit use HTML, no previews, inline keyboard (empty clears buttons)', () => {
    const card = { html: 'x', keyboard: [] }
    expect(cardSend('-1', card)).toEqual({ chat_id: '-1', text: 'x', parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [] } })
    expect(cardEdit('-1', '7', card)).toEqual({ chat_id: '-1', message_id: 7, text: 'x', parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [] } })
  })
})
