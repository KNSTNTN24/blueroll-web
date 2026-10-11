// supabase/functions/telegram-webhook/index.ts
// Telegram Bot API webhook for @BluerollChecksBot — groups only (spec 2026-10-11). Deployed with --no-verify-jwt;
// authenticity = secret-token header. Always 200 once authenticated, so Telegram doesn't retry-storm.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeTelegramApi, parseGroupUpdate, verifyWebhookSecret } from "../_shared/channels/telegram.ts";
import { makeGroupDeps } from "../_shared/channels/groups-db.ts";
import { handleGroupEvent } from "../_shared/channels/tg-group-bot.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SECRET = Deno.env.get("TG_WEBHOOK_SECRET") ?? "";
const api = makeTelegramApi({ token: Deno.env.get("TG_BOT_TOKEN") ?? "" });
const deps = makeGroupDeps(admin, "telegram");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (!SECRET || !verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"), SECRET)) return new Response("forbidden", { status: 401 });
  const update = await req.json().catch(() => null);
  for (const e of parseGroupUpdate(update)) {
    try { await handleGroupEvent(e, deps, api); }
    catch (err) { console.error("telegram update failed", e.kind, String((err as Error)?.message ?? err).slice(0, 200)); }
  }
  return new Response("ok");
});
