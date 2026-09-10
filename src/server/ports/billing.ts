import type {
  CancelSubscriptionResult,
  CheckoutSession,
  CreditGrantInput,
  CreditLedgerEntryView,
  WebhookResult,
} from "@/server/billing/types";

/**
 * Payment-processor adapter. Open providerKey. No live adapter in M8.5a.
 * Never imported by Director / Story / Timeline / Asset / Render.
 */
export type BillingPort = {
  createCheckout(userId: string, offerKey: string): Promise<CheckoutSession>;
  applyCredit(userId: string, grant: CreditGrantInput): Promise<CreditLedgerEntryView>;
  cancelSubscription(userId: string): Promise<CancelSubscriptionResult>;
  handleWebhook(
    providerKey: string,
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<WebhookResult>;
};
