// Google Play Real-Time Developer Notifications handler.
//
// Configure (one-time):
//   1. Google Cloud → Pub/Sub → create topic (e.g. play-rtdn-blueroll).
//      Grant google-play-developer-notifications@system.gserviceaccount.com
//      the Pub/Sub Publisher role on it.
//   2. Google Play Console → Monetization setup → Real-time developer notifications
//      → set topic to projects/<gcp-project>/topics/play-rtdn-blueroll.
//   3. Google Cloud → Pub/Sub → create push subscription on that topic, push
//      endpoint = https://<supabase-ref>.supabase.co/functions/v1/play-webhook,
//      enable authentication with the same service account that has Play
//      Developer API access. Leave audience empty (defaults to the endpoint URL).
//   4. Supabase secrets:
//        - GOOGLE_PLAY_SERVICE_ACCOUNT_JSON   (full service-account JSON, one line)
//        - GOOGLE_PLAY_PACKAGE_NAME           (e.g. app.blueroll.mobile)
//        - GOOGLE_PLAY_PUBSUB_AUDIENCE        (the push-endpoint URL, used to verify
//                                              the OIDC token Pub/Sub sends)
//        - GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT (the service account email Pub/Sub
//                                              signs the JWT with)
//   5. Deploy: supabase functions deploy play-webhook --no-verify-jwt
//
// What it does on each notification:
//   - Verifies the OIDC token Pub/Sub puts in Authorization: Bearer <jwt>.
//     Confirms the issuer is Google, the audience matches our endpoint, and
//     the signer email matches the configured service account.
//   - Decodes the base64 payload into a DeveloperNotification.
//   - For subscriptionNotification events, fetches the full subscription
//     state from the Android Publisher API (purchases.subscriptionsv2.get).
//   - Maps Google's subscription state to the same status vocabulary we use
//     for Stripe so the existing paywall reads it without changes.
//   - Updates the matching businesses row, located via iap_purchase_token
//     (if we've seen this token before, e.g. from record_iap_purchase RPC)
//     or via externalAccountIdentifiers.obfuscatedExternalAccountId (the
//     business_id we attach at buy() time on the mobile side).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
} from "https://esm.sh/jose@5.9.6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_ACCOUNT_JSON = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
const PACKAGE_NAME = Deno.env.get("GOOGLE_PLAY_PACKAGE_NAME");
const PUBSUB_AUDIENCE = Deno.env.get("GOOGLE_PLAY_PUBSUB_AUDIENCE");
const PUBSUB_SERVICE_ACCOUNT = Deno.env.get(
  "GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT",
);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Google's OIDC public keys for verifying the Pub/Sub-issued token.
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

// ─── Types from Google ─────────────────────────────────────────────────────────

interface PubSubPushMessage {
  message: {
    data: string; // base64-encoded DeveloperNotification JSON
    messageId: string;
    publishTime: string;
    attributes?: Record<string, string>;
  };
  subscription: string;
}

// https://developer.android.com/google/play/billing/rtdn-reference
interface DeveloperNotification {
  version: string;
  packageName: string;
  eventTimeMillis: string;
  subscriptionNotification?: {
    version: string;
    notificationType: number;
    purchaseToken: string;
    subscriptionId: string;
  };
  oneTimeProductNotification?: unknown;
  voidedPurchaseNotification?: unknown;
  testNotification?: { version: string };
}

// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get
interface SubscriptionPurchaseV2 {
  kind: string;
  regionCode: string;
  lineItems: Array<{
    productId: string;
    expiryTime: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
  }>;
  startTime?: string;
  subscriptionState: string;
  latestOrderId?: string;
  externalAccountIdentifiers?: {
    externalAccountId?: string;
    obfuscatedExternalAccountId?: string;
    obfuscatedExternalProfileId?: string;
  };
  testPurchase?: Record<string, unknown>;
}

// ─── OIDC token verification ───────────────────────────────────────────────────

