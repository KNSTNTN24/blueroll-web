// supabase/functions/google-connect/index.ts
// Settings → Google reviews: start OAuth, finish it (called by the Next route /api/google/callback, authorised by the
// single-use state), disconnect, re-read locations, sync now. verify_jwt = false (config.toml): every action except
// 'finish' checks the caller's JWT and manage_reviews here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeTelegramApi } from "../_shared/channels/telegram.ts";
import { refreshBusinessCards } from "../_shared/reviews/actions.ts";
import { reviewsCaller } from "../_shared/reviews/caller.ts";
import { handleConnect } from "../_shared/reviews/connect.ts";
import { makeDrafter } from "../_shared/reviews/draft.ts";
import { makeGoogle } from "../_shared/reviews/google.ts";
import { makeConnectDeps, makeReviewDeps } from "../_shared/reviews/reviews-db.ts";
import { runSync } from "../_shared/reviews/sync.ts";

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
const deps = makeConnectDeps(admin, (b) => refreshBusinessCards(ctx, b));
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });
  try {
    const body = await req.json().catch(() => null);
    if (body?.action === "finish") { const r = await handleConnect(deps, google, null, body); return json(r.status, r.body); }
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const me = await reviewsCaller(admin, SUPABASE_URL, ANON, jwt);
    if (!me) return json(403, { error: "forbidden" });
    if (body?.action === "sync_now") {
      if (!(await ctx.d.entitled(me.business_id))) return json(409, { error: "not_entitled" });
      return json(200, await runSync(ctx, me.business_id));
    }
    const r = await handleConnect(deps, google, me, body);
    return json(r.status, r.body);
  } catch (err) {
    console.error("google-connect failed", String((err as Error)?.message ?? err).slice(0, 200));
    return json(500, { error: "server" });
  }
});
