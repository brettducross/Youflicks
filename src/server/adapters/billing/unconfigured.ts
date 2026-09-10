import { AppError } from "@/lib/errors";
import type {
  CancelSubscriptionResult,
  CheckoutSession,
  CreditGrantInput,
  CreditLedgerEntryView,
  WebhookResult,
} from "@/server/billing/types";
import type { BillingPort } from "@/server/ports/billing";

/**
 * M8.5a stub. No live payment provider. Checkout / webhook / vendor cancel
 * stay unavailable until M8.5b (PO provider + priced offers).
 */
export class UnconfiguredBillingPort implements BillingPort {
  async createCheckout(userId: string, offerKey: string): Promise<CheckoutSession> {
    void userId;
    return { status: "UNAVAILABLE", reason: "NO_PAYMENT_PROVIDER", offerKey };
  }

  async applyCredit(
    userId: string,
    grant: CreditGrantInput,
  ): Promise<CreditLedgerEntryView> {
    void userId;
    void grant;
    throw AppError.providerNotConfigured("BillingPort");
  }

  async cancelSubscription(userId: string): Promise<CancelSubscriptionResult> {
    void userId;
    return { status: "UNAVAILABLE", reason: "NO_PAYMENT_PROVIDER" };
  }

  async handleWebhook(
    providerKey: string,
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<WebhookResult> {
    void providerKey;
    void headers;
    void rawBody;
    return { status: "UNAVAILABLE", reason: "NO_PAYMENT_PROVIDER" };
  }
}
