// supabase/functions/reviews-action/index.ts
// Reviews page actions (publish / edit / another / skip / draft). manage_reviews only; verify_jwt = false, checked here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeTelegramApi } from "../_shared/channels/telegram.ts";
import { reviewsCaller } from "../_shared/reviews/caller.ts";
import { makeDrafter } from "../_shared/reviews/draft.ts";
import { makeGoogle } from "../_shared/reviews/google.ts";
import { makeReviewDeps } from "../_shared/reviews/reviews-db.ts";
import { handleReviewAction } from "../_shared/reviews/web-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
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
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const me = await reviewsCaller(admin, SUPABASE_URL, ANON, jwt);
    if (!me) return json(403, { error: "forbidden" });
    const r = await handleReviewAction(ctx, me, await req.json().catch(() => null));
    return json(r.status, r.body);
  } catch (err) {
    console.error("reviews-action failed", String((err as Error)?.message ?? err).slice(0, 200));
    return json(500, { error: "server" });
  }
});
