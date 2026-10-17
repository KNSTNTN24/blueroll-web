# Google reviews in Telegram

> A business connects its Google Business Profile once; new reviews are fetched every 15 minutes, an AI drafts a reply,
> and a card in a linked Telegram reviews group lets staff publish it on Google in two taps (Publish, then Confirm).

**Touches:** [Business](../entities/business.md), [Site](../entities/site.md), [Roles and capabilities](roles-and-capabilities.md) (`manage_reviews`),
[Channels](channels.md) (`telegram_reviews` is a third channel value), [Incident](../entities/incident-and-notification.md) (complaint link),
[Subscription and entitlement](subscription-and-entitlement.md) (sync and publishing stop when unpaid) ·
**Last verified:** 2026-10-15 against branch `claude/restaurant-reviews-bot-iquz2t@76b4745` (not yet in production — migrations not applied)

## The rule in plain words

```
connect Google (OAuth, owner/manager with manage_reviews)
  -> map each Google location to a site and switch it on
  -> route each site to one or more Telegram reviews groups
  -> every 15 min: import new/changed reviews, draft a reply, post a card to the routed groups
  -> in the group: Publish -> Confirm (within 60 s) -> the reply goes to Google
```

| Question | Answer |
|---|---|
| Who sets it up | Anyone holding `manage_reviews` (Owner and Manager presets). Settings → Google reviews (`src/app/(dashboard)/settings/google-reviews.tsx`). |
| Who can publish | **Anyone in a linked Telegram reviews group** (Gotcha 4). Web: members with `manage_reviews` on `/reviews`. |
| What counts as "new" | Reviews updated after the location's `enabled_at` (or the connection's `connected_at` when it is empty). Older ones are imported silently (`notify = false`). |
| Languages | The AI replies in the reviewer's language. The cautious food-safety template is English only (Gotcha 3). |
| Cost to the customer | None per switch. Needs an entitled business (`channel_ready(b,'telegram_reviews')` is true for any entitled business). |
| Not in v1 | WhatsApp delivery (v1.1); incident pre-fill (v2). |

## Tables

All created in `supabase/migrations/20261015120000_google_reviews.sql`. The cron job is in `20261015120100_google_reviews_cron.sql`.
"Edge" means the service role writing from an edge function.

| Table | Holds | Key columns / rules | Written by |
|---|---|---|---|
| `google_connections` | One Google login per business | `google_email`, `vault_secret_id` (refresh token lives in Vault, never in the table), `scopes`, `status` `active`/`error`/`revoked`, `last_error`, `connected_by`, `connected_at`, `last_sync_at`, `revoked_at`. One live row per business (`uq_google_connection_live`). Clients read safe columns only (no `vault_secret_id`). | Edge (`google-connect`, sync) |
| `google_oauth_states` | Single-use OAuth state | `state`, `code_verifier` (PKCE), `profile_id`, `expires_at` (+10 min, `connect.ts:31`), `used_at`. No client access. | Edge |
| `google_locations` | Google locations found for the connection | `gbp_account`, `gbp_location`, `title`, `address`, `postcode`, `can_reply` (Voice of Merchant verified), `site_id`, `enabled`, `enabled_at`, sync cursor `last_review_update_time`, `last_full_pass_at`. Trigger `guard_google_locations_update` lets clients change only `site_id` and `enabled`, and refuses `enabled` when `can_reply` is false or no site is chosen; it stamps `enabled_at` whenever `enabled` turns on. | Edge; clients: `site_id`, `enabled` |
| `review_routes` | Which site posts to which reviews group | PK (`site_id`, `group_id`). Insert allowed only for a live site and a linked `telegram_reviews` group of the same business. | Clients (managers) |
| `review_settings` | Reply style per business | `tone` warm/neutral/formal, `sign_off` (≤ 120), `avoid` (≤ 1000), `contact` (≤ 200), `examples` (≤ 3). | Clients (managers) |
| `reviews` | One Google review | Unique (`business_id`, `google_review_id`). `version` bumps when the guest edits stars/comment; `delivered_version` is the version last sent; `notify` = still to be sent; `status` `new`/`drafted`/`publishing`/`published`/`skipped`/`answered_elsewhere`/`deleted`; `flags` (`food_safety`, `allergy`, `foreign_object`, `hygiene`, `discrimination`, `legal_threat`, `staff_named`); `publishing_by/at` (the claim); `published_text/at/by_*`. Readable by `manage_reviews` holders and by members who can see the site. | Edge |
| `review_drafts` | Drafts of the reply | Unique (`review_id`, `review_version`, `draft_version`); `text` ≤ 4000; `source` `ai`/`edited`; author columns. `author_external_id` is not readable by clients. | Edge |
| `review_cards` | Telegram messages showing a review | PK (`chat_id`, `message_id`), `group_id`. Used to refresh or retire cards. No client access. | Edge |
| `review_edit_prompts` | Pending Telegram "Edit" force-replies | PK (`chat_id`, `prompt_message_id`), `user_id` (who may answer), `expires_at` (+15 min). **Telegram only** (Gotcha 7). No client access. | Edge |
| `review_audit` | Who did what | `action` imported/drafted/regenerated/edited/published/skipped/publish_failed/answered_elsewhere/deleted, actor profile or channel + name, `details`. Managers read. | Edge |

