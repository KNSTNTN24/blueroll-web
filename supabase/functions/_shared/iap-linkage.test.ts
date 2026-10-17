import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decryptIapSecret, distinctBusinessIds, encryptIapSecret, safeEventLog, sha256Hex } from "./iap-linkage.ts";

Deno.test("sha256Hex is lowercase canonical SHA-256", async () => {
  assertEquals(await sha256Hex("purchase-token"), "3f955299b922937e8acf830313756fd3752c199963113835d81480dbf5aa2f27");
});

Deno.test("AES-GCM envelope round-trips and expires after 90 days", async () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  const now = new Date("2026-10-17T00:00:00.000Z");
  const encrypted = await encryptIapSecret("purchase-token", key, now);
  assertNotEquals(encrypted.ciphertext, "purchase-token");
  assertEquals(encrypted.deleteAfter, "2027-01-15T00:00:00.000Z");
  assertEquals(await decryptIapSecret(encrypted.ciphertext, encrypted.iv, key), "purchase-token");
});

Deno.test("candidate union is distinct and deterministic", () => {
  assertEquals(distinctBusinessIds(["b", "a"], ["a", null, "c"]), ["a", "b", "c"]);
});

Deno.test("safe event log cannot contain raw store identity", () => {
  const log = safeEventLog({ provider: "google", eventId: "m1", resolution: "unmatched", tokenHash: "hash" });
  assertEquals(log, { provider: "google", eventId: "m1", resolution: "unmatched", tokenHash: "hash" });
  assertEquals(JSON.stringify(log).includes("purchase-token"), false);
});
