/**
 * M8.5a billing types. Commercial records only — never CreativePlan meaning.
 * Prices and numeric PLUS/FAMILY caps stay TBD/null until PO supplies them.
 */

export const PlanKey = {
  FREE: "FREE",
  PLUS: "PLUS",
  FAMILY: "FAMILY",
} as const;

export type PlanKeyValue = (typeof PlanKey)[keyof typeof PlanKey];

export const SubscriptionStatus = {
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  CANCELED: "CANCELED",
} as const;

export type SubscriptionStatusValue =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const CreditLedgerEntryType = {
  GRANT: "GRANT",
  SPEND: "SPEND",
  REFUND: "REFUND",
  ADJUST: "ADJUST",
  /** Reserved. Default expiry policy is NEVER — do not write without a PO change. */
  EXPIRE: "EXPIRE",
} as const;

export type CreditLedgerEntryTypeValue =
  (typeof CreditLedgerEntryType)[keyof typeof CreditLedgerEntryType];

export const CreditSource = {
  PREPAID: "PREPAID",
  AD_SUBSIDY: "AD_SUBSIDY",
  PROMO: "PROMO",
  SUPPORT: "SUPPORT",
} as const;

export type CreditSourceValue = (typeof CreditSource)[keyof typeof CreditSource];

export const OfferKind = {
  PLAN: "PLAN",
  PACK: "PACK",
} as const;

export const CreditExpiryPolicy = {
  NEVER: "NEVER",
} as const;

export type CreditExpiryPolicyValue =
  (typeof CreditExpiryPolicy)[keyof typeof CreditExpiryPolicy];

/** Initial lock: unused credits never silently disappear. */
export const CREDIT_EXPIRY_POLICY: CreditExpiryPolicyValue = CreditExpiryPolicy.NEVER;

/** Soft job name for webhook reconcile. Not a creative JobType. Ban AI_BILL. */
export const BillingJobType = {
  BILLING_WEBHOOK: "BILLING_WEBHOOK",
} as const;

export const FIRST_PARTY_PROVIDER_KEY = "youflicks.first_party" as const;

/**
 * Grant shape for a planKey. Flags may ship; numeric benefits / prices stay
 * null until PO supplies them. FREE Constitution numbers are the exception.
 */
export type PlanGrantShape = {
  planKey: string;
  displayName: string;
  watermarkRequired: boolean;
  adsEnabled: boolean;
  movieGenerationsPerHour: number | null;
  maxOutputDurationMs: number | null;
  storageBytes: number | null;
  processingPriority: string | null;
  familyProfiles: boolean | null;
  sharedLibrary: boolean | null;
  parentalControls: boolean | null;
  collaboration: boolean | null;
  priceAmount: number | null;
  priceCurrency: string | null;
};

export type CreditGrantInput = {
  quantity: number;
  reason?: string | null;
  source?: string | null;
  relatedPaymentEventId?: string | null;
};

export type CreditLedgerEntryView = {
  id: string;
  userId: string;
  entryType: string;
  quantity: number;
  reason: string | null;
  source: string | null;
  relatedPaymentEventId: string | null;
  expiresAt: string | null;
  recordedAt: string;
};

export type CreditBalanceView = {
  userId: string;
  available: number;
};

export type SubscriptionView = {
  id: string;
  userId: string;
  planKey: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  externalRef: string | null;
  providerKey: string;
};

export type OfferCatalogView = {
  offerKey: string;
  offerKind: string;
  planKey: string | null;
  packKey: string | null;
  grantShape: PlanGrantShape;
  priceAmount: number | null;
  priceCurrency: string | null;
};

export type CheckoutSession =
  | {
      status: "UNAVAILABLE";
      reason: "NO_PAYMENT_PROVIDER" | "PRICE_TBD";
      offerKey: string;
    }
  | {
      status: "CREATED";
      offerKey: string;
      providerKey: string;
      checkoutUrl: string;
    };

export type CancelSubscriptionResult =
  | { status: "UNAVAILABLE"; reason: "NO_PAYMENT_PROVIDER" }
  | { status: "CANCELED"; subscriptionId: string };

export type WebhookResult =
  | { status: "UNAVAILABLE"; reason: "NO_PAYMENT_PROVIDER" }
  | { status: "DUPLICATE"; paymentEventId: string }
  | { status: "RECORDED"; paymentEventId: string };

export type RecordSubscriptionInput = {
  userId: string;
  planKey: string;
  status: string;
  providerKey: string;
  externalRef?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
};

export type UsageDebitIntent = {
  kind: string;
  quantity: number;
  costUnits?: number | null;
};
