import { describe, it, expect } from 'vitest'
import { GOOGLE_ERROR_TEXT, googleResultFromQuery, matchesFilter, currentDraft, statusLabel, starsText, routeDiff, type WebReview } from '@/lib/reviews/format'

const r = (o: Partial<WebReview> = {}): WebReview => ({
  id: 'r1', site_id: 's1', stars: 2, comment: 'Cold', reviewer_name: 'Sarah Kim', update_time: '2026-10-15T13:02:00Z', status: 'drafted',
  flags: [], version: 1, google_reply: null, published_text: null, published_at: null, published_by_name: null, skipped_by_name: null,
  review_drafts: [], ...o,
})

describe('googleResultFromQuery', () => {
  it('connected', () => expect(googleResultFromQuery('?tab=reviews&google=connected')).toEqual({ ok: true, text: 'Google connected. Choose a site for each restaurant and switch on sync.' }))
  it('known error codes get plain text; unknown codes a generic line', () => {
    expect(googleResultFromQuery('?google_error=missing_scope')).toEqual({ ok: false, text: GOOGLE_ERROR_TEXT.missing_scope })
    expect(googleResultFromQuery('?google_error=<script>')).toEqual({ ok: false, text: GOOGLE_ERROR_TEXT.google })
  })
  it('nothing → null', () => expect(googleResultFromQuery('?tab=reviews')).toBeNull())
})

describe('review helpers', () => {
  it('filters', () => {
    expect(matchesFilter(r(), 'needs_reply')).toBe(true)
    expect(matchesFilter(r({ status: 'published' }), 'needs_reply')).toBe(false)
    expect(matchesFilter(r({ flags: ['allergy'] }), 'flagged')).toBe(true)
    expect(matchesFilter(r({ flags: ['staff_named'] }), 'flagged')).toBe(false)
    expect(matchesFilter(r({ status: 'skipped' }), 'skipped')).toBe(true)
    expect(matchesFilter(r({ status: 'deleted' }), 'all')).toBe(true)
  })
  it('currentDraft = highest draft of the current review version', () => {
    const drafts = [
      { review_version: 1, draft_version: 1, text: 'a', source: 'ai', author_name: null, created_at: '' },
      { review_version: 2, draft_version: 1, text: 'b', source: 'ai', author_name: null, created_at: '' },
      { review_version: 2, draft_version: 2, text: 'c', source: 'edited', author_name: 'Anna', created_at: '' },
    ]
    expect(currentDraft(r({ version: 2, review_drafts: drafts }))?.text).toBe('c')
    expect(currentDraft(r({ version: 3, review_drafts: drafts }))).toBeNull()
  })
  it('labels', () => {
    expect(statusLabel(r({ status: 'published', published_by_name: 'Anna' }))).toBe('Published by Anna')
    expect(statusLabel(r({ status: 'answered_elsewhere' }))).toBe('Answered on Google')
    expect(statusLabel(r({ status: 'new' }))).toBe('Needs a reply')
    expect(starsText(4)).toBe('★★★★☆')
  })
  it('routeDiff', () => expect(routeDiff(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] }))
})
