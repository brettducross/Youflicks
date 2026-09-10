import { AppError } from "@/lib/errors";
import { prisma } from "@/server/db";
import {
  CREDIT_EXPIRY_POLICY,
  CreditExpiryPolicy,
  CreditLedgerEntryType,
  type CreditLedgerEntryView,
} from "@/server/billing/types";
import { creditExpiryAllowed } from "@/server/billing/credit-expiry";

const BALANCE_TYPES = new Set<string>([
  CreditLedgerEntryType.GRANT,
  CreditLedgerEntryType.ADJUST,
]);

const DEBIT_TYPES = new Set<string>([
  CreditLedgerEntryType.SPEND,
  CreditLedgerEntryType.REFUND,
]);

export async function availableCreditBalance(userId: string): Promise<number> {
  const rows = await prisma.creditLedger.findMany({
    where: { userId },
    select: { entryType: true, quantity: true },
  });
  let available = 0;
  for (const row of rows) {
    if (row.entryType === CreditLedgerEntryType.EXPIRE) {
      continue;
    }
    if (BALANCE_TYPES.has(row.entryType)) {
      available += row.quantity;
    } else if (DEBIT_TYPES.has(row.entryType)) {
      available -= row.quantity;
    }
  }
  return available;
}

export async function appendLedgerEntry(input: {
  userId: string;
  entryType: string;
  quantity: number;
  reason?: string | null;
  source?: string | null;
  relatedPaymentEventId?: string | null;
  recordedAt?: Date;
}): Promise<CreditLedgerEntryView> {
  if (input.entryType === CreditLedgerEntryType.EXPIRE && !creditExpiryAllowed()) {
    throw AppError.validation(
      "Credit expiry is reserved. Initial policy is NEVER — unused credits must not disappear.",
      { policy: CREDIT_EXPIRY_POLICY },
    );
  }
  if (input.quantity < 0) {
    throw AppError.validation("Ledger quantity must be non-negative.");
  }

  const recordedAt = input.recordedAt ?? new Date();
  const expiresAt =
    CREDIT_EXPIRY_POLICY === CreditExpiryPolicy.NEVER ? null : undefined;

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.creditLedger.create({
      data: {
        userId: input.userId,
        entryType: input.entryType,
        quantity: input.quantity,
        reason: input.reason ?? null,
        source: input.source ?? null,
        relatedPaymentEventId: input.relatedPaymentEventId ?? null,
        expiresAt: expiresAt ?? null,
        recordedAt,
      },
    });
    const rows = await tx.creditLedger.findMany({
      where: { userId: input.userId },
      select: { entryType: true, quantity: true },
    });
    let available = 0;
    for (const entry of rows) {
      if (entry.entryType === CreditLedgerEntryType.EXPIRE) {
        continue;
      }
      if (BALANCE_TYPES.has(entry.entryType)) {
        available += entry.quantity;
      } else if (DEBIT_TYPES.has(entry.entryType)) {
        available -= entry.quantity;
      }
    }
    await tx.creditBalance.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, available },
      update: { available },
    });
    return created;
  });

  return toLedgerView(row);
}

export function toLedgerView(row: {
  id: string;
  userId: string;
  entryType: string;
  quantity: number;
  reason: string | null;
  source: string | null;
  relatedPaymentEventId: string | null;
  expiresAt: Date | null;
  recordedAt: Date;
}): CreditLedgerEntryView {
  return {
    id: row.id,
    userId: row.userId,
    entryType: row.entryType,
    quantity: row.quantity,
    reason: row.reason,
    source: row.source,
    relatedPaymentEventId: row.relatedPaymentEventId,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    recordedAt: row.recordedAt.toISOString(),
  };
}
