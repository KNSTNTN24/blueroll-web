# Telegram checklists (MVP) — Design Spec

**Date:** 2026-10-10 · **Status:** draft for review · **Decisions:** Kostya (10.10.2026)
**Builds on:** `2026-10-09-whatsapp-checklists-design.md` (channel-agnostic core, data model, conversations). Everything not stated here follows that spec.

## 1. Goal

Same as the WhatsApp MVP — staff complete temperature and opening/closing checks without the app and without a login — delivered first via **Telegram**, because it needs no Meta verification, has no per-message cost and no template approval.

Success criteria: as in the WhatsApp spec; plus the form is completed in one screen with corrective actions inline.

## 2. Decisions

| Topic | Decision |
|---|---|
| Form UX | **Telegram Mini App** — a page of the Blueroll web app opened inside Telegram from a "Fill in" button; all items on one screen; out-of-range shows an inline mandatory "What did you do?" |
| Bot | **Separate customer bot `@BluerollChecksBot`** (token in `~/Secrets/blueroll/telegram_checks_bot_token`); the internal ops bot `@Bluerollbot` is untouched |
| Linking | QR / link `https://t.me/BluerollChecksBot?start=<code>` → staff taps **Start** → bot receives `/start <code>` → identity bound + consent recorded (same `issue_link_code` RPC, same 15-min codes, same brute-force limit) |
| Reminders, recipients, availability, WhatsApp-only staff | Same as WhatsApp (assigned people, 30 min before `deadline_time`, all entitled businesses, toggle per channel, members without login) |
| Cost | Free — no billable flags, no 24-hour window |

## 3. What is reused unchanged

`checklists-core` (due, flagging, answers, reminders, record), `channel_identities` (channel `'telegram'`, `external_id` = Telegram user id), `channel_link_codes` + `issue_link_code` / `revoke_channel_identity`, `channel_reminders_sent`, `channel_messages_log`, `channel_form_tokens`, `checklist_completions.source = 'telegram'`, `checklist_responses.corrective_status`, the bot state machine (`bot.ts`) with a Telegram adapter, `team-create-channel-member`.

## 4. New / changed

**Data (one small migration):**
- `businesses.telegram_enabled boolean not null default false` (same owner/manager guard as `whatsapp_enabled`); `channel_ready(b uuid, channel text)` generalising `whatsapp_ready`.
- `channel_flows` is not used for Telegram (no published forms).

**Adapter `_shared/channels/telegram.ts`:**
- `verifyWebhook(req)`: header `X-Telegram-Bot-Api-Secret-Token` equals `TG_WEBHOOK_SECRET` (constant-time).
- `parseUpdate(update) → InboundEvent[]`: `/start <code>` → link; `/checks`, `/stop`, `/help`, plain text → text; `callback_query` → button (answered with `answerCallbackQuery`). Ignores edited messages, channels, groups (bot only works in private chats).
- Builders: `sendMessage` with `inline_keyboard`; **Fill in** button of type `web_app` with URL `https://app.blueroll.app/tg/form?t=<token>`.
- `verifyInitData(initData, botToken)`: Telegram Mini App signature check (HMAC-SHA256 with key `HMAC("WebAppData", botToken)`), `auth_date` not older than 24 h; returns the Telegram user id.
- Bot commands menu set once via `setMyCommands` (`checks`, `stop`, `help`).

**Bot (`bot.ts`) generalisation:** sending goes through a `ChannelSender` interface (WhatsApp and Telegram implementations); "send form" = Flow message (WhatsApp) or web_app button (Telegram). Corrective follow-up forms are **not** sent on Telegram (inline in the form); the nudge/alert logic remains for missing corrective actions only if a submitted response somehow lacks one (should not happen).

**Edge functions:**
- `telegram-webhook` — receives updates, verifies the secret header, runs `handleInbound` with Telegram deps.
- `channel-form` — used by the Mini App:
  - `GET ?t=<token>` with header `X-Telegram-Init-Data` → verifies initData, that the token is unused/unexpired and belongs to the identity of that Telegram user, re-checks assignment; returns `{ template name, site name, items (supported, sorted), limits }`.
  - `POST { t, answers: {item_id: value}, corrective: {item_id: {action, details}} }` → same verification, atomic token take, `parseFormAnswers` + flagging, **requires a corrective action for every flagged item**, `recordCompletion(source='telegram')` with the corrective notes already set (`corrective_status='done'`), manager alerts.
- `whatsapp-reminders` → renamed/generalised to `channel-reminders` handling both channels (per identity channel); or a thin `telegram-reminders` reusing the same planner. (Plan decides; no behaviour difference.)

**Web:**
- Route `/tg/form` — a lightweight page (no app chrome, no Supabase session) using the Telegram WebApp JS (`telegram-web-app.js`): theme colours, `MainButton` "Submit", inline validation (numbers, required, out-of-range → corrective select + details), shows "Done ✓" and `Telegram.WebApp.close()`.
- Settings: "Telegram checks" toggle. Team: "Connect Telegram" (QR with the `t.me` deep link) and status/disconnect, alongside WhatsApp.

## 5. Conversations (Telegram copy)

Same texts as WhatsApp (`TEXT` in `bot.ts`), with commands written `/checks`, `/stop`, `/help`. Linking reply: "Hi Anna 👋 You're connected to Wharf Side. I'll remind you before your checks are due. Send /stop anytime." Reminder: "Fridge & Freezer Temperatures is due at 11:00 at Wharf Side." + **[Fill in]** (web_app). Manager alert (to managers linked on Telegram): "⚠ Wharf Side · Walk-in fridge 9 °C at 10:42 (Anna). Action: moved food to another fridge. — via Blueroll".

## 6. Security

- Webhook: secret header; private chats only.
- Mini App: one-time token (24 h, bound to profile/template/site) **and** a valid `initData` whose user id equals the identity bound to the token's profile; atomic take; assignment re-check at submit; answers validated server-side exactly as for WhatsApp (numeric temperatures, text cap). The page itself holds no credentials.
- Telegram user ids stored as `external_id`; masked in logs.
- Consent = staff pressing Start on the deep link (Telegram requires the user to start the bot before it can message them).

## 7. Testing

- Unit: `parseUpdate` fixtures (start with code, commands, callback, junk), `verifyInitData` (valid/expired/tampered), `verifyWebhook`, form POST validation (corrective required for flagged, missing required, foreign token, used token).
- Bot tests run against both senders.
- Pilot: link Kostya's and Maria's Telegram to «Fern & Fig» → `/checks` → Fill in → in-range → out-of-range with inline corrective → manager alert → `/stop`.

## 8. Out of scope

Groups/channels, Telegram payments, photos in the form (follows the WhatsApp rule: required photo → app only), using the Mini App form for WhatsApp (possible later), mobile app changes.

## 9. Order of work

Telegram plan runs right after the remaining WhatsApp tasks (Flows sync, web UI) and before the Meta-dependent WhatsApp pilot. Shared web pieces (Team connect UI, settings toggles) are built once for both channels.
