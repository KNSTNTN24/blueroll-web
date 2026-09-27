import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapAppleStatus } from "./status-map.ts";

Deno.test("HOOK-A01..A05 · every Apple transaction status maps to our vocabulary", () => {
  assertEquals(mapAppleStatus(1), "active");     // subscribed
  assertEquals(mapAppleStatus(2), "canceled");   // expired
  assertEquals(mapAppleStatus(3), "past_due");   // billing retry
  assertEquals(mapAppleStatus(4), "active");     // grace period — Apple still entitles
  assertEquals(mapAppleStatus(5), "canceled");   // revoked
});

Deno.test("HOOK-A06 · an unknown status never grants access", () => {
  for (const s of [0, 6, 99, -1]) {
    const mapped = mapAppleStatus(s);
    assertEquals(mapped, "incomplete");
    assertEquals(["active", "trialing", "canceling"].includes(mapped), false);
  }
});
