// Owner/manager creates a WhatsApp-only team member: no email login, no password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const body = await req.json().catch(() => ({}));
  const name = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 80) : "";
  if (!name) return json(400, { error: "name" });
  const { data: role } = await admin.from("roles").select("id, base_tier").eq("id", body.role_id).eq("business_id", me.business_id).maybeSingle();
  if (!role || role.base_tier === "owner") return json(400, { error: "role" });
  const { data: site } = await admin.from("sites").select("id").eq("id", body.site_id).eq("business_id", me.business_id).is("removed_at", null).maybeSingle();
  if (!site) return json(400, { error: "site" });

  // Synthetic address: never logged, never used for login (no password set).
  const email = `wa+${crypto.randomUUID()}@noreply.blueroll.app`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, app_metadata: { channel_only: true }, user_metadata: { full_name: name },
  });
  if (error || !created.user) return json(500, { error: "create" });
  const pid = created.user.id;

  // No trigger on auth.users creates a profile (only the ntfy notifier), so INSERT, as join_with_invite does.
  const { error: pErr } = await admin.from("profiles").insert({
    id: pid, email, full_name: name, role: role.base_tier, role_id: role.id, business_id: me.business_id, site_id: site.id,
  });
  if (pErr) { await admin.auth.admin.deleteUser(pid); return json(500, { error: "profile" }); }
  const { error: mErr } = await admin.from("member_sites").upsert({ profile_id: pid, site_id: site.id }, { onConflict: "profile_id,site_id", ignoreDuplicates: true });
  if (mErr) {
    await admin.from("profiles").delete().eq("id", pid);
    await admin.auth.admin.deleteUser(pid);
    return json(500, { error: "membership" });
  }
  return json(200, { profile_id: pid });
});
