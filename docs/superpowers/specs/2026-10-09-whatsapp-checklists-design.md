# WhatsApp checklists (MVP) — Design Spec

**Date:** 2026-10-09 · **Status:** draft for review · **Decisions:** Kostya (session 09.10.2026)

## 1. Goal

A second interface to Blueroll's daily checklists: kitchen staff complete checks **in WhatsApp**, with no app install and no login. Everything else stays in the app.

**Success criteria**
- Staff at a pilot site complete their assigned temperature and opening/closing checks on time via WhatsApp.
- WhatsApp completions are indistinguishable in data from app completions (same tables, same flagging, same manager notifications), marked "via WhatsApp".
- Out-of-range values always end with a recorded corrective action or a manager alert.
- Meta spend ≤ £2 per site per month (measured, not estimated).

**In MVP:** temperature checks (fridges, freezers, hot hold, any template with temperature items), opening/closing checks, out-of-range → corrective action → manager alert.
**Not in MVP:** checklist setup, reports, documents, HACCP pack, training, supervisor sign-off, Telegram (adapter seam only), dynamic Flows, mobile app changes, marketing (FSA-alerts WhatsApp Channel, Click-to-WhatsApp ads — separate work, no bot needed).

## 2. Decisions

| Topic | Decision |
|---|---|
| Who gets reminders and fills in | **Every person a checklist is assigned to** (by `assigned_role_ids` / `assigned_roles` and site) |
| When reminders are sent | **30 min before the checklist's `deadline_time`, only if not yet completed** for the current period, in the site's timezone |
| How staff connect | **QR shown by a manager** (Team) → staff sends a one-time code from their phone → number bound + opt-in recorded |
| Staff without an app account | **Allowed**: manager creates a "WhatsApp-only" team member (name, role, site) |
| Availability | **All entitled businesses** (active or trial); manager toggle `whatsapp_enabled`; no paid tier |
| Where the bot runs | **Supabase Edge Functions** next to the DB (same pattern as Stripe/Apple/Play webhooks) |
| Forms | **Static WhatsApp Flow per checklist**, generated and published when the checklist changes; corrective action is a follow-up form |
| API | **WhatsApp Cloud API directly** (no BSP) |
| Channel independence | Core knows nothing about WhatsApp; WhatsApp is an adapter; Telegram later = second adapter |

## 3. Data model (one migration)

- `sites.timezone text not null default 'Europe/London'`.
- `businesses.whatsapp_enabled boolean not null default false` — writable by owner/manager only.
- `channel_identities` — `id, business_id, profile_id → profiles, channel text check in ('whatsapp','telegram'), external_id text` (E.164 phone for WhatsApp), `consent_at, consent_source ('qr_code'), consent_text_version, linked_by (profile who issued the QR), revoked_at, created_at`. Unique `(channel, external_id) where revoked_at is null`; one active identity per `(profile_id, channel)`. RLS: business managers read/revoke; writes only by service role.
- `channel_link_codes` — `code text primary key` (6 digits, random), `profile_id, business_id, site_id, issued_by, expires_at (now()+15 min), used_at`. RLS: managers insert/read for their business; service role consumes.
- `channel_messages_log` — `id, business_id, site_id, profile_id, channel, direction ('out'|'in'), kind ('reminder'|'reminder_list'|'flow'|'corrective_flow'|'alert'|'reply'|'link'), template_id (nullable), billable boolean, wa_message_id, created_at`. Service role only; managers read aggregates. Basis for spend reporting and reminder de-duplication.
- `channel_reminders_sent` — `profile_id, template_id, site_id, period_key text` (e.g. `2026-10-09`), `sent_at`; primary key `(profile_id, template_id, site_id, period_key)` — guarantees at most one reminder per person/checklist/period.
- `channel_flows` — `template_id, site_id, channel, flow_id, items_hash, status ('published'|'draft'|'error'), updated_at`; unique `(template_id, site_id, channel)`.
- `checklist_completions.source text not null default 'app' check in ('app','whatsapp','telegram')`.
- `checklist_responses.corrective_status text null check in ('needed','done')` — set to `'needed'` for flagged items from channels until the corrective action is recorded in `notes`.

