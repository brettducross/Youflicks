import { describe, expect, it } from "vitest";
import { MemorySpendLedger } from "@/server/gateways/yf-asset/ledger";
import { GatewaySpendCapError, SpendGuard } from "@/server/gateways/yf-asset/spend";

describe("SpendGuard", () => {
  it("caps jobs via YF_GATEWAY_MAX_JOBS", async () => {
    const guard = new SpendGuard(1, undefined, 0.4);
    expect(await guard.recordAccepted()).toBe(0.4);
    await expect(guard.recordAccepted()).rejects.toThrow(GatewaySpendCapError);
    expect(await guard.snapshot()).toMatchObject({
      jobsAccepted: 1,
      spendUsd: 0.4,
      maxJobs: 1,
    });
  });

  it("caps estimated spend via YF_GATEWAY_MAX_SPEND_USD", async () => {
    const guard = new SpendGuard(undefined, 1, 0.6);
    await guard.recordAccepted();
    await expect(guard.assertWithinCap()).rejects.toThrow(/spend cap/);
  });

  it("is ops-only and does not invent CreativePlan fields", async () => {
    const snapshot = await new SpendGuard(10, 5, 0.5).snapshot();
    expect(snapshot).not.toHaveProperty("plot");
    expect(snapshot).not.toHaveProperty("creativePlan");
    expect(snapshot).not.toHaveProperty("story");
  });

  it("survives restart when the ledger is durable", async () => {
    const ledger = new MemorySpendLedger();
    const first = new SpendGuard(10, 8, 0.5, ledger);
    await first.recordAccepted();
    await first.recordAccepted();
    const restarted = new SpendGuard(10, 8, 0.5, ledger);
    expect(await restarted.snapshot()).toMatchObject({
      jobsAccepted: 2,
      spendUsd: 1,
      maxJobs: 10,
      maxSpendUsd: 8,
    });
  });
});
