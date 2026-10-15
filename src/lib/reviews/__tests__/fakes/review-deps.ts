// In-memory ReviewDeps + Google + drafter for the reviews tests. Mirrors reviews-db.ts semantics (atomic claims, filters).
import type { ReviewDeps, Ctx } from '../../../../../supabase/functions/_shared/reviews/deps'
import type { Google, GReview } from '../../../../../supabase/functions/_shared/reviews/google'
import { GoogleError } from '../../../../../supabase/functions/_shared/reviews/google'
import type { DraftFn, DraftInput } from '../../../../../supabase/functions/_shared/reviews/draft'
import {
  DEFAULT_SETTINGS, type Actor, type AuditRow, type Connection, type Draft, type EditPrompt, type Location, type Review,
  type ReviewCard, type RouteGroup, type SiteLite,
} from '../../../../../supabase/functions/_shared/reviews/types'
import { fakeTgApi } from '../../../whatsapp/__tests__/fakes/group-deps'

export const NOW = new Date('2026-10-15T13:30:00Z')
export const ANNA: Actor = { channel: 'telegram', profile_id: null, external_id: '42', name: 'Anna S.' }
export const SITE: SiteLite = { id: 's1', name: 'Casa-Mia Wharf Side', timezone: 'Europe/London', postcode: 'N1 7GR' }
export const CONN: Connection = { id: 'c1', business_id: 'b1', google_email: 'owner@casamia.co.uk', vault_secret_id: 'sec1', status: 'active', connected_at: '2026-10-01T00:00:00Z', last_sync_at: null }
export const LOC: Location = {
  id: 'l1', connection_id: 'c1', business_id: 'b1', gbp_account: 'accounts/1', gbp_location: 'locations/9', title: 'Casa-Mia Wharf Side',
  address: '', postcode: 'N1 7GR', maps_uri: 'https://maps/9', can_reply: true, site_id: 's1', enabled: true, enabled_at: '2026-10-01T00:00:00Z',
  last_review_update_time: null, last_full_pass_at: null,
}
let seq = 0
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
export const mkReview = (o: Partial<Review> = {}): Review => ({
  id: uuid(), business_id: 'b1', location_id: 'l1', site_id: 's1', google_review_id: `g${seq}`, version: 1, delivered_version: 0,
  stars: 2, comment: 'Waited 40 minutes for mains, pasta was cold', reviewer_name: 'Sarah Kim',
  create_time: '2026-10-15T13:02:00Z', update_time: '2026-10-15T13:02:00Z', google_reply: null, google_reply_time: null,
  language: null, flags: [], notify: true, status: 'new', published_text: null, published_at: null, published_by_name: null,
  skipped_at: null, skipped_by_name: null, ...o,
})
export const gReview = (o: Partial<GReview> = {}): GReview => ({
  reviewId: 'g-new', name: '', stars: 4, comment: 'Lovely', reviewer: 'Tom Lee', createTime: '2026-10-15T13:10:00Z', updateTime: '2026-10-15T13:10:00Z', reply: null, replyTime: null, ...o,
})

export interface FakeState {
  conns: Connection[]; locs: Location[]; reviews: Review[]; drafts: Draft[]; cards: (ReviewCard & { group_id: string })[]
  groups: (RouteGroup & { unlinked: boolean })[]; routes: { site_id: string; group_id: string }[]; prompts: EditPrompt[]
  audits: AuditRow[]; notes: { user_id: string; title: string; message: string; link: string }[]; logs: string[]
  entitled: boolean; managers: string[]; secrets: Map<string, string>
}

