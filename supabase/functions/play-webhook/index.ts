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

import { mapSubscriptionState } from "./status-map.ts";
import { encryptIapSecret, safeEventLog, sha256Hex } from "../_shared/iap-linkage.ts";

// ─── Apply to DB ───────────────────────────────────────────────────────────────

async function applySubscriptionUpdate(
  eventId: string,
  eventType: string,
  purchaseToken: string,
  productId: string,
  sub: SubscriptionPurchaseV2,
): Promise<{ resolution: string; business_id?: string }> {
  const lineItem = sub.lineItems?.find((item) => item.productId === productId) ??
    [...(sub.lineItems ?? [])].sort((a, b) => Date.parse(b.expiryTime) - Date.parse(a.expiryTime))[0];
  const expiry = lineItem?.expiryTime ?? null;
  const status = mapSubscriptionState(sub.subscriptionState);
  const encryptionKey = Deno.env.get("IAP_EVENT_ENCRYPTION_KEY");
  if (!encryptionKey) throw new Error("IAP_EVENT_ENCRYPTION_KEY not configured");
  const encrypted = await encryptIapSecret(purchaseToken, encryptionKey);
  const tokenHash = await sha256Hex(purchaseToken);
  const { error: beginError } = await supabase.rpc("begin_iap_event", {
    p_provider: "google", p_event_id: eventId, p_event_type: eventType,
    p_product_id: productId, p_token_sha256: tokenHash,
    p_token_ciphertext: encrypted.ciphertext, p_token_iv: encrypted.iv,
    p_store_status: status, p_expires_at: expiry,
  });
  if (beginError) throw new Error(`IAP ledger begin failed: ${beginError.message}`);

  const obfuscatedId = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  const { data, error } = await supabase.rpc("finalize_iap_event", {
    p_provider: "google", p_event_id: eventId, p_store_identifier: purchaseToken,
    p_external_reference: obfuscatedId ?? null, p_status: status,
    p_product_id: productId, p_expires_at: expiry,
  });
  if (error) throw new Error(`IAP ledger finalization failed: ${error.message}`);
  console.log("play-webhook:", safeEventLog({ provider: "google", eventId, resolution: data.resolution, tokenHash }));
  return data;
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
        envelope.message.messageId,
        String(notificationType),
        purchaseToken,
        subscriptionId,
        sub,
      );

      console.log(
        `play-webhook: subscriptionNotification type=${notificationType} ` +
          `productId=${subscriptionId} state=${sub.subscriptionState} ` +
          `mapped=${mapSubscriptionState(sub.subscriptionState)} ` +
          `resolution=${result.resolution} businessId=${result.business_id ?? "none"}`,
      );

      if (result.resolution !== "matched") throw new Error(`IAP event ${result.resolution}`);

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
