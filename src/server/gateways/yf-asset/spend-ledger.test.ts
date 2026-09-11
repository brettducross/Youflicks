import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { GatewaySpendCapError, PrismaSpendLedger } from "@/server/gateways/yf-asset/ledger";
import { SpendGuard } from "@/server/gateways/yf-asset/spend";

describe("PrismaSpendLedger W1.2", () => {
  const ledgerId = `spend-test-${Date.now()}`;
  const raceId = `spend-race-${Date.now()}`;

  afterAll(async () => {
    await prisma.gatewaySpendLedger.deleteMany({ where: { id: { in: [ledgerId, raceId] } } });
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

  it("serializes concurrent tryReserve so maxJobs cannot overshoot", async () => {
    const ledger = new PrismaSpendLedger(prisma, raceId);
    const attempts = Array.from({ length: 20 }, () =>
      ledger.tryReserve(1, { maxJobs: 1, maxSpendUsd: 100 }),
    );
    const results = await Promise.allSettled(attempts);
    const accepted = results.filter((result) => result.status === "fulfilled");
    const denied = results.filter((result) => result.status === "rejected");
    expect(accepted).toHaveLength(1);
    expect(denied).toHaveLength(19);
    for (const result of denied) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(GatewaySpendCapError);
      }
    }
    expect(await ledger.snapshot()).toEqual({ jobsAccepted: 1, spendUsd: 1 });
  });
});
