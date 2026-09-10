import "server-only";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { UnconfiguredBillingPort } from "@/server/adapters/billing/unconfigured";
import { PLAN_GRANT_SHAPES, planGrantShape, planOfferKey } from "@/server/billing/plan-catalog";
import { appendLedgerEntry, availableCreditBalance } from "@/server/billing/ledger";
import {
  CREDIT_EXPIRY_POLICY,
  CreditLedgerEntryType,
  CreditSource,
  OfferKind,
  PlanKey,
  type CheckoutSession,
  type CreditBalanceView,
  type CreditGrantInput,
  type CreditLedgerEntryView,
  type OfferCatalogView,
  type PlanGrantShape,
  type RecordSubscriptionInput,
  type SubscriptionView,
  type UsageDebitIntent,
  type WebhookResult,
} from "@/server/billing/types";
import {
  DEFAULT_USAGE_CREDIT_POLICY,
  debitQuantityForUsage,
  type UsageCreditPolicyConfig,
} from "@/server/billing/usage-credit-policy";
import { prisma } from "@/server/db";
import type { BillingPort } from "@/server/ports/billing";

/**
 * M8.5a BillingService. Offer catalog, ledger, and BillingPort stub.
 * No live payment provider. Resolvers (not this service) fill mergeSnapshot.
 */
