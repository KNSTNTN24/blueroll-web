// Pure helpers for Settings → Google reviews and the Reviews page (spec §3, §11).
export type ReviewStatus = 'new' | 'drafted' | 'publishing' | 'published' | 'skipped' | 'answered_elsewhere' | 'deleted'
export interface WebDraft { review_version: number; draft_version: number; text: string; source: string; author_name: string | null; created_at: string }
export interface WebReview {
  id: string; site_id: string | null; stars: number; comment: string; reviewer_name: string; update_time: string
  status: ReviewStatus; flags: string[]; version: number; google_reply: string | null; published_text: string | null
  published_at: string | null; published_by_name: string | null; skipped_by_name: string | null; review_drafts: WebDraft[]
}
export type ReviewFilter = 'needs_reply' | 'published' | 'skipped' | 'flagged' | 'all'
export const FILTER_LABEL: Record<ReviewFilter, string> = { needs_reply: 'Needs reply', published: 'Published', skipped: 'Skipped', flagged: '🚨 Food safety', all: 'All' }

const SAFETY = ['food_safety', 'allergy', 'foreign_object', 'hygiene']

export const GOOGLE_ERROR_TEXT: Record<string, string> = {
  denied: 'Google sign-in was cancelled.',
  expired: 'That sign-in took too long or was already used. Please try again.',
  missing_scope: 'Tick the box that lets Blueroll manage your listings, then try again.',
  no_refresh_token: "Google didn't give Blueroll lasting access. Please try again.",
  no_accounts: "This Google account doesn't manage any business profiles. Sign in with the account that manages your restaurants on Google Maps.",
  no_locations: 'No restaurants found on this Google account. Sign in with the account that is Owner or Manager of your restaurants on Google Maps.',
  google: "Google didn't answer. Please try again.",
}

export function googleResultFromQuery(search: string): { ok: boolean; text: string } | null {
  const q = new URLSearchParams(search)
  if (q.get('google') === 'connected') return { ok: true, text: 'Google connected. Choose a site for each restaurant and switch on sync.' }
  const err = q.get('google_error')
  if (err === null) return null
  return { ok: false, text: Object.prototype.hasOwnProperty.call(GOOGLE_ERROR_TEXT, err) ? GOOGLE_ERROR_TEXT[err] : GOOGLE_ERROR_TEXT.google }
}

export function matchesFilter(r: WebReview, f: ReviewFilter): boolean {
  switch (f) {
    case 'needs_reply': return r.status === 'new' || r.status === 'drafted'
    case 'published': return r.status === 'published'
    case 'skipped': return r.status === 'skipped'
    case 'flagged': return r.flags.some((x) => SAFETY.includes(x))
    default: return true
  }
}

export function currentDraft(r: WebReview): WebDraft | null {
  const mine = r.review_drafts.filter((d) => d.review_version === r.version)
  return mine.length ? mine.reduce((a, b) => (b.draft_version > a.draft_version ? b : a)) : null
}

export function statusLabel(r: WebReview): string {
  switch (r.status) {
    case 'published': return `Published by ${r.published_by_name ?? 'Blueroll'}`
    case 'skipped': return `Skipped by ${r.skipped_by_name ?? 'Blueroll'}`
    case 'answered_elsewhere': return 'Answered on Google'
    case 'deleted': return 'Removed from Google'
    case 'publishing': return 'Publishing…'
    default: return 'Needs a reply'
  }
}

export const starsText = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n))
export const isSafetyFlagged = (flags: string[]) => flags.some((x) => SAFETY.includes(x))

export const REVIEW_LINK_STEPS = (code: string) => [
  'Open your managers’ group in Telegram, or create one.',
  'Add @BluerollReviewsBot to the group.',
  `Send this message in the group: /link@BluerollReviewsBot ${code}`,
  'In the group settings → Permissions, turn off “Add members” for members — anyone in the group can publish replies on Google.',
]

export function routeDiff(current: string[], next: string[]) {
  const cur = new Set(current)
  const nxt = new Set(next)
  return { add: [...nxt].filter((x) => !cur.has(x)), remove: [...cur].filter((x) => !nxt.has(x)) }
}
