# Google reviews in Telegram and WhatsApp — Design Spec

**Date:** 2026-10-15 · **Status:** draft for review · **Decisions:** pending (Kostya, Maria)
Builds on the channel model of `2026-10-11-telegram-groups-design.md` and `2026-10-12-whatsapp-teams-design.md`
(groups, teams, webhooks, cron, `channel_messages_log`). Nothing in checklists changes.

## 1. Goal

A restaurant group connects its Google Business Profile **from Blueroll's web app** in a few clicks. From then on every
new or edited Google review of every restaurant arrives in the managers' Telegram group and/or WhatsApp team with a
suggested reply. A manager can publish the reply as is, edit it, ask for another version, or skip it. **Nothing is
published to Google without a person pressing a button.**

Success criteria:
- An owner connects Google and maps restaurants to sites in under five minutes, without touching Google Cloud.
- A new review reaches the chat within 20 minutes of appearing on Google.
- A manager publishes a reply in two taps; an edited reply in one message plus one tap.
- Each review is published at most once per version, and every chat showing it updates to "Published by Anna 14:02".
- Food-safety complaints (illness, allergy, foreign body) are flagged 🚨 and never get a cheerful auto-draft.
- Who drafted, edited and published each reply is recorded.

## 2. Decisions (proposed)

| Topic | Decision |
|---|---|
| How the client connects | **"Connect Google" in Settings** → Google OAuth consent under the client's own Google account (the one that owns or manages the profiles). No manual "add us as Manager" step. |
| Google API | Google Business Profile APIs: Account Management (accounts), Business Information (locations), Verifications (can we reply?), My Business v4 (reviews list + reply). Places API and scraping are not used. |
| Scope | `https://www.googleapis.com/auth/business.manage`, offline access (refresh token). |
| One connection per business | A business has at most one active Google connection. Several Google accounts per business: out of scope. |
| Restaurants ↔ sites | Each Google location is mapped to one Blueroll site (auto-suggested by postcode, then name) or left off. Only enabled, mapped locations are synced. |
| Where reviews go | Per site: any linked Telegram group with **Reviews** ticked for that site, and/or any WhatsApp team at that site with **Reviews** ticked. |
| Who may publish | Telegram: **admins of the group** (Telegram `creator`/`administrator`) — other members see the card but get "Only group admins can publish". WhatsApp: any active member of a team with Reviews on (the manager chose those people when building the team). |
| Who may set it up | New capability **`manage_reviews`** (Owner and Manager presets). Gates connecting Google, mapping and routing in RLS and in the UI (capability, not the tier text). |
| Drafts | Claude, one call per review version, returns JSON (language, flags, reply). Model in one constant in `_shared/reviews/draft.ts` (current Sonnet). |
| Publish | Two taps: **Publish** → "Publish this reply?" **Yes / Cancel** (60 s). Then `PUT …/reviews/{id}/reply`. |
| Polling vs push | Poll every 15 min (cron). Pub/Sub push (`NEW_REVIEW`, `UPDATED_REVIEW`) is phase 2. |
| History on connect | Reviews older than the connection are imported silently (`notify = false`) and shown on the web Reviews page; only reviews created or updated after connecting go to chat. |
| Subscription | Requires an active subscription (`entitlement_write_gate_*`); sync pauses while the business is not entitled. Whether it is an add-on — open question §13. |

## 3. What the client does

1. Settings → **Google reviews** → **Connect Google**. Text: "Sign in with the Google account that manages your
   restaurants on Google Maps. Blueroll will read your reviews and post replies only when your team presses Publish."
2. Google consent screen (our app "Blueroll"), the client picks the account and allows "See, edit, create and delete your
   Google business listings".
3. Back in Blueroll: list of their Google locations with address and status. Each row: **Site** select (pre-filled when
   the postcode or name matches), **Sync** toggle. Locations Google says we cannot reply to (not verified / no voice of
   merchant) show "Not verified on Google — replies are disabled" and cannot be enabled.
4. **Where to send reviews**: per site, tick existing Telegram groups and WhatsApp teams (links to create one if none).
5. **Reply style** (optional): tone (Warm / Neutral / Formal), sign-off (e.g. "— The Casa-Mia team"), things never to say,
   2–3 example replies. Defaults are fine.
6. **Save**. First sync runs at once; the page shows "Connected as name@gmail.com · 4 restaurants · last checked 14:05".

Prerequisites for the client (shown as help text): restaurants verified on Google Business Profile; the signing-in
account is Owner or Manager of them (a business group gives access to all at once).

**Disconnect**: Settings → Google reviews → Disconnect → revoke the token at Google, delete it, stop sync, remove open
cards' buttons. Imported reviews and the audit stay (deleted with the business).