Telegram reviews groups reuse `channel_groups` (`channel = 'telegram_reviews'`) and `channel_group_link_codes`; the reviews bot is
`@BluerollReviewsBot` (`tg-reviews-bot.ts:15`), a separate bot from the checklist bot. Vault wrappers `reviews_store_token`,
`reviews_read_token`, `reviews_delete_token` are service-role only.

## How it works

1. **Connect.** `start` stores a single-use state with a PKCE verifier and returns Google's consent URL (`_shared/reviews/connect.ts:88-94`);
   the browser keeps the state in the cookie `g_oauth_state` (`Path=/api/google`, 10 min, `src/lib/reviews/oauth-state.ts`).
   Google redirects to `src/app/api/google/callback/route.ts`, which forwards `code` + `state` to the edge function `google-connect` only
   when the state matches that cookie (else `google_error=expired`), always clears the cookie, and sends the browser back to Settings with
   `google=connected` or `google_error=<reason>`. `finish` (`connect.ts:96-150`) re-checks that the person who started still holds
   `manage_reviews` in an entitled business (`stillAllowed`, else `denied`), checks the scope, requires a refresh token, lists accounts and
   locations (with Voice of Merchant verification), stores the token in Vault, inserts the connection, upserts the locations and re-points
   older reviews to them (`repointReviews`). A suggested site is pre-selected by postcode or name (`match.ts:14`). Settings then runs a sync
   at once (also when a restaurant's Sync is switched on).
2. **Map and switch on.** In Settings the manager picks a site per location and turns it on (guard trigger above), then adds routes
   from sites to reviews groups. **Check Google again** (`connect.ts:152-160`) re-lists locations after a verification change.
3. **Link a reviews group.** The manager gets a 6-digit code (`issue_group_link_code('telegram_reviews')`, needs `manage_reviews`), adds the bot
   to the group and sends `/link <code>` (`tg-reviews-bot.ts:117`). 5 wrong codes per chat per hour lock it (`MAX_LINK_FAILURES`, `tg-reviews-bot.ts:19`).
   The bot warns the group and managers when "Add members" is on (`checkReviewGroupPermissions`, `tg-reviews-bot.ts:100`).
4. **Sync, every 15 minutes** (cron `google-reviews-sync`, `x-cron-secret` from vault `reviews_cron_secret`). `runSync` → `syncConnection`
   (`_shared/reviews/sync.ts:121-153`): skip unentitled businesses; get an access token; for each enabled location with a site and
   `can_reply`, page through reviews newest first until the stored cursor (`syncLocation`, `sync.ts:69-113`). First pass reads up to
   `PAGES_FIRST = 10` pages, later passes up to `PAGES_MAX = 20` (`sync.ts:11-12`). `reconcile` (`sync.ts:26-51`) decides per review:
   insert, new version (guest edited stars/comment), patch (reply changed), or nothing.
5. **Draft.** `makeDraft` (`actions.ts:38`) asks Claude (`DRAFT_MODEL`, `draft.ts:10`) for a reply, the language and safety flags as JSON via
   structured outputs (`output_config.format`, effort `low`; this model rejects a forced `tool_choice`). Refusals and `max_tokens` stops count as a failed draft. A reply
   mentioning illness, allergy, a foreign object or hygiene is replaced by a short cautious apology that asks the guest to make contact
   (`cautiousReply`, `draft.ts:84`). At most 6 AI drafts per review version (`MAX_AI_DRAFTS`).
6. **Deliver.** `deliverReview` (`actions.ts:88-112`) first **claims** the version (`claimDelivery`: `notify` true → false, so overlapping
   syncs send one set of cards), posts a card to every group routed from the review's site (removed sites get none) and records
   `delivered_version` (`markDelivered`). At most 50 cards per connection per run (`CARDS_PER_RUN`).
7. **Publish.** Tap Publish, then Confirm within 60 s (`CONFIRM_WINDOW_SEC`, `card.ts:32`). `publishReview` (`publish.ts:13-58`) checks the
   draft is still the latest, the location and connection are live and the business is entitled, then **claims** the review
   (`status = 'publishing'`), PUTs the reply to Google and records it. Other buttons: Regenerate, Edit (force-reply, 15 min), Skip.
   The web page `/reviews` (`src/app/(dashboard)/reviews/page.tsx`) offers the same actions through `reviews-action`.
8. **Housekeeping** (`sync.ts:156`): releases stale claims, revokes and deletes tokens of deleted businesses, cleans old rows.
9. **Disconnect** (`connect.ts:152-170`) revokes the grant at Google, deletes the Vault secret, marks the connection revoked and removes
   buttons from open cards. Imported reviews stay. A Google error on revoke is logged and ignored; marking revoked and refreshing the cards
   always happen, even if the Vault delete fails.

### Behaviour worth knowing (decisions taken during the build)

- **Draft numbers only go up per review.** `draft_version` continues across review versions (`lastDraftVersion`, `actions.ts:51`), so an
  old card's Publish button can never match a newer draft it was not shown.
- **Delivery is retried only if every routed group failed transiently** (`setNotify` re-arms it, `actions.ts:105`; also when delivery throws). If one group got the card and another failed,
  the failed one is not retried; the review is still on `/pending` in Telegram and on the web page.
- **A claim is never released after Google accepted the reply.** `publishReview` releases only its own claim on errors before the PUT; after a
  successful PUT it retries the database record once and then only logs (`publish.ts:48-54`). If the function crashes between claim and PUT,
  housekeeping returns reviews stuck in `publishing` for more than 5 minutes to `drafted` (`STALE_PUBLISHING_MS`, `sync.ts:14`).
- **A failed import keeps the cursor.** If any review in a run fails to save, the location's cursor does not move (`sync.ts:113`); the next
  run re-reads the same pages. One bad review therefore makes each run re-read up to `PAGES_MAX` pages until the daily full pass or a fix.
- **Page cap.** If 20 pages pass without reaching the cursor, the cursor still advances and `reviews page cap hit` is logged (`sync.ts:102-104`);
  the daily full pass fills the gap. This needs more than 1000 updates in 15 minutes at one location.
- **Reconnecting and abandoned attempts.** Google's revoke kills the whole grant for that login, so an abandoned or failed connect attempt
  revokes at Google only when the business has no live connection (`connect.ts:96-99`). Storage order on reconnect: store new token, mark the
  old connection revoked, insert the new one, delete the old token, upsert locations (`connect.ts:113-136`). If the insert fails the old
  connection stays revoked and the user reconnects; if only the locations fail, the connection is kept and "Check Google again" recovers them
  (it also re-points reviews). A reconnect carries each location's site, Sync switch, `enabled_at` and both cursors from its newest earlier
  row (`previousMapping`, `toRows` `connect.ts:73-86`), so sync continues and reviews that arrived while disconnected are still delivered.
- **"Check Google again" fails with 502** if Voice of Merchant errors for any location (`connect.ts:157`); nothing is partly saved. Retry.
- **Timeouts.** Every Google call times out after 20 s (`GOOGLE_TIMEOUT_MS`, `google.ts:16`); drafting after 30 s (`DRAFT_TIMEOUT_MS`, `draft.ts:17`).
  A missing access token in Google's reply is a `server` error, not "disconnected". A drafting failure shows "Couldn't draft" on the card.

## Terms

| Term | Meaning | Where it lives |
|---|---|---|
| Location | One Google Business Profile place, mapped to at most one site | `google_locations` |
| Voice of Merchant (VoM) | Google's "verified, may manage" status; `can_reply` is false without it | `google.ts`, `connect.ts:51` |
| Reviews group | A Telegram group linked with `channel = 'telegram_reviews'` | `channel_groups` |
| Route | Site → reviews group delivery rule | `review_routes` |
| Card | The Telegram message for one review, with buttons | `review_cards`, `card.ts` |
| Claim | `status = 'publishing'` with `publishing_by/at`, taken before the PUT so two taps cannot both publish | `reviews`, `publish.ts` |
| Cursor | Newest `updateTime` already seen at a location | `google_locations.last_review_update_time` |
| Full pass | Daily complete listing (≤ 20 pages) that also detects deletions | `last_full_pass_at`, `sync.ts:72` |

## Where it is enforced

| Layer | What is checked | Location |
|---|---|---|
| Database | `can_manage_reviews(b)` (active member + `has_capability('manage_reviews')`) on all review tables, location guard trigger, routes insert rule, write gates for unentitled businesses, safe-column grants | migration `20261015120000_google_reviews.sql` |
| Edge functions | Owner/manager JWT (`google-connect`, `reviews-action`), Telegram secret header (`telegram-reviews-webhook`), cron secret (`google-reviews-sync`), single-use OAuth state bound to the browser by cookie + `stillAllowed` re-check in `finish`, entitlement (`ready`) on every bot command, button press and edit reply | `supabase/functions/{google-connect,reviews-action,telegram-reviews-webhook,google-reviews-sync}/index.ts`, `_shared/reviews/*` |
| Web UI | Settings → Google reviews; `/reviews` list; OAuth callback | `settings/google-reviews.tsx`, `reviews/page.tsx`, `src/app/api/google/callback/route.ts`, `src/lib/reviews/*` |
| Mobile | nothing | — |

## Gotchas

1. **Reconnecting never revokes at Google.** Google's revoke ends the whole grant for that login, which would also kill the working
   token. Reconnect and abandoned attempts therefore only replace or drop Blueroll's own copy (`connect.ts:96-99,118`). Only Disconnect
   (and deleting the business) revokes. An abandoned grant from a different Google account stays in that user's Google "third-party access" list until they remove it.
2. **`notify` counts from the location's `enabled_at` (else `connected_at`); delivery clears `notify`.** Reviews older than that are imported
   silently, so switching a location on later does not flood the group with old reviews (`reconcile`, `sync.ts:29`). The location start wins even
   when it is earlier than `connected_at`: after a reconnect (which carries `enabled_at`), reviews from the outage are still sent — a long outage
   can mean many cards (50 per run). `claimDelivery` sets `notify = false`; a new review version sets it again if the new version is fresh.
3. **The cautious food-safety template is English only** (`cautiousReply`, `draft.ts:84`). The AI draft follows the reviewer's language; the safety fallback does not.
4. **A Telegram reviews group is the security boundary.** Anyone in the group can publish a reply under the business's name. Only a warning protects it
   ("Add members" on, `tg-reviews-bot.ts:32,100`). Treat the group as a staff-only space.
5. **Old cards of an edited review are retired, not updated.** When the guest edits their review (new `version`), the old cards lose their buttons
   (`retireCards`, `sync.ts:63`) and a fresh card is sent.
6. **Deleted-on-Google is detected late.** Only the daily full pass (≤ 20 pages, `sync.ts:105-111`) or a 404 at publish (`publish.ts:35`) marks a review `deleted`.
7. **WhatsApp is v1.1.** `review_edit_prompts` is Telegram-only; there is no WhatsApp reviews channel yet.
8. **Incident pre-fill is v2.** "Log as complaint" on a food-safety review only opens `/incidents?site=…&review=…` (`reviews/page.tsx:92`); nothing on the incidents page reads the `site` or `review` parameters yet.
9. **OAuth state is bound to the browser by a cookie.** The callback route has no server-side session (the Supabase session lives in local
   storage), so `startGoogleConnect` sets `g_oauth_state` and the callback refuses a state that does not match it (`google_error=expired`).
   A consent opened in another browser therefore fails; start again from Settings in the same browser.
10. **Dependent on external setup.** Needs a Google Cloud OAuth client with the Business Profile APIs approved, the reviews bot token and webhook, and the Vault
    secret `reviews_cron_secret`. None of this is applied in production yet.

## History

- 2026-10-15 Google reviews v1 (`docs/superpowers/specs/2026-10-15-google-reviews-design.md`, plan `docs/superpowers/plans/2026-10-15-google-reviews.md`,
  migrations `20261015120000_google_reviews.sql`, `20261015120100_google_reviews_cron.sql`; branch `claude/restaurant-reviews-bot-iquz2t`).