**WhatsApp-only staff:** an edge function (`team-create-channel-member`, owner/manager JWT) creates an auth user via the Admin API with a non-deliverable placeholder email (`wa+<uuid>@noreply.blueroll.app`), no password, `app_metadata.channel_only = true`, and the normal profile (business, role_id, site membership). The web login rejects `channel_only` users. All existing joins (`completed_by`, notifications, reports) work unchanged.

## 4. Architecture

```
supabase/functions/
  _shared/checklists-core/      channel-agnostic, pure where possible, unit-tested under Vitest
    due.ts          dueChecklists(profile, site, now, completions) → [{template, deadline, periodKey}]
    flagging.ts     flagResponse(item, value) — identical rules to web autoFlag / mobile _isFlagged
    record.ts       recordCompletion(svc, {profile, site, template, answers, source}) → completion + responses + notifications
    reminders.ts    whoToRemind(now, sites, assignments, completions, alreadySent) → reminder jobs
  _shared/channels/
    types.ts        ChannelAdapter interface (sendReminder, sendList, sendForm, sendText, sendAlert, parseInbound)
    whatsapp.ts     Cloud API client, X-Hub-Signature-256 verify, inbound parsing, Flow JSON builder + publish
  whatsapp-webhook/       GET verify (hub.challenge) · POST messages / flow submissions / LINK codes / commands
  whatsapp-reminders/     cron every 10 min (x-cron-secret), sends due reminders and corrective follow-ups
  whatsapp-sync-flows/    publish/update a template's Flow (called by web after saving a template; also nightly)
  team-create-channel-member/
```

- **Due logic** reuses the app's rules (`getPeriodStart`, `deadline_time`, `multi_per_day`/`min_per_day`, site scope) and evaluates them in `sites.timezone`. One shared implementation; the web `checklist-status.ts` keeps working as is (later refactor may import the same core).
- **Flagging:** temperature below `min_value` or above `max_value`; `yes_no` = `'no'`. Values stored as strings exactly as the apps do (`'true'`, `'yes'/'no'`, numeric string, storage path for photos).
- **Notifications:** `recordCompletion` inserts the same `notifications` rows as `notifyFlaggedItem` (recipients: owner/manager of the business) — written with the service role.
- **Entitlement:** writes go through the service role, so the webhook checks `is_business_entitled(business_id) and whatsapp_enabled` itself before recording or sending anything.

## 5. Flows (WhatsApp Flows, static)

- One Flow per `(template, site)` — generated from `checklist_template_items` (sorted by `sort_order`):
  - `temperature` → number input (label = item name, helper "0–5 °C"), `required` from the item;
  - `yes_no` → radio Yes/No; `tick` → checkbox; `text` → text input; `photo` → photo picker; `initials` → omitted (identity known).
  - Max ~10 inputs per screen; longer checklists split into screens.
  - Final screen: "Done ✓" (`complete` action) — no confirmation message is sent.
- `items_hash` detects changes; `whatsapp-sync-flows` publishes a new Flow version when the hash changes. A template without a published Flow is not offered in WhatsApp.
- **Corrective-action Flow** (one generic Flow): shows the flagged item and value, a choice of common actions ("moved food to another fridge", "adjusted thermostat, rechecking in 30 min", "discarded food", "called engineer", "other") and a free-text field. Result → `checklist_responses.notes` of that item, `corrective_status = 'done'`.

## 6. Conversations

