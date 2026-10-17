// supabase/functions/telegram-reviews-webhook/index.ts
// Telegram webhook for @BluerollReviewsBot (spec §8). Deployed with --no-verify-jwt; authenticity = secret-token header.
// Always 200 once authenticated, so Telegram doesn't retry-storm. @BluerollChecksBot keeps its own function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeGroupDeps } from "../_shared/channels/groups-db.ts";
import { makeTelegramApi, verifyWebhookSecret } from "../_shared/channels/telegram.ts";
import { makeDrafter } from "../_shared/reviews/draft.ts";
import { makeGoogle } from "../_shared/reviews/google.ts";
import { makeReviewDeps } from "../_shared/reviews/reviews-db.ts";
import { handleReviewsEvent, parseReviewsUpdate } from "../_shared/reviews/tg-reviews-bot.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SECRET = Deno.env.get("TELEGRAM_REVIEWS_WEBHOOK_SECRET") ?? "";
const google = makeGoogle({
  clientId: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "", clientSecret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "",
  redirectUri: "https://app.blueroll.app/api/google/callback",
});
const ctx = {
  d: makeReviewDeps(admin, google), google,
  tg: makeTelegramApi({ token: Deno.env.get("TELEGRAM_REVIEWS_BOT_TOKEN") ?? "" }),
  draft: makeDrafter({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" }),
  appUrl: "https://app.blueroll.app",
};
const groups = makeGroupDeps(admin, "telegram_reviews");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (!SECRET || !verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"), SECRET)) return new Response("forbidden", { status: 401 });
  const update = await req.json().catch(() => null);
  for (const e of parseReviewsUpdate(update)) {
    try { await handleReviewsEvent(e, groups, ctx); }
    catch (err) { console.error("reviews update failed", e.kind, String((err as Error)?.message ?? err).slice(0, 200)); }
  }
  return new Response("ok");
});
