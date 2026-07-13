import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SYNC_SECRET = Deno.env.get("SYNC_SITE_QUANTITY_SECRET")!;

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-sync-secret, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function stripeGet(path: string) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } });
  return await r.json();
}
async function stripePost(path: string, params: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if ((req.headers.get("x-sync-secret") ?? "") !== SYNC_SECRET) return json({ error: "unauthorized" }, 401);
    const { businessId } = await req.json();
    if (!businessId) return json({ error: "missing businessId" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: biz } = await admin.from("businesses").select("subscription_id").eq("id", businessId).single();
    if (!biz?.subscription_id) return json({ synced: false, reason: "no subscription" });

    const { data: qtyData } = await admin.rpc("billable_site_count", { p_business_id: businessId });
    const quantity = Number(qtyData ?? 1) || 1;

    // find the subscription's first item id
    const sub = await stripeGet(`/subscriptions/${biz.subscription_id}`);
    const itemId = sub?.items?.data?.[0]?.id;
    if (!itemId) return json({ synced: false, reason: "no subscription item" });

    await stripePost(`/subscription_items/${itemId}`, {
      quantity: String(quantity),
      proration_behavior: "create_prorations",
    });
    return json({ synced: true, quantity });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