export function fakeReviewDeps(init: Partial<FakeState> = {}) {
  const s: FakeState = {
    conns: [{ ...CONN }], locs: [{ ...LOC }], reviews: [], drafts: [], cards: [], groups: [{ id: 'gr1', business_id: 'b1', chat_id: '-100', unlinked: false }],
    routes: [{ site_id: 's1', group_id: 'gr1' }], prompts: [], audits: [], notes: [], logs: [], entitled: true, managers: ['m1'],
    secrets: new Map([['sec1', 'rt1']]), ...init,
  }
  const rv = (id: string) => s.reviews.find((r) => r.id === id) ?? null
  const live = (g: RouteGroup & { unlinked: boolean }) => !g.unlinked
  const d: ReviewDeps = {
    now: () => NOW,
    entitled: async () => s.entitled,
    businessName: async () => 'Casa-Mia',
    settings: async () => ({ ...DEFAULT_SETTINGS, sign_off: '— The Casa-Mia team' }),
    site: async (id) => (id === SITE.id ? SITE : null),
    activeConnections: async () => s.conns.filter((c) => c.status === 'active'),
    activeConnection: async (b) => s.conns.find((c) => c.business_id === b && c.status === 'active') ?? null,
    accessToken: async (c) => {
      const rt = c.vault_secret_id ? s.secrets.get(c.vault_secret_id) : null
      if (!rt || rt === 'revoked') throw new GoogleError('invalid_grant', 400, 'Token has been expired or revoked.')
      return `at-for-${rt}`
    },
    connectionFailed: async (c) => { const row = s.conns.find((x) => x.id === c.id)!; if (row.status !== 'active') return false; row.status = 'error'; return true },
    touchConnection: async (id, now) => { s.conns.find((c) => c.id === id)!.last_sync_at = now.toISOString() },
    location: async (id) => s.locs.find((l) => l.id === id) ?? null,
    enabledLocations: async (cid) => s.locs.filter((l) => l.connection_id === cid && l.enabled),
    saveCursor: async (id, p) => { Object.assign(s.locs.find((l) => l.id === id)!, p) },
    review: async (id) => { const r = rv(id); return r ? { ...r } : null },
    reviewsByGoogleId: async (b, ids) => new Map(s.reviews.filter((r) => r.business_id === b && ids.includes(r.google_review_id)).map((r) => [r.google_review_id, { ...r }])),
    insertReview: async (n) => { const r: Review = { ...n, id: uuid(), delivered_version: 0, language: null, flags: [], published_text: null, published_at: null, published_by_name: null, skipped_at: null, skipped_by_name: null }; s.reviews.push(r); return { ...r } },
    patchReview: async (id, p) => { Object.assign(rv(id)!, p) },
    liveReviewsAt: async (lid) => s.reviews.filter((r) => r.location_id === lid && r.status !== 'deleted').map((r) => ({ ...r })),
    pending: async (b, limit) => s.reviews.filter((r) => r.business_id === b && r.notify && ['new', 'drafted'].includes(r.status) && r.site_id)
      .sort((a, c) => Date.parse(a.update_time) - Date.parse(c.update_time)).slice(0, limit).map((r) => ({ ...r })),
    markDelivered: async (id, v) => { const r = rv(id)!; if (r.version !== v) return; r.delivered_version = v; r.notify = false },
    openReviewsWithCards: async (b) => s.reviews.filter((r) => r.business_id === b && ['new', 'drafted'].includes(r.status) && s.cards.some((c) => c.review_id === r.id)),
    openReviewsForSites: async (b, sites, limit) => s.reviews.filter((r) => r.business_id === b && r.site_id && sites.includes(r.site_id) && ['new', 'drafted'].includes(r.status))
      .sort((a, c) => Date.parse(c.update_time) - Date.parse(a.update_time)).slice(0, limit),
    // Must stay a synchronous check-and-set (no await between read and write): the race test depends on it.
    claimPublishing: async (id, v) => { const r = rv(id); if (!r || r.version !== v || !['new', 'drafted', 'skipped'].includes(r.status)) return false; r.status = 'publishing'; return true },
    releasePublishing: async (id) => { const r = rv(id)!; if (r.status === 'publishing') r.status = 'drafted' },
    markPublished: async (id, p) => { const r = rv(id)!; if (r.status !== 'publishing') return; Object.assign(r, { status: 'published', published_text: p.text, published_at: p.at, published_by_name: p.actor.name, google_reply: p.text, google_reply_time: p.at }) },
    markSkipped: async (id, a, at) => { const r = rv(id); if (!r || !['new', 'drafted'].includes(r.status)) return false; Object.assign(r, { status: 'skipped', skipped_by_name: a.name, skipped_at: at }); return true },
    setDrafted: async (id, p) => { const r = rv(id)!; if (['new', 'skipped'].includes(r.status)) r.status = 'drafted'; if (p.language !== undefined) r.language = p.language; if (p.flags) r.flags = p.flags },
    drafts: async (rid, v) => s.drafts.filter((x) => x.review_id === rid && x.review_version === v).sort((a, b) => a.draft_version - b.draft_version),
    lastDraftVersion: async (rid) => Math.max(0, ...s.drafts.filter((x) => x.review_id === rid).map((x) => x.draft_version)),
    insertDraft: async (x) => {
      if (s.drafts.some((y) => y.review_id === x.review_id && y.review_version === x.review_version && y.draft_version === x.draft_version)) throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
      const row: Draft = { id: uuid(), review_id: x.review_id, review_version: x.review_version, draft_version: x.draft_version, text: x.text, source: x.source, author_name: x.actor?.name ?? null, created_at: NOW.toISOString() }; s.drafts.push(row); return row },
    routedGroups: async (b, site) => s.groups.filter((g) => live(g) && g.business_id === b && s.routes.some((r) => r.site_id === site && r.group_id === g.id)),
    groupSites: async (gid) => s.routes.filter((r) => r.group_id === gid).map((r) => r.site_id),
    reviewGroups: async (b) => s.groups.filter((g) => live(g) && g.business_id === b),
    deleteRoutes: async (gid) => { s.routes = s.routes.filter((r) => r.group_id !== gid) },
    cards: async (rid) => s.cards.filter((c) => c.review_id === rid).map(({ group_id: _g, ...c }) => c),
    saveCard: async (c) => { s.cards.push({ ...c }) },
    dropCard: async (c) => { s.cards = s.cards.filter((x) => !(x.chat_id === c.chat_id && x.message_id === c.message_id)) },
    migrateCards: async (o, n) => { for (const c of s.cards) if (c.chat_id === o) c.chat_id = n },
    saveEditPrompt: async (p) => { s.prompts.push({ ...p }) },
    editPrompt: async (c, m) => s.prompts.find((p) => p.chat_id === c && p.prompt_message_id === m) ?? null,
    dropEditPrompt: async (c, m) => { s.prompts = s.prompts.filter((p) => !(p.chat_id === c && p.prompt_message_id === m)) },
    reviewManagerIds: async () => s.managers,
    notify: async (rows) => { s.notes.push(...rows) },
    audit: async (a) => { s.audits.push(a) },
    logOut: async (a) => { s.logs.push(a.kind) },
    deletedBusinessConnections: async () => [],
    readToken: async (id) => s.secrets.get(id) ?? null,
    deleteToken: async (id) => { s.secrets.delete(id) },
    markRevoked: async (id) => { s.conns.find((c) => c.id === id)!.status = 'revoked' },
    cleanup: async () => {},
  }
  return { d, s }
}

