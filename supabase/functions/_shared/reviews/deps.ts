// supabase/functions/_shared/reviews/deps.ts
// The data contract for everything under _shared/reviews except the connect flow (ConnectDeps, connect.ts).
// reviews-db.ts implements it over Supabase; tests use src/lib/reviews/__tests__/fakes/review-deps.ts.
import type { TgApi } from '../channels/telegram.ts'
import type { DraftFn } from './draft.ts'
import type { Google } from './google.ts'
import type {
  Actor, AuditRow, Connection, Draft, EditPrompt, Location, NewReview, Review, ReviewCard, ReviewSettings, RouteGroup, SiteLite,
} from './types.ts'

export interface ReviewDeps {
  now(): Date
  entitled(b: string): Promise<boolean>
  businessName(b: string): Promise<string>
  settings(b: string): Promise<ReviewSettings>
  site(id: string): Promise<SiteLite | null>

  activeConnections(): Promise<Connection[]>
  activeConnection(b: string): Promise<Connection | null>
  /** Fresh access token for the connection (cached per run). Throws GoogleError('invalid_grant') when the grant is gone. */
  accessToken(conn: Connection): Promise<string>
  /** active → error with the message. Returns true only for the call that changed it (notices go out once). */
  connectionFailed(conn: Connection, message: string): Promise<boolean>
  touchConnection(id: string, now: Date): Promise<void>
  location(id: string): Promise<Location | null>
  enabledLocations(connectionId: string): Promise<Location[]>
  saveCursor(locationId: string, p: { last_review_update_time?: string | null; last_full_pass_at?: string }): Promise<void>

  review(id: string): Promise<Review | null>
  reviewsByGoogleId(b: string, ids: string[]): Promise<Map<string, Review>>
  insertReview(r: NewReview): Promise<Review>
  patchReview(id: string, patch: Partial<Review>): Promise<void>
  /** Reviews at a location that are not 'deleted'. */
  liveReviewsAt(locationId: string): Promise<Review[]>
  /** notify && status in (new, drafted) && site_id not null — oldest update first (delivered_version is advisory). */
  pending(b: string, limit: number): Promise<Review[]>
  /** delivered_version = version, notify = false — only while the review is still at that version. */
  markDelivered(id: string, version: number): Promise<void>
  /** new/drafted reviews of the business that have at least one card. */
  openReviewsWithCards(b: string): Promise<Review[]>
  /** new/drafted reviews at these sites, newest update first. */
  openReviewsForSites(b: string, siteIds: string[], limit: number): Promise<Review[]>
  /** Atomic: status new|drafted|skipped and version = v → publishing. */
  claimPublishing(id: string, version: number, actor: Actor): Promise<boolean>
  /** publishing → drafted. */
  releasePublishing(id: string): Promise<void>
  /** publishing → published; also stores google_reply = text so the next sync sees no change. */
  markPublished(id: string, p: { text: string; at: string; actor: Actor }): Promise<void>
  /** new|drafted → skipped. Returns whether it applied. */
  markSkipped(id: string, actor: Actor, at: string): Promise<boolean>
  /** new|skipped → drafted (drafted stays); sets language/flags when given. */
  setDrafted(id: string, p: { language?: string | null; flags?: string[] }): Promise<void>

  /** Drafts of one review version, ascending draft_version. */
  drafts(reviewId: string, reviewVersion: number): Promise<Draft[]>
  /** Highest draft_version over all versions of the review, 0 if none (draft numbers are monotonic across review versions). */
  lastDraftVersion(reviewId: string): Promise<number>
  /** Throws an Error with code '23505' when (review_id, review_version, draft_version) already exists (unique constraint). */
  insertDraft(d: { review_id: string; review_version: number; draft_version: number; text: string; source: 'ai' | 'edited'; actor: Actor | null }): Promise<Draft>

  /** Linked telegram_reviews groups of business b routed to the site. */
  routedGroups(b: string, siteId: string): Promise<RouteGroup[]>
  groupSites(groupId: string): Promise<string[]>
  reviewGroups(b: string): Promise<RouteGroup[]>
  deleteRoutes(groupId: string): Promise<void>
  cards(reviewId: string): Promise<ReviewCard[]>
  saveCard(c: ReviewCard & { group_id: string }): Promise<void>
  dropCard(c: ReviewCard): Promise<void>
  migrateCards(oldChatId: string, newChatId: string): Promise<void>
  saveEditPrompt(p: EditPrompt): Promise<void>
  editPrompt(chatId: string, promptMessageId: string): Promise<EditPrompt | null>
  dropEditPrompt(chatId: string, promptMessageId: string): Promise<void>

  reviewManagerIds(b: string): Promise<string[]>
  notify(rows: { user_id: string; title: string; message: string; link: string }[]): Promise<void>
  audit(a: AuditRow): Promise<void>
  logOut(a: { business_id: string; site_id: string | null; kind: string; ref_id: string }): Promise<void>

  deletedBusinessConnections(): Promise<Connection[]>
  readToken(secretId: string): Promise<string | null>
  deleteToken(secretId: string): Promise<void>
  markRevoked(id: string, now: Date): Promise<void>
  /** Expired OAuth states and edit prompts; audit rows older than 24 months. */
  cleanup(now: Date): Promise<void>
}

export interface Ctx { d: ReviewDeps; google: Google; tg: TgApi; draft: DraftFn; appUrl: string }
