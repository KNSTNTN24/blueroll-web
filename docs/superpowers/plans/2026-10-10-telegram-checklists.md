# Telegram Checklists (MVP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff complete their assigned checklists through the customer bot `@BluerollChecksBot`: deep-link connect, reminders with a **Fill in** button that opens a one-screen Mini App form (corrective actions inline), manager alerts — writing the same records as the apps.

**Architecture:** Reuse the WhatsApp core and schema. Add a Telegram adapter, make the bot channel-agnostic through a `ChannelUI` interface (WhatsApp payloads unchanged), generalise `db.ts`/reminders by channel, and add a `channel-form` edge function plus a `/tg/form` web page for the Mini App. Telegram is free: no templates, no billing window.

**Tech Stack:** Telegram Bot API (webhook with `secret_token`, `sendMessage` + `inline_keyboard` with `web_app` buttons, `setMyCommands`), Telegram Mini Apps (`telegram-web-app.js`, `initData` HMAC check), Supabase Edge Functions (Deno), Postgres, Next.js 16, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-telegram-checklists-design.md` (builds on `2026-10-09-whatsapp-checklists-design.md`).

**Prerequisite:** WhatsApp plan Tasks 12–13 (Team connect UI, settings toggle, history badge) are complete — this plan extends them.

## Global Constraints

- Everything in the WhatsApp plan's Global Constraints applies (shared modules, tsc baseline 3, value formats, flagging, assignment, period/timezone, entitlement, masking, English copy, STOP points, commit trailer).
- Bot token in `~/Secrets/blueroll/telegram_checks_bot_token` → Supabase secret `TG_BOT_TOKEN`; webhook secret `TG_WEBHOOK_SECRET` (random 32+ chars, also in `~/Secrets/blueroll/`); never log either. Bot username constant: `BluerollChecksBot`.
- Telegram identities: `channel = 'telegram'`, `external_id` = Telegram **user id** as a decimal string. Private chats only (`chat.type === 'private'`); `chat.id === from.id` there.
- `channel_reminders_sent` key has no channel: a person linked on both channels gets **one** reminder per key (whichever channel claims first) — intended.
- WhatsApp behaviour and payloads must not change (existing tests stay green unmodified except for fixture wiring).
- Telegram copy: same `TEXT` strings as WhatsApp except commands spelled `/checks`, `/stop`, `/help` and "Send /stop anytime."
- Mini App URL: `https://app.blueroll.app/tg/form?t=<token>`.
- Prod changes (migration, secrets, deploy, `setWebhook`) only after Kostya's "yes" — STOP in Tasks 1 and 10.

## Review Focus

1. **Mini App opened by someone else** (forwarded button, other Telegram account) — form must refuse unless `initData` user id equals the identity bound to the token's profile. Test in Task 6.
2. **Out-of-range submitted without a corrective action** (tampered client) — server must reject (400) and record nothing. Test in Task 6.
3. **`initData` older than 24 h or with a tampered field** — rejected. Test in Task 2.
4. **Same person linked on WhatsApp and Telegram** — one reminder per key, bot replies on the channel the message came from. Test in Task 3/7.
5. **Group chat or channel post to the bot** — ignored, no reply. Test in Task 2.

---

## File Structure

```
supabase/migrations/20261011120000_telegram_channel.sql
supabase/tests/telegram_channel_verify.sql
supabase/functions/_shared/channels/telegram.ts        verifyWebhookSecret, parseUpdate, builders, verifyInitData, makeTelegramSender, setup calls
supabase/functions/_shared/channels/ui.ts              ChannelUI interface, whatsappUI, telegramUI
supabase/functions/_shared/channels/bot.ts             (modify) use d.ui / d.channel
supabase/functions/_shared/channels/db.ts              (modify) makeDeps(admin, { channel, ui, ... })
supabase/functions/_shared/channels/alerts.ts          alertManagers across channels
supabase/functions/_shared/channels/form-api.ts        pure GET/POST handlers for the Mini App form
supabase/functions/telegram-webhook/index.ts
supabase/functions/channel-form/index.ts
supabase/functions/whatsapp-reminders/index.ts         (modify) also handles telegram identities
src/app/tg/form/page.tsx                               Mini App page (outside the dashboard layout)
src/app/tg/form/form.tsx
src/lib/whatsapp/client.ts                             (modify) channel config: telegram link
src/app/(dashboard)/settings/…                         (modify) Telegram toggle
src/lib/whatsapp/__tests__/telegram.test.ts, ui.test.ts, form-api.test.ts, fixtures/tg-*.json
```