1. **Link:** staff scans the manager's QR → WhatsApp opens with `LINK 482913` → webhook validates code (exists, unused, not expired, business entitled and enabled) → creates `channel_identities` (+ consent) → replies "Hi Anna 👋 You're connected to Wharf Side. I'll remind you before your checks are due. Reply STOP anytime." Invalid/expired → "This link has expired — ask your manager for a new QR code."
2. **Reminder** (utility template): 30 min before deadline if not completed → "Fridge & Freezer Temperatures is due at 11:00 at Wharf Side." + **[Fill in]** (opens the Flow). Several due within the same 30-minute window → one list message, up to 3 buttons.
3. **Fill in:** Flow submission arrives → `recordCompletion(source='whatsapp')`.
4. **Out of range:** immediately send the corrective-action Flow for each flagged item (one at a time). Until done, the response has `corrective_status='needed'`; one nudge after 30 min.
5. **Manager alert:** after the corrective action (or after the 30-min nudge expires without one): in-app notification (always) + WhatsApp alert template to owners/managers who have a WhatsApp identity: "⚠ Wharf Side · Walk-in fridge 9 °C at 10:42 (Anna). Action: moved food to the other fridge." footer "via Blueroll".
6. **Commands:** `checks` → current due list with buttons; `stop` → revoke identity, confirm; `help` → short help; anything else → "I can help with your checks — tap Fill in or type checks." No LLM.
7. **Edge cases:** unknown number → "Ask your manager for a QR code to connect"; profile removed → identities revoked (trigger on profile/member removal); business not entitled or WhatsApp disabled → no reminders, polite reply; Flow submitted after someone completed in the app → still recorded (another completion in history).

## 7. Consent, privacy, Meta

- Opt-in = staff's own action (sending the code). Stored: time, number, issuing manager, consent text version. `STOP` or manager "Disconnect" revokes at once; reconnect only via a new QR. App remains available to anyone who doesn't want to use personal WhatsApp; Team shows Connected / Not connected.
- Data stored: phone number, consent, message log metadata — **not message contents** beyond checklist answers. Numbers masked in function logs. Cascade delete with profile/business. Privacy policy gets a paragraph on WhatsApp (Meta) as processor; Meta's Cloud API terms include the data processing terms.
- Meta setup (parallel to development): Meta Business + WABA under Cherrypicked Design Ltd, business verification (D-U-N-S 225604652), dedicated number, display name "Blueroll"; utility templates for approval: `checklist_reminder`, `checklist_reminder_list`, `manager_alert`, `corrective_nudge`. Secrets: `WA_TOKEN` (system user), `WA_PHONE_NUMBER_ID`, `WA_WABA_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `WA_CRON_SECRET`; copies in `~/Secrets/blueroll/`.
- Spend: every outbound message is logged with `billable` (template outside the 24-hour customer service window = billable); admin view shows billable messages per site per month.

## 8. Web changes

- Team: per member "Connect WhatsApp" (QR + code, 15-min expiry), status Connected/Not connected, "Disconnect"; "Add WhatsApp-only member".
- Settings: "WhatsApp checks" toggle (owner/manager).
- Checklist history: "via WhatsApp" badge (`source`).
- After saving a checklist template: call `whatsapp-sync-flows` (fire-and-forget).
- Login: reject `channel_only` users with a clear message.

## 9. Testing

- Core (Vitest): due-checklists by timezone, frequency, deadline, multi-per-day, existing completions; flagging parity with web `autoFlag` (shared fixtures); `whoToRemind` de-duplication across runs.
- WhatsApp adapter: inbound parsing against saved Meta payload fixtures (text, button reply, flow `nfm_reply`); signature verification (valid/invalid/missing); Flow JSON snapshot per item type; screen splitting.
- DB: migration + RLS verified with the rolled-back DO-block script on the demo business (as for the questionnaire).
- Pilot: Meta test number with up to 5 allow-listed phones (Kostya, Maria) on demo «Fern & Fig» → production number after verification and template approval → one Bobo site.

## 10. Risks / open points

- Meta business verification and template approval timelines (days–weeks) — start immediately.
- Exact UK utility rate and the free-window rules must be checked against Meta's official rate card before quoting prices to clients.
- Flow publishing limits/latency: if publishing per (template, site) proves heavy, fall back to one Flow per template with site-independent items.
- Deadline-less checklists (no `deadline_time`) get no reminders; they remain available via `checks`.