async function verifyPubSubToken(authHeader: string): Promise<void> {
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Bearer prefix");
  }
  const token = authHeader.slice("Bearer ".length).trim();

  if (!PUBSUB_AUDIENCE) {
    throw new Error("GOOGLE_PLAY_PUBSUB_AUDIENCE not configured");
  }
  if (!PUBSUB_SERVICE_ACCOUNT) {
    throw new Error("GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT not configured");
  }

  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: ["accounts.google.com", "https://accounts.google.com"],
    audience: PUBSUB_AUDIENCE,
  });

  if (payload.email !== PUBSUB_SERVICE_ACCOUNT) {
    throw new Error(
      `Token signer ${payload.email} does not match expected ${PUBSUB_SERVICE_ACCOUNT}`,
    );
  }
  if (payload.email_verified !== true) {
    throw new Error("Token email not verified");
  }
}

// ─── Android Publisher API ─────────────────────────────────────────────────────

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getPlayApiAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  if (!SERVICE_ACCOUNT_JSON) {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not configured");
  }
  const key: ServiceAccountKey = JSON.parse(SERVICE_ACCOUNT_JSON);
  const tokenUri = key.token_uri ?? "https://oauth2.googleapis.com/token";

  const privateKey = await importPKCS8(key.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/androidpublisher",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(key.client_email)
    .setSubject(key.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const resp = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!resp.ok) {
    throw new Error(
      `Token exchange failed: ${resp.status} ${await resp.text()}`,
    );
  }
  const json = await resp.json() as { access_token: string; expires_in: number };
  cachedAccessToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

async function fetchSubscriptionState(
  purchaseToken: string,
): Promise<SubscriptionPurchaseV2> {
  if (!PACKAGE_NAME) {
    throw new Error("GOOGLE_PLAY_PACKAGE_NAME not configured");
  }
  const token = await getPlayApiAccessToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${
      encodeURIComponent(purchaseToken)
    }`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(
      `Play API subscriptionsv2.get failed: ${resp.status} ${await resp.text()}`,
    );
  }
  return await resp.json();
}

// ─── State mapping ─────────────────────────────────────────────────────────────

// Map Google's SubscriptionState enum onto the vocabulary the web paywall
// already understands (active / trialing / canceling / canceled / past_due /
// paused / expired). Anything we map to 'active' or 'trialing' grants access.
function mapSubscriptionState(state: string): string {
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      return "active";
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      // Payment failed but Google still gives the user limited extra time.
      // Treat as active so we don't yank access mid-grace.
      return "active";
    case "SUBSCRIPTION_STATE_CANCELED":
      // Cancellation scheduled but the subscription is still entitled until
      // expiryTime — match what we do for Stripe (cancel_at_period_end).
      return "canceling";
    case "SUBSCRIPTION_STATE_EXPIRED":
      return "canceled";
    case "SUBSCRIPTION_STATE_ON_HOLD":
      return "past_due";
    case "SUBSCRIPTION_STATE_PAUSED":
      return "paused";
    case "SUBSCRIPTION_STATE_PENDING":
      return "incomplete";
    default:
      return "incomplete";
  }
}

// ─── Apply to DB ───────────────────────────────────────────────────────────────

async function applySubscriptionUpdate(
  purchaseToken: string,
  productId: string,
  sub: SubscriptionPurchaseV2,
): Promise<{ matched: number; businessId?: string }> {
  const expiry = sub.lineItems?.[0]?.expiryTime ?? null;
  const status = mapSubscriptionState(sub.subscriptionState);

  // Computed subscription_status/trial_ends_at are owned by the DB arbiter
  // (trg_zz_subscription_arbiter); we only report Google's view via iap_*.
  const payload = {
    iap_status: status,
    iap_provider: "google",
    iap_product_id: productId,
    iap_purchase_token: purchaseToken,
    iap_expires_at: expiry,
  };

  // Preferred lookup: we've already stored this token via record_iap_purchase
  // (called from the mobile app immediately after the purchase succeeds).
  {
    const { data, error } = await supabase
      .from("businesses")
      .update(payload)
      .eq("iap_purchase_token", purchaseToken)
      .select("id");
    if (error) throw new Error(`Supabase update by token failed: ${error.message}`);
    if (data && data.length > 0) {
      return { matched: data.length, businessId: data[0].id };
    }
  }

  // Fallback: match via obfuscatedExternalAccountId.
  //
  // This is the path that actually carries Android, and it was matching the
  // wrong column. The comment here used to say the client tags the purchase
  // with the business_id; it does not — buy() passes `applicationUserName:
  // userId`, the signed-in Supabase *user*. Comparing that to businesses.id
  // never matched, so every Android notification fell through to the warning
  // below and no google purchase was ever confirmed, while Apple (whose token
  // is recorded correctly) worked fine.
  //
  // The lookup by token above can't cover for it either: the client records
  // GooglePlayPurchaseDetails.purchaseID, which is the *order id*
  // (GPA.xxxx-…), not the purchaseToken Google notifies us with.
  //
  // So resolve the id through profiles first, and treat it as a business id
  // only if it isn't a user. Matching also writes the real purchaseToken from
  // this notification into the row, so every later notification for the same
  // subscription matches on the fast path above.
  const obfuscatedId = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (obfuscatedId) {
    let businessId = obfuscatedId;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("business_id")
      .eq("id", obfuscatedId)
      .maybeSingle();
    if (profileError) {
      throw new Error(`Supabase profile lookup failed: ${profileError.message}`);
    }
    if (profile?.business_id) {
      businessId = profile.business_id;
    }

    const { data, error } = await supabase
      .from("businesses")
      .update(payload)
      .eq("id", businessId)
      .select("id");
    if (error) {
      throw new Error(
        `Supabase update by obfuscatedExternalAccountId failed: ${error.message}`,
      );
    }
    if (data && data.length > 0) {
      return { matched: data.length, businessId: data[0].id };
    }
  }

  console.warn(
    `play-webhook: no matching business for token=${purchaseToken.slice(0, 16)}... obfuscatedId=${obfuscatedId ?? "none"}`,
  );
  return { matched: 0 };
}

// ─── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 1. Verify the OIDC token from Pub/Sub.
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response("Missing Authorization header", { status: 401 });
  }
  try {
    await verifyPubSubToken(authHeader);
  } catch (err) {
    console.error("OIDC verification failed:", err);
    return new Response("Invalid token", { status: 401 });
  }

  // 2. Parse the Pub/Sub envelope.
  let envelope: PubSubPushMessage;
  try {
    envelope = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (!envelope?.message?.data) {
    return new Response("Missing message.data", { status: 400 });
  }

  // 3. Decode the base64 payload into a DeveloperNotification.
  let notification: DeveloperNotification;
  try {
    const decoded = atob(envelope.message.data);
    notification = JSON.parse(decoded);
  } catch (err) {
    console.error("Failed to decode message data:", err);
    return new Response("Invalid message payload", { status: 400 });
  }

  // 4. Handle the event types we care about.
  try {
    if (notification.testNotification) {
      console.log(
        `play-webhook: testNotification received, version=${notification.testNotification.version}`,
      );
      // Smoke test from Play Console — just acknowledge.
      return new Response(JSON.stringify({ received: "test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (notification.subscriptionNotification) {
      const { purchaseToken, subscriptionId, notificationType } =
        notification.subscriptionNotification;

      const sub = await fetchSubscriptionState(purchaseToken);
      const result = await applySubscriptionUpdate(
        purchaseToken,
        subscriptionId,
        sub,
      );

      console.log(
        `play-webhook: subscriptionNotification type=${notificationType} ` +
          `productId=${subscriptionId} state=${sub.subscriptionState} ` +
          `mapped=${mapSubscriptionState(sub.subscriptionState)} ` +
          `matched_rows=${result.matched} businessId=${result.businessId ?? "none"}`,
      );

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (notification.voidedPurchaseNotification) {
      console.log(
        `play-webhook: voidedPurchaseNotification received (no-op for now)`,
      );
      return new Response(JSON.stringify({ received: "voided" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (notification.oneTimeProductNotification) {
      console.log(
        `play-webhook: oneTimeProductNotification received (no-op, we sell subscriptions only)`,
      );
      return new Response(JSON.stringify({ received: "one-time" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.warn(
      "play-webhook: unrecognised notification shape",
      JSON.stringify(notification),
    );
    return new Response(JSON.stringify({ received: "unknown" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // Return 500 so Pub/Sub retries — usually means transient Play API or
    // DB error. Pub/Sub backoff handles the rest.
    console.error("play-webhook: handler failed:", err);
    return new Response("Handler error", { status: 500 });
  }
});
