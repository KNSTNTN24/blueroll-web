import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { paidPeriodEnd, subscriptionUpdatePayload } from "./payload.ts";

const iso = (unix: number) => new Date(unix * 1000).toISOString();
const TRIAL_END = 1756636887;                 // 31.08.2026, in the past by now
const PERIOD_END = TRIAL_END + 30 * 86400;    // a month later

const base = {
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  trial_end: null as number | null,
};

Deno.test("HOOK-S01 · during the trial, until is the trial end", () => {
  const p = subscriptionUpdatePayload({ ...base, status: "trialing", trial_end: TRIAL_END });
  assertEquals(p.stripe_status, "trialing");
  assertEquals(p.stripe_until, iso(TRIAL_END));
});

Deno.test("HOOK-S02 · trial converts to paid — until must be the period end, not trial_end", () => {
  // The regression that locked Tootoomoo out twice: Stripe keeps trial_end at
  // its past value forever, so reusing it published an expired entitlement.
  const p = subscriptionUpdatePayload({
    ...base,
    status: "active",
    trial_end: TRIAL_END,
    current_period_end: PERIOD_END,
  });
  assertEquals(p.stripe_status, "active");
  assertEquals(p.stripe_until, iso(PERIOD_END));
});

Deno.test("HOOK-S03 · period read from items[] (API 2025-04-30.basil moved it)", () => {
  const p = subscriptionUpdatePayload({
    ...base,
    status: "active",
    trial_end: TRIAL_END,
    items: { data: [{ current_period_end: PERIOD_END }] },
  });
  assertEquals(p.stripe_until, iso(PERIOD_END));
});

Deno.test("HOOK-S04 · no period at all — unbounded, never a past trial_end", () => {
  const p = subscriptionUpdatePayload({ ...base, status: "active", trial_end: TRIAL_END });
  assertEquals(p.stripe_until, null);
});

Deno.test("HOOK-S05 · cancel_at_period_end publishes 'canceling', access until period end", () => {
  const p = subscriptionUpdatePayload({
    ...base,
    status: "active",
    cancel_at_period_end: true,
    current_period_end: PERIOD_END,
  });
  assertEquals(p.stripe_status, "canceling");
  assertEquals(p.stripe_until, iso(PERIOD_END));
});

Deno.test("HOOK-S06 · failed renewal reports past_due with its period", () => {
  const p = subscriptionUpdatePayload({
    ...base,
    status: "past_due",
    current_period_end: PERIOD_END,
  });
  assertEquals(p.stripe_status, "past_due");
  assertEquals(p.stripe_until, iso(PERIOD_END));
});

Deno.test("HOOK-S07 · latest period wins when both shapes are present", () => {
  const p = subscriptionUpdatePayload({
    ...base,
    status: "active",
    current_period_end: PERIOD_END,
    items: { data: [{ current_period_end: PERIOD_END + 86400 }] },
  });
  assertEquals(p.stripe_until, iso(PERIOD_END + 86400));
});

Deno.test("HOOK-S08 · paidPeriodEnd ignores nulls and empty items", () => {
  assertEquals(paidPeriodEnd({ ...base, current_period_end: null }), null);
  assertEquals(paidPeriodEnd({ ...base, items: { data: [] } }), null);
  assertEquals(paidPeriodEnd({ ...base, items: { data: [{ current_period_end: null }] } }), null);
});

Deno.test("HOOK-S09 · a trial with no trial_end falls back to the paid period", () => {
  const p = subscriptionUpdatePayload({
    ...base,
    status: "trialing",
    trial_end: null,
    current_period_end: PERIOD_END,
  });
  assertEquals(p.stripe_until, iso(PERIOD_END));
});
