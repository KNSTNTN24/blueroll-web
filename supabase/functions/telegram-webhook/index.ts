// supabase/functions/telegram-webhook/index.ts
// Telegram Bot API webhook for the Blueroll checklists bot. Deployed with --no-verify-jwt; authenticity = secret-token header.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyWebhookSecret, parseUpdate, makeTelegramSender, answerCallback } from "../_shared/channels/telegram.ts";
import { telegramUI } from "../_shared/channels/ui.ts";
import { TG_MINI_APP_URL } from "../_shared/channels/alerts.ts";
import { makeSender } from "../_shared/channels/whatsapp.ts";
import { handleInbound } from "../_shared/channels/bot.ts";
import { makeDeps } from "../_shared/channels/db.ts";
import type { SendFn } from "../_shared/channels/types.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SECRET = Deno.env.get("TG_WEBHOOK_SECRET") ?? "";
const TOKEN = Deno.env.get("TG_BOT_TOKEN") ?? "";
const tgRaw = makeTelegramSender({ token: TOKEN });
// WhatsApp sender only when configured: manager alerts to WA-linked managers; the function works without any WA env.
const WA_TOKEN = Deno.env.get("WA_TOKEN") ?? "";
const WA_PHONE = Deno.env.get("WA_PHONE_NUMBER_ID") ?? "";
const waSend = WA_TOKEN && WA_PHONE ? makeSender({ token: WA_TOKEN, phoneNumberId: WA_PHONE }) : undefined;

// Per event (not module-level) so concurrent requests can't share the "callback answered" flag.
function depsFor() {
  const state = { callbackUsed: false };
  const tgSend: SendFn = (msg) => {
    if (typeof msg.callback_query_id === "string" && msg.callback_query_id) state.callbackUsed = true;   // makeTelegramSender answers it
    return tgRaw(msg);
  };
  const deps = makeDeps(admin, {
    channel: "telegram", ui: telegramUI(TG_MINI_APP_URL), send: tgSend,
    senders: { telegram: tgSend, ...(waSend ? { whatsapp: waSend } : {}) },
  });
  return { deps, state };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (!SECRET || !verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"), SECRET)) return new Response("forbidden", { status: 401 });
  const update = await req.json().catch(() => null);
  for (const e of parseUpdate(update)) {
    const { deps, state } = depsFor();
    try { await handleInbound(e, deps); }
    catch (err) { console.error("telegram inbound failed", (err as Error)?.message?.slice(0, 200)); }
    // e.g. duplicate delivery: no reply carried the callback id, so stop the button spinner ourselves.
    if (e.kind === "button" && e.callbackId && !state.callbackUsed) await answerCallback(TOKEN, e.callbackId);
  }
  return new Response("ok"); // always 200 once authenticated, so Telegram doesn't retry-storm
});
