import { CreditSource } from "@/server/billing/types";
import type { CreditLedgerEntryView } from "@/server/billing/types";
import { BillingService } from "@/server/services/billing";

/**
 * M8.6d stub: AD_SUBSIDY → CreditLedger bridge.
 * Cap is a TBD/null placeholder. Null must never mean unlimited spend.
 */
export type AdSubsidyPolicy = {
  source: typeof CreditSource.AD_SUBSIDY;
  /** Numeric cap TBD. Null is not unlimited. */
  capQuantity: number | null;
  capPeriod: string | null;
};

export const AD_SUBSIDY_POLICY: AdSubsidyPolicy = {
  source: CreditSource.AD_SUBSIDY,
  capQuantity: null,
  capPeriod: null,
};

export type AdSubsidyGrantResult =
  | { granted: false; reason: "CAP_TBD" | "CAP_REACHED" | "QUANTITY_TBD" }
  | { granted: true; entry: CreditLedgerEntryView };

export class AdSubsidyBridge {
  constructor(
    private readonly billing: BillingService = new BillingService(),
    private readonly policy: AdSubsidyPolicy = AD_SUBSIDY_POLICY,
  ) {}

  async tryGrant(
    userId: string,
    quantity: number | null = null,
  ): Promise<AdSubsidyGrantResult> {
    if (this.policy.capQuantity == null) {
      return { granted: false, reason: "CAP_TBD" };
    }
    if (quantity == null) {
      return { granted: false, reason: "QUANTITY_TBD" };
    }
    const granted = await this.billing.listLedger(userId);
    const already = granted
      .filter(
        (entry) =>
          entry.entryType === "GRANT" && entry.source === CreditSource.AD_SUBSIDY,
      )
      .reduce((sum, entry) => sum + entry.quantity, 0);
    if (already + quantity > this.policy.capQuantity) {
      return { granted: false, reason: "CAP_REACHED" };
    }
    const entry = await this.billing.applyCredit(userId, {
      quantity,
      source: CreditSource.AD_SUBSIDY,
      reason: "ad_subsidy",
    });
    return { granted: true, entry };
  }
}
