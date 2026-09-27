import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapSubscriptionState } from "./status-map.ts";

Deno.test("HOOK-P01..P07 · every Google SubscriptionState maps to our vocabulary", () => {
  assertEquals(mapSubscriptionState("SUBSCRIPTION_STATE_ACTIVE"), "active");
  // Google still entitles the user during grace — don't yank access mid-shift.
  assertEquals(mapSubscriptionState("SUBSCRIPTION_STATE_IN_GRACE_PERIOD"), "active");
  // Cancelled but still paid up to expiry: 'canceling' is published as 'active'.
  assertEquals(mapSubscriptionState("SUBSCRIPTION_STATE_CANCELED"), "canceling");
  assertEquals(mapSubscriptionState("SUBSCRIPTION_STATE_EXPIRED"), "canceled");
  assertEquals(mapSubscriptionState("SUBSCRIPTION_STATE_ON_HOLD"), "past_due");
  assertEquals(mapSubscriptionState("SUBSCRIPTION_STATE_PAUSED"), "paused");
  assertEquals(mapSubscriptionState("SUBSCRIPTION_STATE_PENDING"), "incomplete");
});

Deno.test("HOOK-P08 · an unknown state never grants access", () => {
  for (const s of ["", "SUBSCRIPTION_STATE_UNSPECIFIED", "WHATEVER"]) {
    const mapped = mapSubscriptionState(s);
    assertEquals(mapped, "incomplete");
    assertEquals(["active", "trialing", "canceling"].includes(mapped), false);
  }
});
