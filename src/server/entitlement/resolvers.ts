import type { PrepaidGrant, SubscriptionGrant } from "@/server/entitlement/types";

/**
 * M8.2 stubs. Subscription / prepaid grants arrive in M8.5 via BillingPort.
 * These resolvers must stay empty and must not import Stripe or any vendor SDK.
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
