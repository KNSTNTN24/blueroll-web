// Map Apple's transaction status onto the vocabulary already used by
// stripe-webhook + play-webhook so the paywall reads it uniformly.
export function mapAppleStatus(status: number): string {
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
