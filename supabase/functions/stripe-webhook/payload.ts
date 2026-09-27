// Pure Stripe->row mapping, kept out of index.ts so it can be unit-tested
// without booting the server that index.ts starts at import time.
export interface StripeSubscription {
  id: string;
  customer: string;
  status: string; // trialing | active | past_due | canceled | unpaid | incomplete | incomplete_expired
  cancel_at_period_end: boolean;
  trial_end: number | null;
  // Present on API versions before 2025-04-30.basil; newer versions moved the
  // period to the subscription items, so read both and take the later one.
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> };
}

// End of the paid period, in unix seconds, or null if Stripe didn't send one.
export function paidPeriodEnd(sub: StripeSubscription): number | null {
  const candidates = [
    sub.current_period_end,
    ...(sub.items?.data ?? []).map((i) => i.current_period_end),
  ].filter((n): n is number => typeof n === "number");
  return candidates.length ? Math.max(...candidates) : null;
}

export function subscriptionUpdatePayload(sub: StripeSubscription) {
  // Which timestamp bounds the entitlement: the trial end while the trial is
  // still running, the paid period end once it has converted. Using trial_end
  // unconditionally used to strand paying customers — Stripe keeps trial_end at
  // its (now past) value forever, so the arbiter saw an expired source and
  // published 'canceled' the moment the trial ended (Tootoomoo, 31.08.2026).
  // Never fall back to trial_end once the trial is over: that is the bug. If
  // Stripe sends no period at all, leave it unbounded and let the next event
  // tighten it — failing open beats locking out someone who has paid.
  const until = sub.status === "trialing"
    ? sub.trial_end ?? paidPeriodEnd(sub)
    : paidPeriodEnd(sub);

  return {
    subscription_id: sub.id,
    // Stripe's view only. The DB arbiter (trg_zz_subscription_arbiter) computes
    // subscription_status/trial_ends_at from all sources; it publishes a live
    // 'canceling' as 'active' so paid users keep access until period end.
    stripe_status: sub.cancel_at_period_end ? "canceling" : sub.status,
    // null = unbounded. Safe: a subscription that actually ends arrives as a
    // deleted/canceled event, and status alone then drops it out of 'live'.
    stripe_until: until ? new Date(until * 1000).toISOString() : null,
  };
}