---

### Task 1: Migration — `telegram_enabled`, `channel_ready`

**Files:** Create `supabase/migrations/20261011120000_telegram_channel.sql`, `supabase/tests/telegram_channel_verify.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20261011120000_telegram_channel.sql
set search_path = public;

alter table public.businesses add column if not exists telegram_enabled boolean not null default false;

-- Same owner/manager guard as whatsapp_enabled (see 20261010120000).
create or replace function public.guard_telegram_enabled()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated','anon')
     and new.telegram_enabled is distinct from old.telegram_enabled
     and not public.is_active_business_manager(new.id) then
    raise exception 'only owners and managers can change Telegram settings' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_telegram_enabled on public.businesses;
create trigger trg_guard_telegram_enabled before update of telegram_enabled on public.businesses
  for each row execute function public.guard_telegram_enabled();

create or replace function public.channel_ready(b uuid, ch text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_business_entitled(b) and coalesce((
    select case ch when 'whatsapp' then whatsapp_enabled when 'telegram' then telegram_enabled else false end
    from public.businesses where id = b), false)
$$;
revoke execute on function public.channel_ready(uuid, text) from public, anon;
grant execute on function public.channel_ready(uuid, text) to authenticated, service_role;
```

Before writing, read `20261010120000_whatsapp_channel.sql` and copy the exact guard pattern there (helper name `is_active_business_manager`, `current_user` check); adjust if names differ.

- [ ] **Step 2: Verify DO block** (rolled back via final RAISE, demo business «Fern & Fig» `2693f7de-c0ba-4d52-bbe9-602106eac784`, owner `981197ca-3648-4c6c-9f18-ff7b6ae68786`): owner flips `telegram_enabled` → true; `channel_ready(biz,'telegram')` true; `channel_ready(biz,'whatsapp')` equals `whatsapp_ready(biz)`; `channel_ready(biz,'sms')` false. Result json in the raise.

- [ ] **Step 3: pglast parse check** (as in the WhatsApp Task 1).

- [ ] **Step 4: STOP** — ask Kostya before applying; then apply via Management API and run the verify block.

- [ ] **Step 5: Commit** `feat(db): telegram_enabled and channel_ready`.

---

### Task 2: Telegram adapter (pure)

**Files:** Create `supabase/functions/_shared/channels/telegram.ts`, fixtures `src/lib/whatsapp/__tests__/fixtures/tg-start.json`, `tg-command.json`, `tg-callback.json`, `tg-group.json`; Test `src/lib/whatsapp/__tests__/telegram.test.ts`

**Interfaces — Produces:**

```ts
export const TG_API = 'https://api.telegram.org'
export const BOT_USERNAME = 'BluerollChecksBot'
export function verifyWebhookSecret(header: string | null, secret: string): boolean          // constant-time
export function parseUpdate(update: unknown): InboundEvent[]   // reuses InboundEvent kinds: text / button; link arrives as text 'LINK <code>'
export function tgText(chatId: string, text: string): OutboundMessage
export function tgButtons(chatId: string, text: string, buttons: { id: string; title: string }[]): OutboundMessage   // callback_data buttons, one per row
export function tgWebAppButton(chatId: string, text: string, buttons: { title: string; url: string }[]): OutboundMessage
export async function verifyInitData(initData: string, botToken: string, now: Date, maxAgeSec?: number): Promise<{ userId: string } | null>
export function makeTelegramSender(cfg: { token: string; fetchFn?: typeof fetch }): SendFn       // POST /bot<token>/sendMessage with the message body; also answers callback queries when msg has callback_query_id
export async function setupBot(cfg: { token: string; webhookUrl: string; secret: string; fetchFn?: typeof fetch }): Promise<{ ok: boolean; errors: string[] }>  // setWebhook(secret_token, allowed_updates ['message','callback_query']) + setMyCommands
```

