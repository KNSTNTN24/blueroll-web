import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID") || "price_1TEVMUHaq4vjSIKeWZNDhuFg";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

class StripeError extends Error {
  endpoint: string;
  type?: string;
  code?: string;
  decline_code?: string;
  param?: string;
  constructor(endpoint: string, err: Record<string, string>) {
    super(err.message ?? "Unknown Stripe error");
    this.endpoint = endpoint;
    this.type = err.type;
    this.code = err.code;
    this.decline_code = err.decline_code;
    this.param = err.param;
  }
}

async function stripeRequest(
  endpoint: string,
  params: Record<string, string> | null,
  method: "GET" | "POST" = "POST",
) {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (params && method === "POST") {
    init.body = new URLSearchParams(params).toString();
  }
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, init);
  const data = await res.json();
  if (data.error) throw new StripeError(endpoint, data.error);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { userId, email, businessId, paymentMethodId } = body;

    if (!userId || !email || !businessId || !paymentMethodId) {
      throw new Error("Missing userId, email, businessId, or paymentMethodId");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: biz } = await supabase
      .from("businesses")
      .select("stripe_customer_id, subscription_status, subscription_id")
      .eq("id", businessId)
      .single();

    // Idempotency: if already on a paid plan, just succeed.
    if (
      biz?.subscription_status === "active" ||
      biz?.subscription_status === "trialing"
    ) {
      return new Response(
        JSON.stringify({ ok: true, alreadySubscribed: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let customerId = biz?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripeRequest("/customers", {
        email,
        "payment_method": paymentMethodId,
        "invoice_settings[default_payment_method]": paymentMethodId,
        "metadata[business_id]": businessId,
        "metadata[user_id]": userId,
      });
      customerId = customer.id;

      await supabase
        .from("businesses")
        .update({ stripe_customer_id: customerId })
        .eq("id", businessId);
    } else {
      // Existing customer: attach the new payment method and set as default.
      await stripeRequest(`/payment_methods/${paymentMethodId}/attach`, {
        customer: customerId,
      });
      await stripeRequest(`/customers/${customerId}`, {
        "invoice_settings[default_payment_method]": paymentMethodId,
      });
    }

    const subscription = await stripeRequest("/subscriptions", {
      customer: customerId,
      "items[0][price]": STRIPE_PRICE_ID,
      "trial_period_days": "14",
      "default_payment_method": paymentMethodId,
      "expand[0]": "pending_setup_intent",
    });

    const trialEndIso = subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    await supabase
      .from("businesses")
      .update({
        subscription_id: subscription.id,
        subscription_status: subscription.status, // "trialing" on success
        trial_ends_at: trialEndIso,
      })
      .eq("id", businessId);

    // SCA: if Stripe needs the cardholder to authenticate before the card can be
    // charged at trial end, surface the SetupIntent client_secret to the client.
    const setupIntent = subscription.pending_setup_intent;
    if (setupIntent && setupIntent.status === "requires_action") {
      return new Response(
        JSON.stringify({
          ok: true,
          requires_action: true,
          client_secret: setupIntent.client_secret,
          subscription_id: subscription.id,
          status: subscription.status,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        subscription_id: subscription.id,
        status: subscription.status,
        trial_ends_at: trialEndIso,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const e = err as StripeError | Error;
    console.error("create-subscription error:", e);
    const payload: Record<string, string> = { error: e.message };
    if (e instanceof StripeError) {
      payload.endpoint = e.endpoint;
      if (e.type) payload.type = e.type;
      if (e.code) payload.code = e.code;
      if (e.decline_code) payload.decline_code = e.decline_code;
      if (e.param) payload.param = e.param;
    }
    return new Response(
      JSON.stringify(payload),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