export function fakeGoogle(o: { pages?: Record<string, { reviews: GReview[]; next: string | null }>; putFails?: GoogleError } = {}) {
  const calls: string[] = []
  const g: Google = {
    authUrl: () => '', exchangeCode: async () => ({ accessToken: '', refreshToken: null, scopes: [] }), refresh: async () => 'at',
    revoke: async (t) => { calls.push(`revoke ${t}`) }, email: async () => '', accounts: async () => [], locations: async () => [], canReply: async () => true,
    reviews: async (_at, _a, l, page) => { calls.push(`reviews ${l} ${page ?? '-'}`); return (o.pages ?? {})[page ?? '-'] ?? { reviews: [], next: null } },
    putReply: async (_at, a, l, id, text) => { calls.push(`put ${a}/${l}/${id} ${text}`); if (o.putFails) throw o.putFails },
  }
  return { g, calls }
}

export function fakeDrafter(replies: (string | null)[] = ['Hi Sarah, thank you for letting us know…'], flags: string[] = []) {
  const inputs: DraftInput[] = []
  let i = 0
  const draft: DraftFn = async (inp) => { inputs.push(inp); const r = replies[Math.min(i++, replies.length - 1)]; return r == null ? null : { language: 'en', flags, reply: r } }
  return { draft, inputs }
}

export function fakeCtx(init: Partial<FakeState> = {}, o: { google?: Parameters<typeof fakeGoogle>[0]; replies?: (string | null)[]; flags?: string[]; tg?: Parameters<typeof fakeTgApi>[0] } = {}) {
  const { d, s } = fakeReviewDeps(init)
  const { g, calls: gcalls } = fakeGoogle(o.google)
  const { draft, inputs } = fakeDrafter(o.replies, o.flags)
  const { api, calls } = fakeTgApi(o.tg)
  const ctx: Ctx = { d, google: g, tg: api, draft, appUrl: 'https://app.blueroll.app' }
  return { ctx, s, gcalls, inputs, calls }
}
