import { describe, expect, it } from "vitest";
import { GatewaySpendCapError, SpendGuard } from "@/server/gateways/yf-asset/spend";

describe("SpendGuard", () => {
  it("caps jobs via YF_GATEWAY_MAX_JOBS", () => {
    const guard = new SpendGuard(1, undefined, 0.4);
    expect(guard.recordAccepted()).toBe(0.4);
    expect(() => guard.recordAccepted()).toThrow(GatewaySpendCapError);
    expect(guard.snapshot()).toMatchObject({
      jobsAccepted: 1,
      spendUsd: 0.4,
      maxJobs: 1,
    });
  });

  it("caps estimated spend via YF_GATEWAY_MAX_SPEND_USD", () => {
    const guard = new SpendGuard(undefined, 1, 0.6);
    guard.recordAccepted();
    expect(() => guard.assertWithinCap()).toThrow(/spend cap/);
  });

  it("is ops-only and does not invent CreativePlan fields", () => {
    const snapshot = new SpendGuard(10, 5, 0.5).snapshot();
    expect(snapshot).not.toHaveProperty("plot");
    expect(snapshot).not.toHaveProperty("creativePlan");
    expect(snapshot).not.toHaveProperty("story");
  });
});