`parseUpdate` rules: only `message` (with `chat.type === 'private'`, `from.is_bot !== true`, `text` string) and `callback_query` (from a private chat). `/start <code>` (code = 6 digits) → `{ kind: 'text', from: <user id>, text: 'LINK <code>' }` so the existing bot linking path handles it; `/start` alone → text `help`; `/checks` → text `checks`; `/stop` → text `stop`; `/help` → text `help` (strip `@BluerollChecksBot` suffix); other text → as is. `callback_query` → `{ kind: 'button', from, payload: data, id: callback id }`. Everything else (edited_message, channel_post, group messages, non-text) → nothing. `from` is always the decimal user id string.

`verifyInitData` (Telegram Mini Apps spec): parse with `URLSearchParams`; take `hash`; build `data_check_string` = all other `key=value` pairs sorted by key, joined with `\n`; `secret = HMAC_SHA256(key="WebAppData", msg=botToken)`; valid if `hex(HMAC_SHA256(key=secret, msg=data_check_string)) === hash` (constant-time) and `now − auth_date ≤ maxAgeSec` (default 86400); returns `{ userId: String(JSON.parse(user).id) }`.

- [ ] **Step 1: Fixtures + failing tests** — cover: `/start 482913` → `LINK 482913`; `/start` → `help`; `/checks@BluerollChecksBot` → `checks`; callback → button with `data`; group message, channel_post, edited_message, bot sender, sticker → `[]`; malformed shapes never throw. `verifyWebhookSecret` true/false/null. `verifyInitData`: build a valid initData in the test with Node `crypto` (`createHmac('sha256','WebAppData').update(token)` → key; then `createHmac('sha256', key).update(dcs).digest('hex')`), assert valid → userId; tampered `user` → null; `auth_date` 25 h old → null; missing hash → null. Builders: `tgWebAppButton` produces `reply_markup.inline_keyboard[[{ text, web_app: { url } }]]`; `tgButtons` produces `callback_data` ≤ 64 bytes (truncate/validate). Sender: posts to `/bot<token>/sendMessage`, returns `{ id: String(result.message_id), ok, status }`, never throws.

- [ ] **Step 2: RED → implement → GREEN** (same `.ts` import conventions; use WebCrypto `crypto.subtle` for HMAC; no Node imports in the module).

- [ ] **Step 3: Commit** `feat(channels): Telegram adapter (updates, buttons, initData)`.

---

### Task 3: `ChannelUI` + channel-agnostic bot

**Files:** Create `supabase/functions/_shared/channels/ui.ts`; Modify `bot.ts`, `src/lib/whatsapp/__tests__/bot.test.ts`; Test `src/lib/whatsapp/__tests__/ui.test.ts`

**Interfaces — Produces:**

```ts
// ui.ts
export type Channel = 'whatsapp' | 'telegram'
export interface FormRequest { templateName: string; token: string; flowId?: string }
export interface ChannelUI {
  channel: Channel
  text(to: string, body: string): OutboundMessage
  choices(to: string, body: string, buttons: { id: string; title: string }[]): OutboundMessage   // ≤3 shown
  form(to: string, f: FormRequest): OutboundMessage | null       // WA: Flow message (needs flowId); TG: web_app button to MINI_APP_URL?t=token
  corrective(to: string, c: { token: string; flowId: string; itemName: string; valueText: string }): OutboundMessage | null  // WA only; TG returns null
  managerAlert(to: string, a: { siteName: string; itemName: string; value: string; time: string; byName: string; action: string }): { msg: OutboundMessage; templateName?: string }
  commandWord(cmd: 'checks' | 'stop' | 'help'): string            // 'CHECKS' vs '/checks'
}
export function whatsappUI(): ChannelUI
export function telegramUI(miniAppBaseUrl: string): ChannelUI
```

**Bot changes (keep WhatsApp payloads byte-identical):**
- `BotDeps` gains `channel: Channel` and `ui: ChannelUI`; `send` stays.
- Replace direct `textMessage/buttonsMessage/flowMessage/templateMessage` calls with `d.ui.*`.
- `TEXT` copy that mentions commands uses `d.ui.commandWord(...)`; WhatsApp output unchanged (`TEXT` functions take the channel UI or a word; keep exact WhatsApp strings — the existing tests assert them).
- `sendChecklistForm`: for `telegram` don't call `flowFor`; compute `item_ids` from `formItems(items)` (`unsupportedRequired` non-empty → `TEXT.appOnly`), save the token, send `ui.form(...)`. For `whatsapp` unchanged.
- Flow replies (`kind: 'flow'`) only exist on WhatsApp; unchanged.
- `sendManagerAlert` → moved to `alerts.ts` (Task 4) and called from there; bot calls `alertManagers(d, businessId, a)`.
- Billable logging: only WhatsApp templates outside the window are billable; Telegram always `false`.

