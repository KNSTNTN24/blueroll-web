// supabase/functions/whatsapp-sync-flows/index.ts
// Publishes one WhatsApp Flow per (checklist template, site) and records it in channel_flows.
//   - x-cron-secret (WA_CRON_SECRET): sync every active template of every WhatsApp-ready business;
//     body { corrective: true } instead creates + publishes the generic corrective Flow once and returns its id.
//   - user JWT of an active owner/manager + body { template_id }: sync that template for all its sites.
// Meta Flows API (developers.facebook.com/docs/whatsapp/flows/reference/flowsapi, checked 2026-10-09):
//   POST /{WABA}/flows {name, categories, flow_json(string)} → {id, success, validation_errors[]};
//   POST /{flow}/publish; POST /{flow}/deprecate; DELETE /{flow} (DRAFT only).
// Writes are optimistic CAS on (items_hash, flow_id); a replaced flow moves to prev_flow_id and the cron path
// deprecates it after 25h, so forms already sent in chats keep working. A failed republish keeps the last good flow.
// Never log the token or request headers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GRAPH_VERSION } from "../_shared/channels/whatsapp.ts";
import { buildChecklistFlow, CORRECTIVE_FLOW_JSON, itemsHash } from "../_shared/channels/whatsapp-flows.ts";
import type { TemplateItem } from "../_shared/checklists-core/types.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TOKEN = Deno.env.get("WA_TOKEN") ?? "";
const WABA = Deno.env.get("WA_WABA_ID") ?? "";
const CRON_SECRET = Deno.env.get("WA_CRON_SECRET") ?? "";
const G = `https://graph.facebook.com/${GRAPH_VERSION}`;
const CHANNEL = "whatsapp";
const ERROR_MAX = 300;
const NAME_MAX = 120;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Any = any;
interface TemplateRow { id: string; business_id: string; site_id: string | null; name: string }
interface SiteResult { site_id: string; status: "published" | "unchanged" | "unsupported" | "error"; flow_id?: string | null; error?: string }

const errMsg = (e: unknown) => String((e as Any)?.message ?? e).slice(0, ERROR_MAX);

// Constant-time compare: hash both sides so length differences don't short-circuit either.
async function secretMatches(given: string | null): Promise<boolean> {
  if (!CRON_SECRET || !given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(given)), crypto.subtle.digest("SHA-256", enc.encode(CRON_SECRET))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

class GraphError extends Error {}

// Graph error shape: { error: { message, error_user_title?, error_user_msg?, code, error_subcode?, error_data?, fbtrace_id } }.
function graphErrorText(status: number, j: Any): string {
  const e = j?.error;
  if (!e) return `graph ${status}`;
  const parts = [e.message, e.error_user_title, e.error_user_msg, typeof e.error_data === "string" ? e.error_data : e.error_data?.details]
    .filter((p, i, arr) => typeof p === "string" && p && arr.indexOf(p) === i);
  return `${parts.join(" — ") || `graph ${status}`}${e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})` : ""}`;
}

async function graph(path: string, init: RequestInit): Promise<Any> {
  const r = await fetch(`${G}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new GraphError(graphErrorText(r.status, j));
  return j;
}

// validation_errors: [{ error, error_type, message, line_start, …, pointers: [{ path }] }]
function validationText(errs: Any[]): string {
  return "Flow JSON invalid: " + errs.map((v) => {
    const where = (v?.pointers ?? []).map((p: Any) => p?.path).filter(Boolean).join(",");
    return `${v?.error ?? v?.error_type ?? "ERROR"}: ${v?.message ?? ""}${where ? ` @ ${where}` : ""}`;
  }).join("; ");
}

