// supabase/functions/_shared/reviews/types.ts
// Google reviews (spec 2026-10-15 §12): row shapes shared by sync, drafting, cards, publish, the bot and the web API.
export type ReviewStatus = 'new' | 'drafted' | 'publishing' | 'published' | 'skipped' | 'answered_elsewhere' | 'deleted'
/** A reply can still be published from these (web may publish a skipped review, spec §8 "Still available on the web page"). */
export const PUBLISHABLE: ReviewStatus[] = ['new', 'drafted', 'skipped']
export const NEEDS_REPLY: ReviewStatus[] = ['new', 'drafted']
export type ConnectionStatus = 'active' | 'error' | 'revoked'

export interface Connection {
  id: string; business_id: string; google_email: string; vault_secret_id: string | null
  status: ConnectionStatus; connected_at: string; last_sync_at: string | null
}
export interface Location {
  id: string; connection_id: string; business_id: string; gbp_account: string; gbp_location: string
  title: string; address: string; postcode: string; maps_uri: string | null; can_reply: boolean
  site_id: string | null; enabled: boolean; enabled_at: string | null
  last_review_update_time: string | null; last_full_pass_at: string | null
}
export interface Review {
  id: string; business_id: string; location_id: string | null; site_id: string | null
  google_review_id: string; version: number; delivered_version: number; stars: number; comment: string
  reviewer_name: string; create_time: string; update_time: string
  google_reply: string | null; google_reply_time: string | null
  language: string | null; flags: string[]; notify: boolean; status: ReviewStatus
  published_text: string | null; published_at: string | null; published_by_name: string | null
  skipped_at: string | null; skipped_by_name: string | null
}
export type NewReview = Omit<Review, 'id' | 'delivered_version' | 'language' | 'flags' | 'published_text' | 'published_at' | 'published_by_name' | 'skipped_at' | 'skipped_by_name'>
export interface Draft {
  id: string; review_id: string; review_version: number; draft_version: number; text: string
  source: 'ai' | 'edited'; author_name: string | null; created_at: string
}
export type Tone = 'warm' | 'neutral' | 'formal'
export interface ReviewSettings { tone: Tone; sign_off: string; avoid: string; contact: string; examples: string[] }
export const DEFAULT_SETTINGS: ReviewSettings = { tone: 'warm', sign_off: '', avoid: '', contact: '', examples: [] }
/** Who acted. Telegram: external_id = Telegram user id (stored, never logged). Web: profile_id. Cron: 'system'. */
export interface Actor { channel: 'telegram' | 'web' | 'system'; profile_id: string | null; external_id: string | null; name: string }
export const SYSTEM: Actor = { channel: 'system', profile_id: null, external_id: null, name: 'Blueroll' }
export type AuditAction = 'imported' | 'drafted' | 'regenerated' | 'edited' | 'published' | 'skipped' | 'publish_failed' | 'answered_elsewhere' | 'deleted'
export interface AuditRow { review_id: string; business_id: string; action: AuditAction; actor: Actor; details?: Record<string, unknown> }
export interface ReviewCard { review_id: string; chat_id: string; message_id: string }
export interface SiteLite { id: string; name: string; timezone: string; postcode: string }
export interface RouteGroup { id: string; business_id: string; chat_id: string }
export interface EditPrompt {
  chat_id: string; prompt_message_id: string; card_message_id: string; review_id: string; review_version: number
  user_id: string; expires_at: string
}
