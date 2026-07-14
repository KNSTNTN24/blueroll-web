import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

    // ── Auth + ownership guard ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await asUser.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: prof } = await admin
      .from("profiles")
      .select("role, business_id")
      .eq("id", user.id)
      .single();

    let targetBiz = businessId as string | undefined;
    if (!targetBiz && customerId) {
      const { data: b } = await admin
        .from("businesses")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .single();
      targetBiz = b?.id;
    }

    if (!prof || prof.role !== "owner" || !targetBiz || prof.business_id !== targetBiz) {
      return json({ error: "Not authorized for this business" }, 403);
    }

    const supabase = admin;

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

    // ── Payment method: return the customer's default card (brand + last4) ──
    if (action === "payment-method") {
      if (!customerId) throw new Error("Missing customerId");
      const cust = await stripeGet(
        `/customers/${customerId}?expand[]=invoice_settings.default_payment_method`
      );
      let pm = cust?.invoice_settings?.default_payment_method;
      // Fallback: first attached card if no explicit default is set.
      if (!pm || typeof pm === "string" || !pm.card) {
        const list = await stripeGet(
          `/customers/${customerId}/payment_methods?type=card&limit=1`
        );
        pm = list?.data?.[0];
      }
      const card = pm?.card
        ? {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          }
        : null;
      return json({ card });
    }

    // ── Subscription: real pricing from Stripe (price, quantity, status,
    //    and the upcoming invoice's real subtotal / tax / total / next date) ──
    if (action === "subscription") {
      if (!customerId) throw new Error("Missing customerId");
      const subs = await stripeGet(
        `/subscriptions?customer=${customerId}&limit=1`
      );
      const sub = subs?.data?.[0];
      if (!sub) return json({ subscription: null });
      const item = sub.items?.data?.[0];
      const price = item?.price;

      let invoice = null;
      try {
        const up = await stripeGet(`/invoices/upcoming?customer=${customerId}`);
        if (up && !up.error) {
          invoice = {
            subtotal: up.subtotal ?? null,
            tax: up.tax ?? 0,
            total: up.total ?? null,
            currency: up.currency ?? null,
            nextPaymentDate: up.next_payment_attempt
              ? new Date(up.next_payment_attempt * 1000).toISOString()
              : up.period_end
              ? new Date(up.period_end * 1000).toISOString()
              : null,
          };
        }
      } catch (_) {
        // upcoming invoice can 404 for some states — pricing below still works
      }

      return json({
        subscription: {
          status: sub.status, // trialing | active | past_due | canceled | unpaid
          cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
          trialEnd: sub.trial_end
            ? new Date(sub.trial_end * 1000).toISOString()
            : null,
          currentPeriodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
          quantity: item?.quantity ?? null,
          unitAmount: price?.unit_amount ?? null, // minor units (pence)
          currency: price?.currency ?? sub.currency ?? null,
          interval: price?.recurring?.interval ?? null,
          invoice,
        },
      });
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
