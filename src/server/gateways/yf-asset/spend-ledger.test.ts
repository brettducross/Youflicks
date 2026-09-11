import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { PrismaSpendLedger } from "@/server/gateways/yf-asset/ledger";
import { GatewaySpendCapError, SpendGuard } from "@/server/gateways/yf-asset/spend";

describe("PrismaSpendLedger W1.2", () => {
  const ledgerId = `spend-test-${Date.now()}`;

  afterAll(async () => {
    await prisma.gatewaySpendLedger.deleteMany({ where: { id: ledgerId } });
  });

  it("does not reset spend across a new SpendGuard instance", async () => {
    const ledger = new PrismaSpendLedger(prisma, ledgerId);
    const first = new SpendGuard(10, 8, 1, ledger);
    await first.recordAccepted();
    const restarted = new SpendGuard(10, 8, 1, ledger);
    expect(await restarted.snapshot()).toMatchObject({
      jobsAccepted: 1,
      spendUsd: 1,
      maxJobs: 10,
      maxSpendUsd: 8,
    });
    const cheap = new SpendGuard(10, 1.5, 1, ledger);
    await expect(cheap.recordAccepted()).rejects.toBeInstanceOf(GatewaySpendCapError);
  });
});
