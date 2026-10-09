// supabase/functions/whatsapp-webhook/index.ts
// Meta webhook for the Blueroll WhatsApp bot. Deployed with --no-verify-jwt; authenticity = X-Hub-Signature-256.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySignature, parseInbound, makeSender } from "../_shared/channels/whatsapp.ts";
import { handleInbound } from "../_shared/channels/bot.ts";
import { makeDeps } from "../_shared/channels/db.ts";
import { maskPhone } from "../_shared/channels/mask.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const APP_SECRET = Deno.env.get("WA_APP_SECRET") ?? "";
const VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN") ?? "";
const send = makeSender({ token: Deno.env.get("WA_TOKEN") ?? "", phoneNumberId: Deno.env.get("WA_PHONE_NUMBER_ID") ?? "" });
const deps = makeDeps(admin, { send, correctiveFlowId: Deno.env.get("WA_CORRECTIVE_FLOW_ID") ?? "" });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && VERIFY_TOKEN !== "" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const raw = await req.text(); // exact bytes Meta signed — never re-serialise before verifying
  if (!APP_SECRET || !(await verifySignature(raw, req.headers.get("x-hub-signature-256"), APP_SECRET))) return new Response("bad signature", { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("ok"); }
  let events: ReturnType<typeof parseInbound> = [];
  try { events = parseInbound(body); } catch (err) { console.error("whatsapp parse failed", (err as Error).message?.slice(0, 200)); }
  for (const e of events) {
    try { await handleInbound(e, deps); }
    catch (err) { console.error("whatsapp inbound failed", maskPhone(e.from), (err as Error)?.message?.slice(0, 200)); }
  }
  return new Response("ok"); // always 200 to Meta once the signature is valid, so it doesn't retry storms
});
