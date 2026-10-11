// Owner/manager creates a WhatsApp-only team member: no email login, no password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createChannelOnlyMember } from "../_shared/channels/members.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json(401, { error: "auth" });
  const { data: me } = await admin.from("profiles").select("business_id, role").eq("id", u.user.id).is("removed_at", null).maybeSingle();
  if (!me || !me.business_id || !["owner", "manager"].includes(me.role)) return json(403, { error: "forbidden" });
  const body = (await req.json().catch(() => null)) ?? {};
  if (typeof body !== "object" || Array.isArray(body)) return json(400, { error: "body" });
  if (typeof body.role_id !== "string" || typeof body.site_id !== "string") return json(400, { error: "ids" });
  const name = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 80) : "";
  if (!name) return json(400, { error: "name" });
  const { data: role } = await admin.from("roles").select("id, base_tier").eq("id", body.role_id).eq("business_id", me.business_id).maybeSingle();
  if (!role || role.base_tier === "owner") return json(400, { error: "role" });
  const { data: site } = await admin.from("sites").select("id").eq("id", body.site_id).eq("business_id", me.business_id).is("removed_at", null).maybeSingle();
  if (!site) return json(400, { error: "site" });

  const m = await createChannelOnlyMember(admin, {
    businessId: me.business_id, siteId: site.id, roleId: role.id, roleTier: role.base_tier, fullName: name, emailPrefix: "wa",
  });
  if (!m.ok) return json(500, { error: m.error });
  return json(200, { profile_id: m.profileId });
});