- [ ] **Step 1:** Write `ui.test.ts`: whatsappUI outputs equal the existing builder outputs for the same inputs (text, choices, form with flowId, corrective, managerAlert template name `manager_alert`); telegramUI: form → web_app URL `https://app.blueroll.app/tg/form?t=tok`, corrective → null, managerAlert → plain text `⚠ Wharf Side · Walk-in fridge 9 °C at 10:42 (Anna). Action: Moved food to another fridge. — via Blueroll`, commandWord → `/checks`.
- [ ] **Step 2:** Refactor `bot.ts`; inject `channel: 'whatsapp', ui: whatsappUI()` into the existing fake — **all existing bot tests must pass unchanged**.
- [ ] **Step 3:** Add Telegram bot tests with `channel: 'telegram', ui: telegramUI(...)`: LINK via `/start` text; `checks` → choices with `fill:` ids; `fill:` → web_app form message with a checklist token whose `item_ids` = supported items; required photo → appOnly text; texts use `/stop`.
- [ ] **Step 4:** npm test, tsc ≤ 3, `deno check` bot.ts/ui.ts. Commit `refactor(channels): ChannelUI so the bot serves WhatsApp and Telegram`.

---

### Task 4: `db.ts` by channel + cross-channel manager alerts

**Files:** Modify `supabase/functions/_shared/channels/db.ts`; Create `supabase/functions/_shared/channels/alerts.ts`; Modify `supabase/functions/whatsapp-webhook/index.ts` (pass channel/ui)

**Interfaces:**
- `makeDeps(admin, cfg: { channel: Channel; ui: ChannelUI; send: SendFn; correctiveFlowId?: string; senders?: Partial<Record<Channel, SendFn>> })`
- every `.eq('channel', 'whatsapp')` → `cfg.channel`; `ready` → `rpc('channel_ready', { b, ch: cfg.channel })`; `log` writes `channel: cfg.channel`; `flowFor` only for whatsapp (telegram → null, unused).
- `alerts.ts`: `alertManagers(admin, senders: Partial<Record<Channel, SendFn>>, businessId, a, now)` → for each active manager identity on any channel whose business is `channel_ready` for that channel: build with that channel's UI, send with that channel's sender, log (`billable` per WhatsApp window; Telegram false). Bot and reminders call this instead of `sendManagerAlert`.

- [ ] Steps: update bot fake to the new alert path; add a test (fake alert deps) that a manager linked on Telegram gets a text alert and a manager on WhatsApp gets the template; `deno check` all; npm test; commit `feat(channels): channel-aware deps and cross-channel manager alerts`.

---

### Task 5: `telegram-webhook` function

**Files:** Create `supabase/functions/telegram-webhook/index.ts`

```ts
// supabase/functions/telegram-webhook/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyWebhookSecret, parseUpdate, makeTelegramSender } from "../_shared/channels/telegram.ts";
import { telegramUI, whatsappUI } from "../_shared/channels/ui.ts";
import { makeSender } from "../_shared/channels/whatsapp.ts";
import { handleInbound } from "../_shared/channels/bot.ts";
import { makeDeps } from "../_shared/channels/db.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SECRET = Deno.env.get("TG_WEBHOOK_SECRET") ?? "";
const tgSend = makeTelegramSender({ token: Deno.env.get("TG_BOT_TOKEN") ?? "" });
const waSend = makeSender({ token: Deno.env.get("WA_TOKEN") ?? "", phoneNumberId: Deno.env.get("WA_PHONE_NUMBER_ID") ?? "" });
const deps = makeDeps(admin, { channel: "telegram", ui: telegramUI("https://app.blueroll.app/tg/form"), send: tgSend, senders: { telegram: tgSend, whatsapp: waSend } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (!SECRET || !verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"), SECRET)) return new Response("forbidden", { status: 401 });
  const update = await req.json().catch(() => null);
  for (const e of parseUpdate(update)) {
    try { await handleInbound(e, deps); } catch (err) { console.error("telegram inbound failed", (err as Error).message?.slice(0, 200)); }
  }
  return new Response("ok");
});
```

