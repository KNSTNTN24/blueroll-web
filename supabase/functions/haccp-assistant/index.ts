// «Set up my HACCP» assistant: parse free-text equipment, answer questions from the bundled knowledge base.
// Deployed with --no-verify-jwt (project convention); the user JWT is verified here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CURATED_KNOWLEDGE, mergeKnowledge } from "../_shared/knowledge.ts";
import { SFBB_KNOWLEDGE } from "../_shared/knowledge-sfbb.ts";
import { searchKnowledge } from "../_shared/knowledge-search.ts";
import {
  buildAnswerRequest, buildEquipmentRequest, FALLBACK_ANSWER, notesForPrompt, parseAnswerResponse, parseEquipmentResponse, usageOf,
} from "../_shared/assistant-core.ts";

// Curated Blueroll notes first (reviewed wording), then the full FSA SFBB for caterers pack.
const KNOWLEDGE = mergeKnowledge(CURATED_KNOWLEDGE, SFBB_KNOWLEDGE);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("HACCP_ASSISTANT_ANTHROPIC_KEY") ?? "";
const DAILY_LIMIT = 30;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "auth" });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: "auth" });

  const { data: profile } = await admin.from("profiles").select("business_id, role").eq("id", userData.user.id).single();
  if (!profile?.business_id || !["owner", "manager"].includes(profile.role)) return json(403, { error: "forbidden" });

  let body: { action?: string; text?: string; question?: string; venue_type?: string };
  try { body = await req.json(); } catch { return json(400, { error: "body" }); }
  if (!body || typeof body !== "object") return json(400, { error: "body" });
  if (body.action === "parse_equipment" && !(typeof body.text === "string" && body.text.trim())) return json(400, { error: "text" });
  if (body.action === "answer" && !(typeof body.question === "string" && body.question.trim())) return json(400, { error: "question" });
  if (body.action !== "parse_equipment" && body.action !== "answer") return json(400, { error: "action" });

  // An answer with no matching knowledge never reaches the model (and costs nothing).
  let chunks = [] as ReturnType<typeof searchKnowledge>;
  if (body.action === "answer") {
    chunks = notesForPrompt(searchKnowledge(KNOWLEDGE, body.question!, 4));
    if (!chunks.length) return json(200, { answer: FALLBACK_ANSWER, sources: [] });
  }
  if (!ANTHROPIC_KEY) return json(502, { error: "model" });

  // Reserve a usage slot first (fail closed), so parallel requests and failed paid calls still count.
  const { data: reservation, error: resErr } = await admin.from("ai_usage_log")
    .insert({ business_id: profile.business_id, fn: body.action, input_tokens: 0, output_tokens: 0 })
    .select("id").single();
  if (resErr || !reservation) return json(503, { error: "limit_check" });
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: countErr } = await admin.from("ai_usage_log").select("id", { count: "exact", head: true })
    .eq("business_id", profile.business_id).gte("created_at", since);
  if (countErr || count === null) {
    await admin.from("ai_usage_log").delete().eq("id", reservation.id);
    return json(503, { error: "limit_check" });
  }
  if (count > DAILY_LIMIT) {
    await admin.from("ai_usage_log").delete().eq("id", reservation.id);
    return json(429, { error: "limit" });
  }

  const request = body.action === "parse_equipment"
    ? buildEquipmentRequest(body.text!)
    : buildAnswerRequest(body.question!, chunks, typeof body.venue_type === "string" ? body.venue_type.slice(0, 40) : undefined);

  let resp: unknown;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) {
      console.error("anthropic status", r.status); // never log the key or the user text
      return json(502, { error: "model" });
    }
    resp = await r.json();
  } catch (e) {
    console.error("anthropic error", (e as Error).name);
    return json(502, { error: "model" });
  }

  const usage = usageOf(resp);
  const { error: updErr } = await admin.from("ai_usage_log")
    .update({ input_tokens: usage.input, output_tokens: usage.output }).eq("id", reservation.id);
  if (updErr) console.error("usage update failed", updErr.code);

  return body.action === "parse_equipment"
    ? json(200, { equipment: parseEquipmentResponse(resp) })
    : json(200, parseAnswerResponse(resp, chunks));
});