## 4. Our setup (once)

- Google Cloud project for Blueroll reviews (under hello@blueroll.app), APIs enabled: My Business Account Management,
  Business Information, Verifications, Notifications (phase 2), My Business v4.
- **GBP API access request** for that project (form; default quota is 0 until approved — the critical path, start now).
- OAuth consent screen: External, app name Blueroll, homepage https://blueroll.app, privacy policy updated to mention
  Google Business Profile data, authorised redirect `https://app.blueroll.app/api/google/callback`.
- **OAuth app verification** for `business.manage` (sensitive scope): until verified, users see "Google hasn't verified
  this app" and the app is limited to 100 users. Pilot can run unverified.
- Supabase secrets: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`; Vault secret `reviews_cron_secret`.
- Anthropic key already exists (`ANTHROPIC_API_KEY`).

## 5. Connect flow (technical)

1. Web calls edge **`google-connect`** `{action:'start'}` with the user JWT. It checks `has_capability('manage_reviews')`
   in the user's business, creates `google_oauth_states` (random 32-byte `state`, business, profile, PKCE verifier,
   expires +10 min) and returns the Google auth URL (`access_type=offline`, `prompt=consent`, `include_granted_scopes=true`).
2. Google redirects to `/api/google/callback?code&state` (Next.js route) which forwards to `google-connect`
   `{action:'finish', code, state}`. The function takes the state atomically (unused, unexpired), exchanges the code,
   requires a `refresh_token` and the `business.manage` scope, reads the Google email (`openid email` added to the scopes).
3. The refresh token is stored with `vault.create_secret` → `google_connections.vault_secret_id`. Any previous active
   connection of the business is revoked and replaced. Access tokens live only in memory inside edge functions.
4. Lists accounts → locations (`readMask=name,title,storefrontAddress,metadata`) → `getVoiceOfMerchantState` for each,
   upserts `google_locations`, auto-suggests `site_id`, redirects to Settings → Google reviews.

Errors back to the page as plain text: consent denied, no business accounts, no locations, missing scope ("Tick the
box that lets Blueroll manage your listings"). `invalid_grant` later (password change, access removed) → connection
`status='error'`, sync stops, app notification to `manage_reviews` holders and one message to each reviews chat:
"Google disconnected — reconnect in Settings → Google reviews."

## 6. Sync (cron)

Edge **`google-reviews-sync`**, pg_cron every 15 min, `x-cron-secret`. For each active, entitled connection:

1. Refresh the access token once.
2. For each enabled, mapped location: `GET accounts/{a}/locations/{l}/reviews?orderBy=updateTime desc&pageSize=50`,
   page until `updateTime <= last_review_update_time`. Store the max seen.
3. Upsert `reviews` by `google_review_name`:
   - new → insert, `notify = created after connected_at`;
   - `updateTime` changed and the **review text or stars** changed → new version (`version + 1`), status back to `new`;
   - the reply changed and it is not the one we published → `status='answered_elsewhere'`, update all cards
     ("Answered on Google"), no buttons.
   - a review we had that is gone from Google → `status='deleted'` on the next full pass (daily) or on 404 at publish.
4. For each review needing a draft → draft (§7) → send cards (§8). A review with an existing Google reply and no change
   is never sent.

Limits: at most 50 new cards per business per run (rest next run) so a first big import cannot flood a group.

## 7. Drafting

`_shared/reviews/draft.ts` — one Claude call with: business and site name, star rating, review text, reviewer first
name, the business reply style (§3.5), previous published reply if this is an edited review. Output JSON:

```json
{ "language": "en", "flags": ["food_safety"], "reply": "…" }
```

Rules in the prompt: reply in the review's language; ≤ 120 words (≤ 40 for a rating with no text); thank, address
specific points, no promises of refunds or compensation, never admit legal liability, never mention health/medical
details or the guest's personal data, no emoji unless the style allows, sign-off from settings.

Flags: `food_safety` (illness, food poisoning), `allergy`, `foreign_object`, `hygiene`, `discrimination`,
`legal_threat`, `staff_named`. Any of the first four → card marked **🚨 Food safety complaint**, the draft is the cautious
template ("We're sorry… we take this very seriously… please contact us at … so we can look into it") and the card has a
link **Log as complaint** (opens Incidents in the web app, pre-filled, site set). Flags are stored on the review.

**Another version** = same call with "different wording from: …", at most 5 per review version. Invalid JSON or API
failure → card goes out with "Couldn't draft a reply — tap Edit to write one" (no Publish button until there is text).

## 8. Telegram

Same bot as checklists (@BluerollChecksBot) and the same webhook; a group already linked to the business gets a
**Reviews** tick per site in Settings → Messaging → Telegram groups. Privacy mode stays on: the bot receives commands,
callback queries and **replies to its own messages**, which is all it needs.

Card (HTML, escaped):

```
⭐⭐☆☆☆  Casa-Mia Wharf Side · Google
“Waited 40 minutes for mains, pasta was cold…” — Sarah K., 14:02

