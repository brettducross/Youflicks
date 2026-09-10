import type { PrepaidGrant, SubscriptionGrant } from "@/server/entitlement/types";

/**
 * Resolver contracts for EntitlementService.mergeSnapshot.
 * Empty stubs remain for isolated tests. Production defaults are the M8.5a
 * BillingSubscriptionResolver / BillingPrepaidResolver (no vendor SDK).
 */
export type SubscriptionResolver = {
  resolve(userId: string): Promise<SubscriptionGrant[]>;
};

export type PrepaidResolver = {
  resolve(userId: string): Promise<PrepaidGrant[]>;
};

export class EmptySubscriptionResolver implements SubscriptionResolver {
  async resolve(userId: string): Promise<SubscriptionGrant[]> {
    void userId;
    return [];
  }
}

export class EmptyPrepaidResolver implements PrepaidResolver {
  async resolve(userId: string): Promise<PrepaidGrant[]> {
    void userId;
    return [];
  }
}
