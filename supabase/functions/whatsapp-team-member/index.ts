// supabase/functions/whatsapp-team-member/index.ts
// Settings → Messaging → WhatsApp teams: add a person to a team (sends the team_invite template) or resend an invite.
// Owners/managers only. Sending a template needs the server-side WhatsApp token, so this can't run in the browser.
// Deployed with --no-verify-jwt like team-create-channel-member; the caller's JWT is checked here. Never logs phone numbers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeSender } from "../_shared/channels/whatsapp.ts";
import { makeTeamDeps } from "../_shared/channels/teams-db.ts";
import { handleTeamMemberRequest } from "../_shared/channels/team-api.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const send = makeSender({ token: Deno.env.get("WA_TOKEN") ?? "", phoneNumberId: Deno.env.get("WA_PHONE_NUMBER_ID") ?? "" });
const teams = makeTeamDeps(admin);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "auth" });
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json(401, { error: "auth" });
  // The business comes from the caller's own profile, never from the request; team-api checks owner/manager.
  const { data: me } = await admin.from("profiles").select("business_id").eq("id", u.user.id).is("removed_at", null).maybeSingle();
  if (!me?.business_id) return json(403, { error: "forbidden" });
  const body = await req.json().catch(() => null);
  try {
    const r = await handleTeamMemberRequest(teams, send, { profile_id: u.user.id, business_id: me.business_id }, body);
    return json(r.status, r.body);
  } catch (err) {
    console.error("whatsapp-team-member failed", String((err as Error)?.message ?? err).slice(0, 200));
    return json(500, { error: "server" });
  }
});