(Adjust to the actual `makeDeps` signature from Task 4.) `deno check`; commit `feat(telegram): webhook function`.

---

### Task 6: Mini App form API (`channel-form`)

**Files:** Create `supabase/functions/_shared/channels/form-api.ts`, `supabase/functions/channel-form/index.ts`; Test `src/lib/whatsapp/__tests__/form-api.test.ts`

**Interfaces — Produces (`form-api.ts`, pure over deps):**

```ts
export interface FormApiDeps {
  now(): Date
  verifyInitData(initData: string): Promise<{ userId: string } | null>
  identityByExternal(channel: 'telegram', externalId: string): Promise<{ profile_id: string; business_id: string } | null>
  peekToken(token: string): Promise<FormToken | null>                 // read-only: unused, unexpired
  takeToken(token: string, now: Date, profileId: string): Promise<FormToken | null>
  ready(businessId: string): Promise<boolean>
  person(profileId: string): Promise<Person | null>
  sitesFor(profileId: string): Promise<SiteInfo[]>
  templates(businessId: string): Promise<Template[]>
  items(templateId: string): Promise<TemplateItem[]>
  recordCompletionWithCorrective(a: { person: Person; siteId: string; template: Template; items: TemplateItem[]; answers: Answer[]; corrective: Record<string, string> }): Promise<{ completionId: string; flagged: { item: TemplateItem; value: string; notes: string }[] }>
  alert(businessId: string, a: { siteName: string; itemName: string; value: string; time: string; byName: string; action: string }): Promise<void>
}
export async function handleFormGet(d: FormApiDeps, token: string, initData: string): Promise<{ status: number; body: unknown }>
export async function handleFormPost(d: FormApiDeps, body: unknown, initData: string): Promise<{ status: number; body: unknown }>
```

Rules:
- Both: `verifyInitData` → null → 401; identity by Telegram user id → none → 403; token (peek for GET, take for POST) must belong to that identity's profile, be unused/unexpired, kind `checklist` → else 410 `{ error: 'expired' }`; `ready` false → 403; re-check assignment (template active+available to the person at token.site_id, site in sitesFor) → else 410.
- GET 200: `{ templateName, siteName, items: supported items in token.item_ids order → [{ id, name, type, required, min, max, unit }] , correctiveActions: CORRECTIVE_ACTIONS }`.
- POST body `{ t: string, answers: Record<itemId, string|number|boolean>, corrective: Record<itemId, { action: string; details?: string }> }`: map answers to `f<i>` by `token.item_ids` and use `parseFormAnswers`; `missingRequired` → 400 `{ error: 'missing', items }` (token NOT consumed — validate before `takeToken`; take only at the end); every flagged answer must have a corrective with a known `action` id → else 400 `{ error: 'corrective_required', items }`; then `takeToken` (if it fails → 410), record with notes `"<action title>[: details≤300]"` and `corrective_status 'done'`, alert managers per flagged item (time in site tz), 200 `{ ok: true }`.

- [ ] **Step 1:** tests with a fake deps: valid GET; GET with foreign Telegram user → 403; expired/used token → 410; unassigned now → 410; POST missing required → 400 and token still usable; POST flagged without corrective → 400; POST flagged with corrective → 200, notes set, alert called once; POST replay → 410; temperature `'5abc'` → treated missing.
- [ ] **Step 2:** implement `form-api.ts`; add to `CoreDb`/`record.ts` an option to pass per-item notes and `corrective_status: 'done'` (keep existing behaviour as default; WhatsApp tests unchanged).
- [ ] **Step 3:** `channel-form/index.ts`: CORS for `https://app.blueroll.app` (and `http://localhost:3001` for dev), `GET ?t=` / `POST` json, header `X-Telegram-Init-Data`; deps from Supabase (service role) + `verifyInitData` with `TG_BOT_TOKEN`; `--no-verify-jwt`.
- [ ] **Step 4:** tests green, `deno check`, commit `feat(telegram): Mini App form API with inline corrective actions`.

---

### Task 7: Reminders for Telegram

**Files:** Modify `supabase/functions/whatsapp-reminders/index.ts` (keep name; header comment notes it serves both channels)

