// Map Google's SubscriptionState enum onto the vocabulary the web paywall
// already understands (active / trialing / canceling / canceled / past_due /
// paused / expired). Anything we map to 'active' or 'trialing' grants access.
export function mapSubscriptionState(state: string): string {
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