Suggested reply:
Hi Sarah, thank you for letting us know…

[ ✅ Publish ] [ ✏️ Edit ]
[ 🔄 Another ] [ ✖️ Skip ]
```

- Review text over 1 500 characters is clipped with "… (full text on Google)" and a link to the review.
- `callback_data`: `rv:<action>:<review_id>:<draft_version>` (fits 64 bytes); a press for an old draft version →
  "This reply changed — use the latest card".
- **Who may press**: `getChatMember` → `creator`/`administrator` only; others get the alert "Only group admins can
  publish or edit replies". (Skip is admin-only too.)
- **Publish** → card buttons become `[ Yes, publish ] [ Cancel ]`; Yes within 60 s → publish (§10) → card text ends with
  "✅ Published by Anna · 14:07", buttons removed.
- **Edit** → bot sends "Reply to this message with the new text for Sarah K.'s review" with `force_reply` +
  `selective`; the admin's reply becomes draft version n+1 (source `edited`, author recorded), the card is edited to
  show it and the bot deletes its prompt and the admin's message (best effort). A reply from a non-admin is ignored with
  a short note.
- **Another** → new AI draft, card edited.
- **Skip** → "Skipped by Anna", buttons removed. Still available on the web page.
- `answerCallbackQuery` on every press (spinner off), errors as alert text.

## 9. WhatsApp

A WhatsApp team at the site gets a **Reviews** tick; each active member gets the card 1:1 (WhatsApp has no bot groups).

- Outside the member's 24 h window: approved template **`review_new`** — "New ⭐{{1}} review for {{2}}: “{{3}}”" with
  quick-reply button **Open**. Tapping it opens the window and the bot sends the full card.
- Inside the window: interactive message (body ≤ 1 024 chars: stars, site, clipped review, draft) with reply buttons
  **Publish · Edit · More** (max 3); **More** → list message **Another version · Skip · Open on Google**.
- **Edit** → "Send the new reply as your next message (15 min)". A pending edit is stored per identity
  (`review_edit_sessions`); the next text message from that number becomes draft n+1 and the card is resent.
- **Publish** → "Publish this reply?" **Yes / Cancel**.
- After publish/skip/answered elsewhere, every other member who got the card receives one short line
  ("✅ Sarah K.'s review was answered by Anna") — inside their window only, never a paid template.
- Billing follows `service-window.ts`; each send is logged in `channel_messages_log` with `kind` `review_*`.

## 10. Publish

Shared `_shared/reviews/publish.ts`, used by Telegram, WhatsApp and the web page:

1. Atomic claim: `update reviews set status='publishing', publishing_by=… where id=… and version=… and status in
   ('new','drafted')` — the loser gets "Already published by Anna".
2. Connection still active, location still enabled, business entitled; otherwise release and explain.
3. `PUT accounts/{a}/locations/{l}/reviews/{r}/reply {comment}` (≤ 4 096 chars).
4. Success → `status='published'`, `published_text`, `published_at`, `published_by_*`; audit row; update every card.
   404 → `status='deleted'`, cards "This review was removed from Google". 401/`invalid_grant` → connection error (§5),
   release. Other errors → release to `drafted`, card note "Couldn't publish — try again", audit `publish_failed`.

An edited review (`UPDATED_REVIEW`) gets a new card; publishing overwrites the reply on Google.

## 11. Web

- **Settings → Google reviews** (`manage_reviews`): connect/disconnect, status, locations ↔ sites, routing, reply
  style (§3).
- **Reviews page** `src/app/(dashboard)/reviews/`: list per site (filters: needs reply / published / skipped / 🚨),
  same actions as the chat card with a full-size editor. Visible to `manage_reviews`; read for anyone who can see the
  site. Fallback for long reviews and for businesses without chat channels.

## 12. Data

All tables have `business_id`, RLS: read for `manage_reviews` holders in the business (reviews also for site
viewers via `can_see_site_row`), writes only through edge functions (service role) except the settings listed.

- `google_connections`: `id`, `business_id`, `google_email`, `vault_secret_id` (never exposed — column revoked from
  `authenticated`), `scopes text[]`, `status` (`active`/`error`/`revoked`), `last_error`, `connected_by`,
  `connected_at`, `last_sync_at`, `revoked_at`. Unique active per business.
- `google_oauth_states`: `state` PK, `business_id`, `profile_id`, `code_verifier`, `expires_at`, `used_at`. Service role.
- `google_locations`: `id`, `connection_id` (cascade), `business_id`, `gbp_account`, `gbp_location` (unique per
  connection), `title`, `address`, `postcode`, `can_reply bool`, `site_id` null (FK sites, set null),
  `enabled bool default false`, `last_review_update_time`. Client may update `site_id`, `enabled`.
- `review_routes`: (`site_id`, `group_id` → `channel_groups`) PK. Client insert/delete with `manage_reviews` and same
  business. Telegram: group linked; WhatsApp: team at that site.
- `review_settings`: `business_id` PK, `tone`, `sign_off`, `avoid text`, `examples text[]`. Client upsert.
- `reviews`: `id`, `business_id`, `location_id`, `site_id`, `google_review_name` unique, `version int`, `stars 1–5`,
  `comment`, `reviewer_name`, `review_url`, `create_time`, `update_time`, `google_reply`, `google_reply_time`,
  `language`, `flags text[]`, `notify bool`, `status` (`new`, `drafted`, `publishing`, `published`, `skipped`,
  `answered_elsewhere`, `deleted`) with `CHECK`, `published_text`, `published_at`, `published_by_profile`,
  `published_by_channel_name`.
- `review_drafts`: `id`, `review_id` (cascade), `review_version`, `draft_version`, `text`, `source` (`ai`/`edited`),
  `author_profile` / `author_channel` + `author_external_id` + `author_name`, `created_at`.
- `review_cards`: `review_id`, `channel`, `chat_id` or `identity_id`, `message_id`, `sent_at` — to edit every card.
- `review_edit_sessions`: WhatsApp pending edit per identity (`expires_at` +15 min).
- `review_audit`: `review_id`, `action` (`imported`, `drafted`, `regenerated`, `edited`, `published`, `skipped`,
  `publish_failed`, `answered_elsewhere`, `deleted`), actor columns as above, `at`, `details jsonb`. Kept 24 months.
- `capability_catalog` + `seed_business_roles()` + `PRESET_CAPS`: add `manage_reviews` to Owner and Manager; backfill
  existing Owner/Manager preset roles.
- Business deletion: everything cascades from `businesses`; the purge job also revokes the Google token and deletes the
  Vault secret (`google-connect {action:'revoke'}`).

## 13. Open questions

1. Paid add-on or part of the plan? (Affects the entitlement check and the pricing page.)
2. Telegram publish rights = group admins (proposed) vs any group member vs only people linked to a Blueroll profile
   with `manage_reviews`.
3. Is the two-tap confirm wanted, or one tap on Publish?
4. Auto-publish for 5★ reviews with no text (opt-in per business)? Proposed: not in v1.
5. Separate Google Cloud project or reuse `tactile-reason-492410-d0`?
6. A separate "Blueroll Reviews" Telegram bot, or reuse @BluerollChecksBot (proposed)?

## 14. Testing

- OAuth: state reuse/expiry, PKCE, missing refresh token, missing scope, reconnect replaces, disconnect revokes,
  `invalid_grant` → error + notices. Mock Google endpoints.
- Location mapping: postcode/name suggestion, `can_reply=false` cannot be enabled, cross-business site rejected (RLS).
- Sync: new / edited text / edited stars / reply added on Google / deleted / historic import silent / paging stop /
  50-card cap / not entitled → skipped.
- Draft: JSON parsing, flags → 🚨 + cautious draft, language, length, regeneration cap, API failure path.
- Telegram: card render + escaping + clipping, callback parsing, stale draft version, non-admin press, confirm timeout,
  force-reply edit from admin and non-admin, card updates in several groups.
- WhatsApp: template vs in-window card, More list, edit session timeout, others notified only in window.
- Publish: race (two admins), 404, 401, 5xx release, audit rows.
- Pilot: Fern & Fig with one real Google location, Telegram "Managers" group and Kostya's WhatsApp; leave a test review,
  publish from Telegram, edit from WhatsApp, reply directly on Google and see the cards update.

## 15. Phases

1. **v1**: connect + mapping + routing + sync (poll) + drafts + Telegram cards + publish + Reviews page (read + actions).
2. **v1.1**: WhatsApp cards (needs the `review_new` template approved by Meta).
3. **v2**: Pub/Sub push, weekly summary per site (average rating, unanswered count), auto-publish rules, incident link
   pre-fill, mobile app view.

## 16. Out of scope

Other review sites (Tripadvisor, Deliveroo, Just Eat), several Google accounts per business, answering Google Q&A,
reporting reviews to Google, sentiment analytics.