// Create (with flow_json) → check validation_errors → publish. A draft left behind by a failure is deleted.
// Names get a short unique suffix so a retry never collides with an earlier attempt.
async function publishFlow(name: string, flowJson: unknown): Promise<string> {
  if (!TOKEN || !WABA) throw new Error("WhatsApp is not configured (WA_TOKEN / WA_WABA_ID)");
  const suffix = ` · ${Date.now().toString(36)}`;
  const created = await graph(`/${WABA}/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.slice(0, NAME_MAX - suffix.length) + suffix, categories: ["OTHER"], flow_json: JSON.stringify(flowJson) }),
  });
  const id = created?.id as string | undefined;
  if (!id) throw new GraphError("Flow create returned no id");
  try {
    const errs = Array.isArray(created.validation_errors) ? created.validation_errors : [];
    if (errs.length) throw new GraphError(validationText(errs));
    const pub = await graph(`/${id}/publish`, { method: "POST" });
    if (pub?.success === false) throw new GraphError("Flow publish returned success=false");
    return id;
  } catch (e) {
    await graph(`/${id}`, { method: "DELETE" }).catch(() => console.error("whatsapp sync-flows: draft delete failed", id));
    throw e;
  }
}

// Best effort; true when Meta confirmed the deprecation.
async function deprecate(flowId: string): Promise<boolean> {
  try {
    const r = await graph(`/${flowId}/deprecate`, { method: "POST" });
    return r?.success !== false;
  } catch (e) {
    console.error("whatsapp sync-flows: deprecate failed", flowId, errMsg(e));
    return false;
  }
}

// A replaced flow stays live this long so forms already sent in chats (tokens live 24h) can still be submitted.
const PREV_GRACE_MS = 25 * 3600_000;
const isStale = (iso: string | null | undefined, now: number) => !!iso && Date.parse(iso) < now - PREV_GRACE_MS;

interface FlowRow {
  site_id: string; flow_id: string | null; items_hash: string; item_ids: string[]; status: string;
  prev_flow_id: string | null; prev_replaced_at: string | null;
}

/**
 * Optimistic compare-and-set on the channel_flows row. With a current row: update only if items_hash and flow_id are
 * still what we read. Without one: insert, a unique violation (23505) means another run inserted first.
 * Returns false when we lost the race.
 */
async function casWrite(templateId: string, siteId: string, cur: FlowRow | undefined, row: Record<string, unknown>): Promise<boolean> {
  const full = { ...row, updated_at: new Date().toISOString() };
  if (!cur) {
    const { error } = await admin.from("channel_flows").insert({ template_id: templateId, site_id: siteId, channel: CHANNEL, ...full });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw new Error(`channel_flows insert: ${error.message}`);
  }
  let q = admin.from("channel_flows").update(full)
    .eq("template_id", templateId).eq("site_id", siteId).eq("channel", CHANNEL).eq("items_hash", cur.items_hash);
  q = cur.flow_id === null ? q.is("flow_id", null) : q.eq("flow_id", cur.flow_id);
  const { data, error } = await q.select("template_id");
  if (error) throw new Error(`channel_flows update: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Moving away from cur.flow_id: it becomes prev_flow_id (deprecated later by the cron sweep). A prev older than the
 * grace period is returned for deprecation once the write succeeds; a younger prev that gets displaced is left
 * published (logged) rather than breaking forms sent minutes ago.
 */
function rotatePrev(cur: FlowRow | undefined, nextFlowId: string | null, now: number): { fields: Record<string, unknown>; toDeprecate: string | null } {
  if (!cur?.flow_id || cur.flow_id === nextFlowId) {
    return { fields: { prev_flow_id: cur?.prev_flow_id ?? null, prev_replaced_at: cur?.prev_replaced_at ?? null }, toDeprecate: null };
  }
  let toDeprecate: string | null = null;
  if (cur.prev_flow_id && cur.prev_flow_id !== cur.flow_id) {
    if (isStale(cur.prev_replaced_at, now)) toDeprecate = cur.prev_flow_id;
    else console.error("whatsapp sync-flows: displaced recent prev flow left published", cur.prev_flow_id);
  }
  return { fields: { prev_flow_id: cur.flow_id, prev_replaced_at: new Date(now).toISOString() }, toDeprecate };
}

async function syncTemplate(t: TemplateRow): Promise<SiteResult[]> {
  const [{ data: sites, error: sErr }, { data: items, error: iErr }, { data: curRows, error: cErr }] = await Promise.all([
    admin.from("sites").select("id, name, status").eq("business_id", t.business_id).is("removed_at", null),
    admin.from("checklist_template_items").select("id, name, item_type, required, min_value, max_value, unit, sort_order").eq("template_id", t.id),
    admin.from("channel_flows").select("site_id, flow_id, items_hash, item_ids, status, prev_flow_id, prev_replaced_at").eq("template_id", t.id).eq("channel", CHANNEL),
  ]);
  if (sErr || iErr || cErr) throw new Error(`load template ${t.id}: ${(sErr ?? iErr ?? cErr)!.message}`);
  const list = (items ?? []) as TemplateItem[];
  const built = buildChecklistFlow(t.name, list);
  const hash = built ? await itemsHash(t.name, list) : "unsupported";
  const current = new Map<string, FlowRow>((curRows ?? []).map((r: Any) => [r.site_id, r as FlowRow]));

  const results: SiteResult[] = [];
  for (const s of (sites ?? []).filter((s: Any) => s.status !== "removed" && (!t.site_id || t.site_id === s.id))) {
    const cur = current.get(s.id);
    const now = Date.now();
    try {
      if (!built) {
        if (cur?.status === "unsupported") { results.push({ site_id: s.id, status: "unsupported" }); continue; }
        const rot = rotatePrev(cur, null, now);
        const won = await casWrite(t.id, s.id, cur, { flow_id: null, items_hash: "unsupported", item_ids: [], status: "unsupported", error: null, ...rot.fields });
        if (!won) { results.push({ site_id: s.id, status: "unchanged" }); continue; }
        if (rot.toDeprecate) await deprecate(rot.toDeprecate);
        results.push({ site_id: s.id, status: "unsupported" });
        continue;
      }
      if (cur && cur.items_hash === hash && cur.status === "published" && cur.flow_id) {
        results.push({ site_id: s.id, status: "unchanged", flow_id: cur.flow_id });
        continue;
      }
      let flowId: string;
      try {
        flowId = await publishFlow(`${t.name} · ${s.name ?? ""} · ${hash.slice(0, 8)}`, built.json);
      } catch (e) {
        const error = errMsg(e);
        // Keep the last good flow live: a published row only gets the error recorded; 'error' only when nothing works.
        const keepLive = cur?.status === "published" && !!cur.flow_id;
        const row = keepLive
          ? { error }
          : { flow_id: cur?.flow_id ?? null, items_hash: cur?.items_hash ?? "error", item_ids: cur?.item_ids ?? [], status: "error", error };
        const won = await casWrite(t.id, s.id, cur, row);
        results.push(won
          ? { site_id: s.id, status: keepLive ? "published" : "error", flow_id: keepLive ? cur!.flow_id : null, error }
          : { site_id: s.id, status: "unchanged" });
        continue;
      }
      const rot = rotatePrev(cur, flowId, now);
      const won = await casWrite(t.id, s.id, cur, { flow_id: flowId, items_hash: hash, item_ids: built.itemIds, status: "published", error: null, ...rot.fields });
      if (!won) {
        // Another run updated the row first: our new flow is unused.
        await deprecate(flowId);
        results.push({ site_id: s.id, status: "unchanged" });
        continue;
      }
      if (rot.toDeprecate) await deprecate(rot.toDeprecate);
      results.push({ site_id: s.id, status: "published", flow_id: flowId });
    } catch (e) {
      console.error("whatsapp sync-flows: site sync failed", t.id, s.id, errMsg(e));
      results.push({ site_id: s.id, status: "error", error: errMsg(e) });
    }
  }
  return results;
}

// Cron: deprecate flows replaced more than the grace period ago, then clear prev_* (only if unchanged since read).
async function sweepPrevFlows(): Promise<{ deprecated: number; failed: number }> {
  const cutoff = new Date(Date.now() - PREV_GRACE_MS).toISOString();
  const { data, error } = await admin.from("channel_flows").select("template_id, site_id, channel, prev_flow_id")
    .not("prev_flow_id", "is", null).lt("prev_replaced_at", cutoff);
  if (error) throw new Error(`channel_flows prev query: ${error.message}`);
  let deprecated = 0, failed = 0;
  for (const r of (data ?? []) as Any[]) {
    if (!(await deprecate(r.prev_flow_id))) { failed++; continue; }
    const { error: uErr } = await admin.from("channel_flows").update({ prev_flow_id: null, prev_replaced_at: null })
      .eq("template_id", r.template_id).eq("site_id", r.site_id).eq("channel", r.channel).eq("prev_flow_id", r.prev_flow_id);
    if (uErr) { failed++; console.error("whatsapp sync-flows: prev clear failed", r.template_id, r.site_id, errMsg(uErr)); continue; }
    deprecated++;
  }
  return { deprecated, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });
  const parsed = await req.json().catch(() => null);
  const body: Any = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};

  if (req.headers.has("x-cron-secret")) {
    if (!(await secretMatches(req.headers.get("x-cron-secret")))) return json(403, { error: "forbidden" });
    if (body.corrective === true) {
      try {
        return json(200, { flow_id: await publishFlow("Blueroll corrective action", CORRECTIVE_FLOW_JSON) });
      } catch (e) {
        console.error("whatsapp sync-flows: corrective publish failed", errMsg(e));
        return json(502, { error: errMsg(e) });
      }
    }
    const { data: biz, error } = await admin.from("businesses").select("id").eq("whatsapp_enabled", true);
    if (error) { console.error("whatsapp sync-flows: businesses query failed", errMsg(error)); return json(500, { error: "businesses" }); }
    const out: { template_id: string; sites: SiteResult[] }[] = [];
    let failed = 0;
    let sweep: { deprecated: number; failed: number } | null = null;
    try {
      sweep = await sweepPrevFlows();
    } catch (e) {
      failed++;
      console.error("whatsapp sync-flows: prev sweep failed", errMsg(e));
    }
    for (const b of biz ?? []) {
      try {
        const { data: ready, error: rErr } = await admin.rpc("whatsapp_ready", { b: b.id });
        if (rErr) throw rErr;
        if (!ready) continue;
        const { data: ts, error: tErr } = await admin.from("checklist_templates").select("id, business_id, site_id, name").eq("business_id", b.id).eq("active", true);
        if (tErr) throw tErr;
        for (const t of (ts ?? []) as TemplateRow[]) {
          try {
            out.push({ template_id: t.id, sites: await syncTemplate(t) });
          } catch (e) {
            failed++;
            console.error("whatsapp sync-flows: template sync failed", t.id, errMsg(e));
          }
        }
      } catch (e) {
        failed++;
        console.error("whatsapp sync-flows: business sync failed", b.id, errMsg(e));
      }
    }
    return json(200, { ok: true, failed, sweep, templates: out });
  }

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "auth" });
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json(401, { error: "auth" });
  if (typeof body.template_id !== "string") return json(400, { error: "template_id" });
  const { data: me } = await admin.from("profiles").select("business_id, role").eq("id", u.user.id).is("removed_at", null).maybeSingle();
  if (!me?.business_id || !["owner", "manager"].includes(me.role)) return json(403, { error: "forbidden" });
  const { data: t } = await admin.from("checklist_templates").select("id, business_id, site_id, name, active")
    .eq("id", body.template_id).eq("business_id", me.business_id).maybeSingle();
  if (!t) return json(404, { error: "template" });
  if (!t.active) return json(200, { ok: true, skipped: "inactive", template_id: t.id, sites: [] });
  const { data: ready, error: rErr } = await admin.rpc("whatsapp_ready", { b: t.business_id });
  if (rErr) return json(500, { error: "ready" });
  if (!ready) return json(200, { ok: true, skipped: "not enabled", template_id: t.id, sites: [] });
  try {
    return json(200, { ok: true, template_id: t.id, sites: await syncTemplate(t as TemplateRow) });
  } catch (e) {
    console.error("whatsapp sync-flows: template sync failed", t.id, errMsg(e));
    return json(500, { error: "sync" });
  }
});