- Load identities for both channels; group by (business, channel); `channel_ready(b, channel)`.
- Recipients per channel; the reminder-key claim is shared (one reminder per key regardless of channel).
- Telegram send: for each job, create one `checklist` form token per item (as `sendChecklistForm` does for Telegram) and send `tgWebAppButton(chatId, "<n> check(s) due at <site>: …", [{ title: 'Fill in <name>', url }])` — not billable.
- Corrective nudges/alerts: unchanged (WhatsApp only, `source = 'whatsapp'`); Telegram submissions always carry corrective actions.
- Manager alerts go through `alertManagers` (cross-channel).

- [ ] Steps: refactor with a small pure helper `buildTelegramReminder(job, tokens)` + unit test (button per item, titles ≤ 64 chars); `deno check`; npm test; commit `feat(telegram): reminders with Mini App buttons`.

---

### Task 8: Mini App page `/tg/form`

**Files:** Create `src/app/tg/form/page.tsx`, `src/app/tg/form/form.tsx`; Modify `src/app/layout.tsx` only if needed for a bare layout (prefer `src/app/tg/layout.tsx` with no app chrome)

- Client page; loads `https://telegram.org/js/telegram-web-app.js` (Next `<Script strategy="beforeInteractive">` per installed Next docs); reads `window.Telegram.WebApp.initData`, calls `WebApp.ready()`, `expand()`, uses `themeParams` for colours.
- Token from `?t=`. `GET ${SUPABASE_URL}/functions/v1/channel-form?t=…` with header `X-Telegram-Init-Data`.
- Render: title (template · site); temperature inputs (`inputMode="decimal"`, hint "0–5 °C"), Yes/No toggles, tick checkboxes, text areas; client-side flagging using the same rules (import `flagResponse` from the shared core via relative path is fine for the web build? — no: copy-free approach: add `src/lib/whatsapp/flagging.ts` re-exporting from `../../../supabase/functions/_shared/checklists-core/flagging.ts`); when an answer is out of range show a required select of corrective actions + details under it.
- `MainButton` "Submit" enabled only when all required answered and every flagged has an action; on submit POST; on 200 show "Done ✓" and `WebApp.close()` after 1.5 s; on 400 show which items; on 410 "This form has expired — send /checks for a new one."; never shows other people's data.
- Outside Telegram (no initData) → "Open this form from Telegram."
- [ ] Steps: implement; `npx tsc` ≤ 3, eslint; manual check with the dev server is deferred to the pilot; commit `feat(telegram): Mini App checklist form page`.

---

### Task 9: Web — Telegram toggle, connect, badge

**Files:** Modify `src/lib/whatsapp/client.ts` (channel config `telegram: { label: 'Telegram', buildLink: (code) => \`https://t.me/BluerollChecksBot?start=${code}\` }`), the Team connect components (enable the Telegram channel when `business.telegram_enabled`), settings (a "Telegram checks" switch next to WhatsApp, same component pattern), checklist history badge `via Telegram` for `source === 'telegram'`, `Business.telegram_enabled?: boolean`.
- [ ] Steps: implement; tests for `buildLink`; tsc ≤ 3, eslint, npm test; commit `feat(web): Telegram connect, toggle and badge`.

---

### Task 10: Deploy, bot setup, pilot (STOP)

- [ ] **STOP — ask Kostya:** apply Task 1 migration; set secrets `TG_BOT_TOKEN` (from `~/Secrets/blueroll/telegram_checks_bot_token`), `TG_WEBHOOK_SECRET` (generate, save to `~/Secrets/blueroll/telegram_webhook_secret`); deploy `telegram-webhook`, `channel-form`, updated `whatsapp-reminders` (all `--no-verify-jwt`); run `setupBot` once (webhook `https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/telegram-webhook`, commands); BotFather: set the Mini App domain if required (`/setdomain` → `app.blueroll.app`), bot name/description/avatar.
- [ ] Apply the WhatsApp cron migration (`20261010120100`, vault secret) if not yet — reminders need it (Telegram works without WhatsApp secrets: functions must tolerate empty WA env).
- [ ] Pilot on «Fern & Fig» with Kostya's and Maria's Telegram: enable Telegram in Settings; connect via QR; `/checks` → Fill in → in-range submit; out-of-range with corrective → manager alert; reminder arrives 30 min before a deadline; `/stop`.
- [ ] PR → merge only on Kostya's "yes" (Vercel auto-deploys `main`).