export class BillingService {
  constructor(
    private readonly port: BillingPort = new UnconfiguredBillingPort(),
    private readonly creditPolicy: UsageCreditPolicyConfig = DEFAULT_USAGE_CREDIT_POLICY,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createCheckout(userId: string, offerKey: string): Promise<CheckoutSession> {
    await this.requireUser(userId);
    const offer = await this.getOffer(offerKey);
    if (!offer) {
      throw AppError.notFound("That offer was not found.");
    }
    if (offer.priceAmount == null) {
      return { status: "UNAVAILABLE", reason: "PRICE_TBD", offerKey };
    }
    return this.port.createCheckout(userId, offerKey);
  }

  async applyCredit(userId: string, grant: CreditGrantInput): Promise<CreditLedgerEntryView> {
    await this.requireUser(userId);
    if (grant.quantity <= 0) {
      throw AppError.validation("Credit grants must be greater than zero.");
    }
    const entry = await appendLedgerEntry({
      userId,
      entryType: CreditLedgerEntryType.GRANT,
      quantity: grant.quantity,
      reason: grant.reason ?? "prepaid_grant",
      source: grant.source ?? CreditSource.PREPAID,
      relatedPaymentEventId: grant.relatedPaymentEventId,
      recordedAt: this.now(),
    });
    logger.info("billing.credit_granted", {
      userId,
      quantity: entry.quantity,
      source: entry.source,
    });
    return entry;
  }

  async cancelSubscription(userId: string) {
    await this.requireUser(userId);
    return this.port.cancelSubscription(userId);
  }

  async handleWebhook(
    providerKey: string,
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<WebhookResult> {
    return this.port.handleWebhook(providerKey, headers, rawBody);
  }

  async recordSubscription(input: RecordSubscriptionInput): Promise<SubscriptionView> {
    await this.requireUser(input.userId);
    const existing = input.externalRef
      ? await prisma.subscription.findFirst({
          where: { userId: input.userId, providerKey: input.providerKey, externalRef: input.externalRef },
        })
      : null;
    const row = existing
      ? await prisma.subscription.update({
          where: { id: existing.id },
          data: {
            planKey: input.planKey,
            status: input.status,
            periodStart: input.periodStart ?? null,
            periodEnd: input.periodEnd ?? null,
          },
        })
      : await prisma.subscription.create({
          data: {
            userId: input.userId,
            planKey: input.planKey,
            status: input.status,
            providerKey: input.providerKey,
            externalRef: input.externalRef ?? null,
            periodStart: input.periodStart ?? null,
            periodEnd: input.periodEnd ?? null,
          },
        });
    return toSubscriptionView(row);
  }

  async getActiveSubscription(userId: string): Promise<SubscriptionView | null> {
    const row = await prisma.subscription.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    return row ? toSubscriptionView(row) : null;
  }

  async getBalance(userId: string): Promise<CreditBalanceView> {
    await this.requireUser(userId);
    return {
      userId,
      available: await availableCreditBalance(userId),
    };
  }

  async listLedger(userId: string): Promise<CreditLedgerEntryView[]> {
    await this.requireUser(userId);
    const rows = await prisma.creditLedger.findMany({
      where: { userId },
      orderBy: { recordedAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      entryType: row.entryType,
      quantity: row.quantity,
      reason: row.reason,
      source: row.source,
      relatedPaymentEventId: row.relatedPaymentEventId,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      recordedAt: row.recordedAt.toISOString(),
    }));
  }

  debitQuantityForUsage(intent: UsageDebitIntent): number | null {
    return debitQuantityForUsage(intent, this.creditPolicy);
  }

  /**
   * Structure-only spend. Returns null when UsageCreditPolicy coefficients
   * are TBD — never invents a 1 movie = 1 credit debit.
   */
  async trySpendForUsage(
    userId: string,
    intent: UsageDebitIntent,
    reason = "usage_debit",
  ): Promise<CreditLedgerEntryView | null> {
    const quantity = this.debitQuantityForUsage(intent);
    if (quantity == null) {
      return null;
    }
    const balance = await availableCreditBalance(userId);
    if (balance < quantity) {
      throw AppError.insufficientCredits();
    }
    return appendLedgerEntry({
      userId,
      entryType: CreditLedgerEntryType.SPEND,
      quantity,
      reason,
      source: CreditSource.PREPAID,
      recordedAt: this.now(),
    });
  }

  async listOffers(): Promise<OfferCatalogView[]> {
    await this.ensurePlanCatalog();
    const rows = await prisma.offerCatalog.findMany({ orderBy: { offerKey: "asc" } });
    return rows.map(toOfferView);
  }

  async getOffer(offerKey: string): Promise<OfferCatalogView | null> {
    await this.ensurePlanCatalog();
    const row = await prisma.offerCatalog.findUnique({ where: { offerKey } });
    return row ? toOfferView(row) : null;
  }

  expiryPolicy() {
    return CREDIT_EXPIRY_POLICY;
  }

  async ensurePlanCatalog() {
    for (const planKey of [PlanKey.FREE, PlanKey.PLUS, PlanKey.FAMILY]) {
      const shape = PLAN_GRANT_SHAPES[planKey];
      await prisma.offerCatalog.upsert({
        where: { offerKey: planOfferKey(planKey) },
        create: {
          offerKey: planOfferKey(planKey),
          offerKind: OfferKind.PLAN,
          planKey,
          packKey: null,
          grantShape: shape,
          priceAmount: null,
          priceCurrency: null,
        },
        update: {
          grantShape: shape,
          priceAmount: null,
          priceCurrency: null,
        },
      });
    }
  }

  private async requireUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw AppError.notFound("That account was not found.");
    }
  }
}

function toSubscriptionView(row: {
  id: string;
  userId: string;
  planKey: string;
  status: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  externalRef: string | null;
  providerKey: string;
}): SubscriptionView {
  return {
    id: row.id,
    userId: row.userId,
    planKey: row.planKey,
    status: row.status,
    periodStart: row.periodStart ? row.periodStart.toISOString() : null,
    periodEnd: row.periodEnd ? row.periodEnd.toISOString() : null,
    externalRef: row.externalRef,
    providerKey: row.providerKey,
  };
}

function toOfferView(row: {
  offerKey: string;
  offerKind: string;
  planKey: string | null;
  packKey: string | null;
  grantShape: unknown;
  priceAmount: number | null;
  priceCurrency: string | null;
}): OfferCatalogView {
  const fallback = row.planKey ? planGrantShape(row.planKey) : null;
  return {
    offerKey: row.offerKey,
    offerKind: row.offerKind,
    planKey: row.planKey,
    packKey: row.packKey,
    grantShape: (row.grantShape as PlanGrantShape | null) ?? fallback ?? PLAN_GRANT_SHAPES.FREE,
    priceAmount: row.priceAmount,
    priceCurrency: row.priceCurrency,
  };
}
