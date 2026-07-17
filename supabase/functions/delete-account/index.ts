import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    // 1. Identify the caller from their JWT (not from the body).
    const asUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await asUser.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const { businessId } = await req.json();
    if (!businessId) return json({ error: "Missing businessId" }, 400);

    // 2. Verify from the DB that the caller is the OWNER of this business.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: profile } = await admin
      .from("profiles").select("role, business_id").eq("id", user.id).single();
    if (!profile || profile.role !== "owner" || profile.business_id !== businessId) {
      return json({ error: "Only the business owner can delete this business" }, 403);
    }

    // 3. Cancel Stripe subscription if any (best-effort).
    const { data: biz } = await admin
      .from("businesses").select("subscription_id").eq("id", businessId).single();
    if (biz?.subscription_id) {
      try {
        await fetch(`https://api.stripe.com/v1/subscriptions/${biz.subscription_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
        });
      } catch (_) { /* already cancelled / no-op */ }
    }

    // 4. SOFT delete — mark deleted; the daily cron purges after 30 days.
    const { error: updErr } = await admin
      .from("businesses").update({ deleted_at: new Date().toISOString() }).eq("id", businessId);
    if (updErr) return json({ error: updErr.message }, 400);

    return json({ success: true });
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});
