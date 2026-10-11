# Telegram live checklist list — Design Spec

**Date:** 2026-10-11 · **Status:** draft for review · **Decisions:** Kostya (10–11.10.2026)
**Builds on:** `2026-10-10-telegram-checklists-design.md`. Everything not stated here stays as it is.
**Followed by:** Telegram groups spec (separate). This design is built so a group chat is just another kind of chat.

## 1. Goal

Today every reminder and every `/checks` is a new message, and a submitted form adds a "Recorded ✓" message, so the chat
fills with stale buttons. Goal: **one live message per chat and site** that always shows what is left today, with status
icons, and that tidies itself up.

Success criteria:
- At any time a chat holds at most one list message per site.
- The phone only notifies when something new needs attention (a reminder or `/checks`); every other update is a silent edit.
- When everything for the day is done, the list disappears.

## 2. Decisions

| Topic | Decision |
|---|---|
| Unit | One live list per **(chat, site)**. A person linked to 3 sites can have up to 3 lists. |
| New reminder | Send a **new** list message with everything still due today at that site, then **delete the previous** list message for that (chat, site). One notification. |
| `/checks` | Same as a new reminder, for every site that has something due. Pending corrective forms are unaffected (Telegram has none). |
| Form submitted | No "Recorded ✓" message. The list for that (chat, site) is **edited** at once: the item turns ✅. |
| Everything done | The list message is **deleted**. |
| Status refresh | Every reminders cron run (every 10 min) re-renders every live list and **edits** it only if the rendered content changed. Completions made in the mobile/web app show up here too. |
| New day | A list from a previous local day (site timezone) is deleted on the next cron run. |
| WhatsApp | Unchanged (it can't edit or delete business messages). |

## 3. What the list looks like

```
📋 Wharf Side — 2 of 5 done
🔴 Fridge & Freezer Temperatures · due 10:00
🟠 Hot Holding Checks · due 12:00
⚪ Cleaning Schedule · due 23:00
⚪ Weekly Deep Clean
✅ Daily Opening Checks · 08:47 Anna
✅ Delivery Check · 09:05 Alex

[ 🔴 Fridge & Freezer Temperatures ]
[ 🟠 Hot Holding Checks ]
[ ⚪ Cleaning Schedule ]
[ ⚪ Weekly Deep Clean ]
```

- Header: `📋 <site> — <done> of <total> done` (bold site name, HTML parse mode, all dynamic text HTML-escaped).
- One line per open checklist, sorted: overdue, due soon, later with a deadline (by deadline), no deadline (by name).
  - 🔴 overdue: deadline passed. 🟠 due soon: deadline within 30 min (`LEAD_MINUTES`). ⚪ later, or no deadline (no time shown).
  - The time is the deadline as a clock time (`due 10:00`), never a countdown, so the text only changes on a state change.
  - App-only checklists (required photo, nothing fillable) get `· app only` and no button.
- Done checklists (completed in the current period, any source) at the end: `✅ <name> · <HH:MM> <first name>`.
- One Mini App button per open, fillable checklist: `<status icon> <name>` (64-char clip as today), web_app URL with a form token.
- "Total" = open + done for this site and this chat's audience (§4).

## 4. Audience

What a list contains is decided by an **audience** function, so groups can plug in later:
- Private chat (this spec): the linked person's checklists at that site — `dueChecklists` for open items (as `/checks` today),
  plus completions in the current period of the same available templates for the ✅ lines.
- Group chat (next spec): the checklists mapped to that group.

## 5. Data

New table `channel_live_lists`:

| Column | Notes |
|---|---|
| `id uuid pk` | |
| `business_id uuid` | FK businesses, cascade |
| `site_id uuid` | FK sites, cascade |
| `channel text` | `'telegram'` |
| `chat_id text` | Telegram chat id (= `external_id` for private chats) |
| `profile_id uuid null` | the person for a private chat; null for a group (later) |
| `list_date date` | local date at the site when the message was sent |
| `message_id text` | Telegram message id |
| `tokens jsonb` | `{ template_id: token }` minted for this message's buttons |
| `rendered_hash text` | hash of the last text + keyboard sent |
| `created_at`, `updated_at` | |

Unique `(channel, chat_id, site_id)`; one row = the current live list. RLS on, no policies (service role only).

Tokens: a checklist keeps the token minted for this message until the message is replaced; a refresh that needs a button
for a newly due checklist mints one and stores it. Token TTL stays 24 h; a list reposted the next day gets new tokens.

## 6. Behaviour

**Repost (reminder or `/checks`) for (chat, site):** render → `sendMessage` → upsert the row with the new `message_id`
→ `deleteMessage` the old one (best effort). If the render has no open items, nothing is sent (`/checks` answers
"Nothing is due right now 👍" as today when no site has anything).

**Refresh (cron, or right after a form submit) for a row:**
1. Row's `list_date` is before today at the site → `deleteMessage`, delete the row.
2. No open items → `deleteMessage`, delete the row.
3. Rendered hash unchanged → nothing.
4. Otherwise → `editMessageText` with the new text + keyboard, store the hash.

Errors:
- Edit/delete answer "message to edit/delete not found" or "can't be deleted" (deleted by the user, or >48 h): delete
  the row; the next reminder or `/checks` posts a fresh list.
- "message is not modified": treat as success.
- 403 (bot blocked): revoke the identity as today.
- Any other error: keep the row; the next cron run retries.

**Reminders:** the planner decides *when* exactly as today (30 min before a deadline, once per person/template/site/period,
cross-channel key). For Telegram, a planned job now means "repost the list for (chat, site)", and `MAX_PER_MESSAGE` no
longer applies to Telegram. WhatsApp jobs are unchanged.

**Form submit (`channel-form`):** after recording, refresh the (chat, site) row of the submitting person instead of
sending "Recorded ✓". Manager alerts stay separate messages.

## 7. Telegram adapter

Add to `telegram.ts`: `tgEditList(chatId, messageId, text, keyboard)` → `editMessageText` with `parse_mode: 'HTML'` and
`reply_markup`; `tgDelete(chatId, messageId)` → `deleteMessage`; both return `{ ok, status, description }` and never throw.
`sendMessage` for the list uses `parse_mode: 'HTML'`.

## 8. Testing

- Pure renderer: ordering, icons per state, app-only, done lines, header counts, HTML escaping, 64-char button clip, hash stable.
- Pure refresh decision: (row, render, today) → `delete` / `edit` / `none`.
- Repost: sends new then deletes old; a failed delete doesn't fail the repost.
- Error mapping: not found / not modified / 403 / other.
- Form submit: no "Recorded ✓"; refresh called for the right (chat, site).
- Reminders: Telegram job → one repost per (chat, site) with all open items; WhatsApp unchanged.
- Pilot on Fern & Fig: `/checks` → fill one → ✅ appears without a new message → wait for 🟠/🔴 changes → reminder replaces
  the list → fill the rest → list disappears; complete one in the mobile app → ✅ within 10 min.

## 9. Out of scope

Groups (next spec), the "Today" Mini App screen with colours and pulsing (later), shift check-in, WhatsApp changes.
