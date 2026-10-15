// supabase/functions/google-reviews-sync/index.ts
// pg_cron every 15 min (migration 20261015120100): sync every active connection, warn open reviews groups once a day,
// revoke tokens of deleted businesses, clean up. Auth = x-cron-secret (REVIEWS_CRON_SECRET = vault reviews_cron_secret).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeGroupDeps } from "../_shared/channels/groups-db.ts";
import { makeTelegramApi, verifyWebhookSecret } from "../_shared/channels/telegram.ts";
import { makeDrafter } from "../_shared/reviews/draft.ts";
import { makeGoogle } from "../_shared/reviews/google.ts";
import { makeReviewDeps } from "../_shared/reviews/reviews-db.ts";
import { housekeeping, runSync } from "../_shared/reviews/sync.ts";
import { checkReviewGroupPermissions } from "../_shared/reviews/tg-reviews-bot.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CRON_SECRET = Deno.env.get("REVIEWS_CRON_SECRET") ?? "";
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
const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (!CRON_SECRET || !verifyWebhookSecret(req.headers.get("x-cron-secret"), CRON_SECRET)) return new Response("forbidden", { status: 401 });
  const out: Record<string, unknown> = {};
  try { out.sync = await runSync(ctx); } catch (e) { console.error("reviews sync run failed", msg(e)); }
  try {
    const now = new Date();
    for (const g of await groups.linkedGroups()) {
      if (await groups.claimPermissionCheck(g.id, now)) await checkReviewGroupPermissions(groups, ctx, g, now);
    }
  } catch (e) { console.error("reviews group checks failed", msg(e)); }
  try { await housekeeping(ctx); } catch (e) { console.error("reviews housekeeping failed", msg(e)); }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
