import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function stripeGet(endpoint: string) {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return await res.json();
}

async function stripePost(
  endpoint: string,
  params: Record<string, string>
) {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, customerId, subscriptionId, businessId, userId, returnUrl } =
      await req.json();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Portal: open Stripe Customer Portal ──
    if (action === "portal") {
      if (!customerId) throw new Error("Missing customerId");

      const session = await stripePost("/billing_portal/sessions", {
        customer: customerId,
        return_url: returnUrl || "blueroll://billing-return",
      });

      return new Response(
        JSON.stringify({ portalUrl: session.url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Cancel: cancel subscription at period end ──
    if (action === "cancel") {
      if (!subscriptionId || !businessId)
        throw new Error("Missing subscriptionId or businessId");

      await stripePost(`/subscriptions/${subscriptionId}`, {
        cancel_at_period_end: "true",
      });

      await supabase
        .from("businesses")
        .update({ stripe_status: "canceling" })
        .eq("id", businessId);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Reactivate: undo cancel ──
    if (action === "reactivate") {
      if (!subscriptionId || !businessId)
        throw new Error("Missing subscriptionId or businessId");

      await stripePost(`/subscriptions/${subscriptionId}`, {
        cancel_at_period_end: "false",
      });

      // Fetch current status
      const sub = await stripeGet(`/subscriptions/${subscriptionId}`);

      await supabase
        .from("businesses")
        .update({ stripe_status: sub.status })
        .eq("id", businessId);

      return new Response(
        JSON.stringify({ success: true, status: sub.status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Sync: fetch latest status from Stripe ──
    if (action === "sync") {
      if (!customerId || !businessId)
        throw new Error("Missing customerId or businessId");

      // Get all subscriptions for this customer
      const subsRes = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${customerId}&limit=1`,
        { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } }
      );
      const subs = await subsRes.json();

      if (subs.data && subs.data.length > 0) {
        const sub = subs.data[0];
        const trialEnd = sub.trial_end
          ? new Date(sub.trial_end * 1000).toISOString()
          : null;

        await supabase
          .from("businesses")
          .update({
            subscription_id: sub.id,
            stripe_status: sub.cancel_at_period_end ? "canceling" : sub.status,
            stripe_until: trialEnd,
          })
          .eq("id", businessId);

        return new Response(
          JSON.stringify({
            status: sub.cancel_at_period_end ? "canceling" : sub.status,
            trialEnd,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ status: "none" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
