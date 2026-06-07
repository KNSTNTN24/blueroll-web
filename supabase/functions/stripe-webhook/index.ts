// Stripe webhook handler — keeps businesses.subscription_status in sync with Stripe.
//
// Configure:
//   1. Stripe Dashboard → Developers → Webhooks → Add endpoint
//      URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//      Events: customer.subscription.created, customer.subscription.updated,
//              customer.subscription.deleted
//   2. Copy the signing secret (starts with `whsec_`) into Supabase secrets
//      as STRIPE_WEBHOOK_SECRET.
//   3. Deploy with: supabase functions deploy stripe-webhook --no-verify-jwt
//      (Stripe sends requests without a Supabase JWT.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Tolerance for the timestamp embedded in the Stripe-Signature header.
// Stripe's default is 300 seconds; anything older is treated as a replay attack.
const TOLERANCE_SECONDS = 300;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Stripe signature verification ─────────────────────────────────────────────
// Reimplements stripe.webhooks.constructEvent without pulling in the Stripe SDK
// (the rest of this project uses raw fetch against the Stripe REST API).

function parseSignatureHeader(header: string): { t: string; v1: string[] } {
  const parts = header.split(",").map((p) => p.trim());
  let t = "";
  const v1: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (k === "t") t = v;
    if (k === "v1") v1.push(v);
  }
  return { t, v1 };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<void> {
  const { t, v1 } = parseSignatureHeader(signatureHeader);
  if (!t || v1.length === 0) {
    throw new Error("Malformed Stripe-Signature header");
  }

  const age = Math.floor(Date.now() / 1000) - parseInt(t, 10);
  if (age > TOLERANCE_SECONDS) {
    throw new Error(`Signature timestamp is too old (${age}s)`);
  }

  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  const match = v1.some((sig) => timingSafeEqual(sig, expected));
  if (!match) {
    throw new Error("Stripe signature mismatch");
  }
}

// ─── Stripe subscription → businesses row ──────────────────────────────────────

interface StripeSubscription {
  id: string;
  customer: string;
  status: string; // trialing | active | past_due | canceled | unpaid | incomplete | incomplete_expired
  cancel_at_period_end: boolean;
  trial_end: number | null;
}

function subscriptionUpdatePayload(sub: StripeSubscription) {
  return {
    subscription_id: sub.id,
    // Stripe's view only. The DB arbiter (trg_zz_subscription_arbiter) computes
    // subscription_status/trial_ends_at from all sources; it publishes a live
    // 'canceling' as 'active' so paid users keep access until period end.
    stripe_status: sub.cancel_at_period_end ? "canceling" : sub.status,
    stripe_until: sub.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : null,
  };
}

async function applySubscriptionEvent(
  sub: StripeSubscription,
  eventType: string,
) {
  // For deleted subscriptions Stripe sends the final state in `data.object`
  // with status='canceled'. We don't special-case it — same UPDATE path.
  const payload = subscriptionUpdatePayload(sub);

  const { data, error } = await supabase
    .from("businesses")
    .update(payload)
    .eq("stripe_customer_id", sub.customer)
    .select("id");

  if (error) {
    throw new Error(`Supabase update failed: ${error.message}`);
  }

  // If no row was found for this customer, log it and return — don't 500,
  // otherwise Stripe will keep retrying for a customer we don't track.
  if (!data || data.length === 0) {
    console.warn(
      `${eventType}: no business found for stripe_customer_id=${sub.customer}`,
    );
    return { matched: 0 };
  }

  return { matched: data.length, businessId: data[0].id };
}

// ─── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET not set");
    return new Response("Server misconfigured", { status: 500 });
  }

  const signatureHeader = req.headers.get("stripe-signature");
  if (!signatureHeader) {
    return new Response("Missing Stripe-Signature header", { status: 400 });
  }

  const rawBody = await req.text();

  try {
    await verifyStripeSignature(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  let event: { id: string; type: string; data: { object: unknown } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as StripeSubscription;
        const result = await applySubscriptionEvent(sub, event.type);
        console.log(
          `${event.type} event=${event.id} customer=${sub.customer} status=${sub.status} canceling=${sub.cancel_at_period_end} matched_rows=${result.matched}`,
        );
        break;
      }

      // The two invoice events below are not strictly required — subscription
      // status changes are already captured via customer.subscription.updated.
      // We still acknowledge them with 200 so Stripe stops retrying if they
      // were accidentally enabled in the dashboard.
      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
        console.log(`${event.type} event=${event.id} (acknowledged, no-op)`);
        break;

      default:
        // Unknown event types are also fine — 200 OK so Stripe drops them.
        console.log(`Ignored event type: ${event.type} event=${event.id}`);
        break;
    }
  } catch (err) {
    // Returning 500 makes Stripe retry. That's the desired behavior for
    // transient DB failures.
    console.error(`Failed to handle ${event.type} event=${event.id}:`, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
