import { CREDIT_EXPIRY_POLICY, CreditExpiryPolicy } from "@/server/billing/types";

/**
 * Initial policy is NEVER. Unused credits must not silently disappear.
 * EXPIRE ledger type is reserved for a future PO policy change.
 */
export function creditExpiryAllowed(
  policy: typeof CREDIT_EXPIRY_POLICY = CREDIT_EXPIRY_POLICY,
): boolean {
  return policy !== CreditExpiryPolicy.NEVER;
}

export function expireUnusedCredits(): { expired: number; reason: "NEVER" } {
  return { expired: 0, reason: "NEVER" };
}
