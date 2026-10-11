// supabase/functions/haccp-plan/index.ts
// HACCP Plan document data. Two ways in (rules in _shared/haccp-plan/handler.ts):
//   GET  ?t=<token>                      — inspector link or PDF render token (no Supabase user)
//   POST {site_id} + Authorization JWT   — a member of the business viewing their own plan
// Deploy with --no-verify-jwt: token callers have no JWT; member mode verifies the JWT itself.
// CORS: https://app.blueroll.app, http://localhost:3001, plus PLAN_EXTRA_ORIGINS (comma-separated).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideAccess, handlePlanRequest, type HandlerDeps } from "../_shared/haccp-plan/handler.ts";
import { loadBundle } from "../_shared/haccp-plan/load.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const ALLOWED_ORIGINS = new Set([
  "https://app.blueroll.app",
  "http://localhost:3001",
  ...(Deno.env.get("PLAN_EXTRA_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);
const MAX_BODY = 4 * 1024;

function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { "Vary": "Origin" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Authorization, Content-Type, apikey, x-client-info";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const deps: HandlerDeps = {
  now: () => new Date(),
  sha256Hex,
  findShare: async (hash) => {
    const { data, error } = await admin.from("haccp_plan_shares")
      .select("id, business_id, site_id, kind, expires_at, revoked_at, view_count").eq("token_hash", hash).maybeSingle();
    if (error) throw error;
    return data;
  },
  bumpShare: async (id) => {
    const { data } = await admin.from("haccp_plan_shares").select("view_count").eq("id", id).maybeSingle();
    await admin.from("haccp_plan_shares")
      .update({ view_count: (data?.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() }).eq("id", id);
  },
  getUserId: async (jwt) => {
    const { data, error } = await admin.auth.getUser(jwt);
    return error || !data.user ? null : data.user.id;
  },
  memberAccess: async (userId, siteId) => {
    const { data: p } = await admin.from("profiles")
      .select("business_id, role, removed_at, is_group_admin").eq("id", userId).maybeSingle();
    if (!p?.business_id) return "forbidden";
    const { data: biz } = await admin.from("businesses").select("id").eq("id", p.business_id).is("deleted_at", null).maybeSingle();
    if (!biz) return "forbidden";
    let site: { id: string; inBusiness: boolean } | null = null;
    if (siteId) {
      const { data: s } = await admin.from("sites").select("id").eq("id", siteId).eq("business_id", p.business_id).maybeSingle();
      site = { id: siteId, inBusiness: !!s };
    }
    const { data: ms } = await admin.from("member_sites").select("site_id").eq("profile_id", userId);
    return decideAccess(p, site, (ms ?? []).map((r: { site_id: string }) => r.site_id));
  },
  loadBundle: (businessId, siteId) => loadBundle(admin, businessId, siteId, new Date()),
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const h = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "GET" && req.method !== "POST") return new Response(null, { status: 405, headers: h });

  const url = new URL(req.url);
  let siteId: string | null | undefined = undefined;
  if (req.method === "POST") {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY) return new Response(null, { status: 413, headers: h });
    try {
      const body = await req.json();
      siteId = typeof body?.site_id === "string" ? body.site_id : null;
    } catch {
      siteId = null;
    }
  }
  const r = await handlePlanRequest({
    method: req.method,
    token: req.method === "GET" ? url.searchParams.get("t") ?? "" : null,
    check: url.searchParams.get("check") === "1",
    authorization: req.headers.get("Authorization"),
    siteId,
  }, deps);
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
});
