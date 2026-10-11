// supabase/functions/channel-form/index.ts
// Telegram Mini App form API for group checklists: GET (header X-Form-Token, or ?t=<token>) → form JSON;
// POST {t, answers, corrective} → record. Deploy with --no-verify-jwt: callers are Telegram users, not Supabase users.
// Authenticity = the Mini App's signed initData (header X-Telegram-Init-Data, HMAC with TG_BOT_TOKEN) + a live group
// token + current membership of that group (getChatMember); all rules in _shared/channels/form-api.ts.
// CORS: https://app.blueroll.app and http://localhost:3001 (dev) only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleFormGet, handleFormPost, type FormApiDeps } from "../_shared/channels/form-api.ts";
import { makeTelegramApi, verifyInitData } from "../_shared/channels/telegram.ts";
import { makeSender } from "../_shared/channels/whatsapp.ts";
import { alertManagers, makeAlertDeps } from "../_shared/channels/alerts.ts";
import { makeGroupDeps } from "../_shared/channels/groups-db.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("TG_BOT_TOKEN") ?? "";
// WhatsApp sender only when configured: alerts to WhatsApp-linked managers; the function works without any WA env.
const WA_TOKEN = Deno.env.get("WA_TOKEN") ?? "";
const WA_PHONE = Deno.env.get("WA_PHONE_NUMBER_ID") ?? "";
const waSend = WA_TOKEN && WA_PHONE ? makeSender({ token: WA_TOKEN, phoneNumberId: WA_PHONE }) : undefined;

const ALLOWED_ORIGINS = new Set(["https://app.blueroll.app", "http://localhost:3001"]);
const MAX_BODY = 64 * 1024;

const alertDeps = makeAlertDeps(admin);
const deps: FormApiDeps = {
  g: makeGroupDeps(admin, "telegram"),
  api: makeTelegramApi({ token: TOKEN }),
  verifyInitData: (s) => (TOKEN ? verifyInitData(s, TOKEN, new Date()) : Promise.resolve(null)),
  alertManagers: (b, a) => (waSend ? alertManagers(alertDeps, { whatsapp: waSend }, b, a, new Date()) : Promise.resolve()),
};

function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { "Vary": "Origin" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type, X-Telegram-Init-Data, X-Form-Token";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

const json = (status: number, body: unknown, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function readBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return { ok: false, status: 413 };
  if (!req.body) return { ok: true, body: null };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); return { ok: false, status: 413 }; }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  try { return { ok: true, body: JSON.parse(new TextDecoder().decode(buf)) }; }
  catch { return { ok: true, body: null }; }   // malformed JSON → handler answers 400 (after initData check)
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  const initData = req.headers.get("x-telegram-init-data") ?? "";
  try {
    if (req.method === "GET") {
      // Token preferably in a header (kept out of URLs/logs); ?t= stays as a fallback.
      const t = req.headers.get("x-form-token") || new URL(req.url).searchParams.get("t") || "";
      const r = await handleFormGet(deps, t, initData);
      return json(r.status, r.body, h);
    }
    if (req.method === "POST") {
      const b = await readBody(req);
      if (!b.ok) return json(b.status, { error: "too_large" }, h);
      const r = await handleFormPost(deps, b.body, initData);
      return json(r.status, r.body, h);
    }
    return json(405, { error: "method" }, h);
  } catch (err) {
    console.error("channel-form failed", String((err as Error)?.message ?? err).slice(0, 200));
    return json(500, { error: "server" }, h);
  }
});
