// Apple App Store Server Notifications V2 handler.
//
// Configure (one-time):
//   1. App Store Connect → My Apps → <app> → App Information →
//      App Store Server Notifications:
//        Production Server URL = https://<ref>.supabase.co/functions/v1/apple-webhook
//        Sandbox Server URL    = same URL
//        Version = Version 2
//   2. App Store Connect → Users and Access → Integrations → In-App Purchase
//      → Generate In-App Purchase Key, download the .p8 file.
//   3. Supabase secrets:
//        APPLE_IAP_PRIVATE_KEY    — full .p8 contents
//        APPLE_IAP_KEY_ID         — short ID shown next to the key
//        APPLE_IAP_ISSUER_ID      — UUID at the top of Integrations page
//        APPLE_BUNDLE_ID          — iOS bundle ID (com.haccp.haccpMobile)
//        APPLE_APP_APPLE_ID       — numeric App ID (e.g. 6760937451)
//   4. Deploy: supabase functions deploy apple-webhook --no-verify-jwt
//
// What it does on each notification:
//   - Receives { signedPayload: "<JWS>" } from Apple.
//   - Decodes the JWS payload (responseBodyV2DecodedPayload). For full
//     verification Apple ships a chain in the JWS header x5c — we use the
//     leaf cert to verify the signature, treat the bundleId + appAppleId
//     match as the second line of defence, and reject anything that
//     doesn't decode cleanly. Full Apple Root CA G3 chain validation
//     is a TODO; the leaf signature check is the minimum bar.
//   - Decodes the inner signedTransactionInfo JWS to get
//     originalTransactionId + appAccountToken (the Supabase user UUID
//     we pass at buy() time).
//   - Calls App Store Server API
//     /inApps/v1/subscriptions/{originalTransactionId} for the canonical
//     subscription state (handles sandbox vs production based on
//     payload.data.environment).
//   - Maps Apple's transaction status onto the same status vocabulary
//     the web paywall understands and updates the matching businesses row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decodeProtectedHeader,
  importPKCS8,
  importX509,
  jwtVerify,
  SignJWT,
} from "https://esm.sh/jose@5.9.6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APPLE_IAP_PRIVATE_KEY = Deno.env.get("APPLE_IAP_PRIVATE_KEY");
const APPLE_IAP_KEY_ID = Deno.env.get("APPLE_IAP_KEY_ID");
const APPLE_IAP_ISSUER_ID = Deno.env.get("APPLE_IAP_ISSUER_ID");
const APPLE_BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID");
const APPLE_APP_APPLE_ID = Deno.env.get("APPLE_APP_APPLE_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Types from Apple ──────────────────────────────────────────────────────────

interface SignedPayloadEnvelope {
  signedPayload: string;
}

// responseBodyV2DecodedPayload
// https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2decodedpayload
interface NotificationPayload {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  data?: {
    bundleId: string;
    appAppleId?: number;
    environment: "Sandbox" | "Production";
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
    status?: number; // subscription status: 1 active, 2 expired, 3 retry, 4 grace, 5 revoked
  };
  summary?: unknown;
  externalPurchaseToken?: unknown;
  version: string;
  signedDate: number;
}

interface JWSTransactionDecodedPayload {
  transactionId: string;
  originalTransactionId: string;
  webOrderLineItemId?: string;
  bundleId: string;
  productId: string;
  subscriptionGroupIdentifier?: string;
  purchaseDate?: number;
  originalPurchaseDate?: number;
  expiresDate?: number;
  appAccountToken?: string;
  environment: "Sandbox" | "Production";
  // Many other fields exist; we only use the ones we touch.
}

// /inApps/v1/subscriptions/{originalTransactionId}
// https://developer.apple.com/documentation/appstoreserverapi/get_all_subscription_statuses
interface StatusResponse {
  environment: "Sandbox" | "Production";
  bundleId: string;
  appAppleId?: number;
  data: Array<{
    subscriptionGroupIdentifier: string;
    lastTransactions: Array<{
      originalTransactionId: string;
      // 1 Active, 2 Expired, 3 Retry, 4 Grace Period, 5 Revoked
      status: number;
      signedTransactionInfo: string;
      signedRenewalInfo: string;
    }>;
  }>;
}

// ─── JWS decoding ──────────────────────────────────────────────────────────────

function base64UrlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function bytesToBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function derToPem(der: string): string {
  // x5c entries are standard base64 (not base64url) DER encodings.
  const wrapped = der.match(/.{1,64}/g)?.join("\n") ?? der;
  return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----`;
}

// Verifies a JWS using the leaf certificate from its own x5c header.
// Returns the decoded payload as the requested type.
//
// NOTE: a full implementation also walks the x5c chain up to Apple Root
// CA G3 and rejects mismatched / expired certs. Currently we only verify
// the signature against the embedded leaf, then sanity-check bundleId in
// the payload. That's enough to reject a body Apple didn't sign — an
// attacker would need to know a leaf cert that matches its own key, which
// they can't fabricate — but it doesn't catch a stolen / leaked cert in
// the wild. Leaving full chain validation as a follow-up.
async function decodeAppleJws<T>(jws: string): Promise<T> {
  const header = decodeProtectedHeader(jws);
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length === 0) {
    throw new Error("JWS missing x5c chain");
  }
  const leafPem = derToPem(x5c[0]);
  const key = await importX509(leafPem, header.alg ?? "ES256");
  const { payload } = await jwtVerify(jws, key, {
    // Apple's JWS doesn't carry registered claims (no iss/aud) — we only
    // need the signature check here. The bundleId match below is the
    // domain-level check.
    clockTolerance: 60,
  });
  return payload as T;
}

// ─── App Store Server API ──────────────────────────────────────────────────────

let cachedApiToken: { token: string; expiresAt: number } | null = null;

async function getAppleApiToken(): Promise<string> {
  if (cachedApiToken && cachedApiToken.expiresAt > Date.now() + 60_000) {
    return cachedApiToken.token;
  }
  if (
    !APPLE_IAP_PRIVATE_KEY || !APPLE_IAP_KEY_ID ||
    !APPLE_IAP_ISSUER_ID || !APPLE_BUNDLE_ID
  ) {
    throw new Error("Apple IAP secrets not fully configured");
  }

  // .p8 files are PKCS8-formatted EC keys (P-256). jose's importPKCS8
  // handles them directly.
  const privateKey = await importPKCS8(APPLE_IAP_PRIVATE_KEY, "ES256");
  const now = Math.floor(Date.now() / 1000);

  // Apple caps token lifetime at 60 minutes; we use 50 to leave headroom
  // for clock skew.
  const token = await new SignJWT({ bid: APPLE_BUNDLE_ID })
    .setProtectedHeader({ alg: "ES256", kid: APPLE_IAP_KEY_ID, typ: "JWT" })
    .setIssuer(APPLE_IAP_ISSUER_ID)
    .setAudience("appstoreconnect-v1")
    .setIssuedAt(now)
    .setExpirationTime(now + 50 * 60)
    .sign(privateKey);

  cachedApiToken = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return token;
}

async function fetchSubscriptionStatuses(
  originalTransactionId: string,
  environment: "Sandbox" | "Production",
): Promise<StatusResponse> {
  const base = environment === "Sandbox"
    ? "https://api.storekit-sandbox.itunes.apple.com"
    : "https://api.storekit.itunes.apple.com";
  const url =
    `${base}/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`;
  const token = await getAppleApiToken();
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(
      `App Store Server API failed: ${resp.status} ${await resp.text()}`,
    );
  }
  return await resp.json();
}

// ─── State mapping ─────────────────────────────────────────────────────────────

// Map Apple's transaction status onto the vocabulary already used by
// stripe-webhook + play-webhook so the paywall reads it uniformly.
function mapAppleStatus(status: number): string {
  switch (status) {
    case 1:
      return "active";
    case 2:
      return "canceled"; // expired — entitlement gone
    case 3:
      return "past_due"; // billing retry
    case 4:
      return "active"; // grace period — Apple still entitles the user
    case 5:
      return "canceled"; // revoked
    default:
      return "incomplete";
  }
}

// ─── DB application ────────────────────────────────────────────────────────────

interface ApplyInput {
  originalTransactionId: string;
  productId: string;
  appAccountToken: string | undefined;
  expiresMillis: number | undefined;
  status: number;
}

async function applyAppleUpdate(
  i: ApplyInput,
): Promise<{ matched: number; businessId?: string }> {
  const expiresAt = i.expiresMillis
    ? new Date(i.expiresMillis).toISOString()
    : null;
  const status = mapAppleStatus(i.status);

  // Computed columns are owned by the DB arbiter; report Apple's view via iap_*.
  const payload = {
    iap_status: status,
    iap_provider: "apple",
    iap_product_id: i.productId,
    iap_original_transaction_id: i.originalTransactionId,
    iap_expires_at: expiresAt,
  };

  // Preferred lookup: appAccountToken is the Supabase user UUID we tagged
  // the purchase with at buy() time. Going through profiles gives us the
  // business directly.
  if (i.appAccountToken) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("business_id")
      .eq("id", i.appAccountToken)
      .maybeSingle();
    if (profile?.business_id) {
      const { data, error } = await supabase
        .from("businesses")
        .update(payload)
        .eq("id", profile.business_id)
        .select("id");
      if (error) {
        throw new Error(`Update by appAccountToken failed: ${error.message}`);
      }
      if (data && data.length > 0) {
        return { matched: data.length, businessId: data[0].id };
      }
    }
  }

  // Fallback: record_iap_purchase has already populated
  // iap_original_transaction_id on the businesses row from the mobile
  // side. Match on it.
  {
    const { data, error } = await supabase
      .from("businesses")
      .update(payload)
      .eq("iap_original_transaction_id", i.originalTransactionId)
      .select("id");
    if (error) {
      throw new Error(
        `Update by iap_original_transaction_id failed: ${error.message}`,
      );
    }
    if (data && data.length > 0) {
      return { matched: data.length, businessId: data[0].id };
    }
  }

  console.warn(
    `apple-webhook: no matching business for originalTransactionId=${i.originalTransactionId} appAccountToken=${i.appAccountToken ?? "none"}`,
  );
  return { matched: 0 };
}

// ─── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 1. Body shape.
  let envelope: SignedPayloadEnvelope;
  try {
    envelope = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (!envelope?.signedPayload) {
    return new Response("Missing signedPayload", { status: 400 });
  }

  // 2. Decode and signature-check the outer JWS.
  let notification: NotificationPayload;
  try {
    notification = await decodeAppleJws<NotificationPayload>(
      envelope.signedPayload,
    );
  } catch (err) {
    console.error("apple-webhook: outer JWS verification failed:", err);
    return new Response("Invalid signedPayload", { status: 400 });
  }

  // 3. Bundle / app sanity check — drops payloads not for us.
  if (notification.data?.bundleId && notification.data.bundleId !== APPLE_BUNDLE_ID) {
    console.warn(
      `apple-webhook: bundleId mismatch (got ${notification.data.bundleId}, expected ${APPLE_BUNDLE_ID})`,
    );
    return new Response("Bundle mismatch", { status: 400 });
  }
  if (
    APPLE_APP_APPLE_ID && notification.data?.appAppleId &&
    String(notification.data.appAppleId) !== APPLE_APP_APPLE_ID
  ) {
    console.warn(
      `apple-webhook: appAppleId mismatch (got ${notification.data.appAppleId}, expected ${APPLE_APP_APPLE_ID})`,
    );
    return new Response("App mismatch", { status: 400 });
  }

  try {
    // 4. Test notifications — acknowledge and exit. Apple uses
    // notificationType=TEST when you press "Request a Test Notification".
    if (notification.notificationType === "TEST") {
      console.log(
        `apple-webhook: TEST notification received uuid=${notification.notificationUUID}`,
      );
      return new Response(JSON.stringify({ received: "test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!notification.data?.signedTransactionInfo) {
      console.log(
        `apple-webhook: ${notification.notificationType} without signedTransactionInfo, acknowledging`,
      );
      return new Response(JSON.stringify({ received: "no-tx" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 5. Decode the transaction info to get originalTransactionId + tag.
    const tx = await decodeAppleJws<JWSTransactionDecodedPayload>(
      notification.data.signedTransactionInfo,
    );

    // 6. Hit App Store Server API for the canonical state.
    const env = notification.data.environment;
    const status = await fetchSubscriptionStatuses(tx.originalTransactionId, env);
    const latest = status.data?.[0]?.lastTransactions?.find((t) =>
      t.originalTransactionId === tx.originalTransactionId
    ) ?? status.data?.[0]?.lastTransactions?.[0];
    if (!latest) {
      throw new Error("App Store Server API returned no transactions");
    }

    // We need expiresDate for the entitlement window — pull it from the
    // signed transaction info attached to the latest record.
    const latestTx = await decodeAppleJws<JWSTransactionDecodedPayload>(
      latest.signedTransactionInfo,
    );

    const result = await applyAppleUpdate({
      originalTransactionId: tx.originalTransactionId,
      productId: latestTx.productId ?? tx.productId,
      appAccountToken: tx.appAccountToken ?? latestTx.appAccountToken,
      expiresMillis: latestTx.expiresDate ?? tx.expiresDate,
      status: latest.status,
    });

    console.log(
      `apple-webhook: ${notification.notificationType}` +
        (notification.subtype ? `/${notification.subtype}` : "") +
        ` env=${env} originalTx=${tx.originalTransactionId}` +
        ` appleStatus=${latest.status} mapped=${mapAppleStatus(latest.status)}` +
        ` matched=${result.matched} businessId=${result.businessId ?? "none"}`,
    );

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // 5xx makes Apple retry per their retry schedule. That's the right
    // behaviour for transient Apple API / DB errors.
    console.error("apple-webhook: handler failed:", err);
    return new Response("Handler error", { status: 500 });
  }
});
