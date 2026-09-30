import { describe, expect, it } from "vitest";
import {
  holdExpectedChargeMismatch,
  readReservationEcho,
  reservationChargeMismatch,
  SharedDurationError,
  sharedGatewayRequestedDurationS,
  type ReservationChargeSnapshot,
} from "@/server/sg/lane-rate";

function hold(overrides: Partial<ReservationChargeSnapshot> = {}): ReservationChargeSnapshot {
  return {
    laneId: "r1-wan27-replicate",
    modelId: "wan-video/wan-2.7-i2v",
    usdPerSecond: 0.1,
    estimatedBilledSeconds: 5,
    usd: 0.5,
    ...overrides,
  };
}

describe("reservation receipt verify", () => {
  it("matches when lane, model, seconds, and usd are the same charge", () => {
    const app = hold();
    const gateway = hold();
    expect(reservationChargeMismatch(app, gateway)).toBeNull();
    expect(app).toEqual(hold());
    expect(gateway).toEqual(hold());
  });

  it("fails when the gateway laneId differs from the hold", () => {
    expect(reservationChargeMismatch(hold(), hold({ laneId: "other-lane" }))).toBe("laneId");
  });

  it("fails when the gateway modelId differs from the hold", () => {
    expect(reservationChargeMismatch(hold(), hold({ modelId: "other-model" }))).toBe("modelId");
  });

  it("fails when billed seconds differ", () => {
    expect(reservationChargeMismatch(hold(), hold({ estimatedBilledSeconds: 8, usd: 0.8 }))).toBe(
      "estimatedBilledSeconds",
    );
  });

  it("fails when reserved usd differs and seconds match", () => {
    expect(reservationChargeMismatch(hold(), hold({ usd: 0.8 }))).toBe("usd");
  });

  it("fails the pre-generate check when usdPerSecond on the hold was tampered", () => {
    expect(
      holdExpectedChargeMismatch(
        { estimatedBilledSeconds: 5, usdPerSecond: 1.1, estimatedUsd: 0.5 },
        { estimatedBilledSeconds: 5, usdPerSecond: 0.1, reservedUsd: 0.5 },
      ),
    ).toBe("usdPerSecond");
  });

  it("passes the pre-generate check when the hold still matches the expected charge", () => {
    expect(
      holdExpectedChargeMismatch(
        { estimatedBilledSeconds: 5, usdPerSecond: 0.1, estimatedUsd: 0.5 },
        { estimatedBilledSeconds: 5, usdPerSecond: 0.1, reservedUsd: 0.5 },
      ),
    ).toBeNull();
  });

  it("reads a shared duration and fails closed on invalid JSON", () => {
    expect(sharedGatewayRequestedDurationS("")).toBeUndefined();
    expect(sharedGatewayRequestedDurationS(JSON.stringify({ prompt: "x" }))).toBeUndefined();
    expect(sharedGatewayRequestedDurationS(JSON.stringify({ duration: 8 }))).toBe(8);
    expect(() => sharedGatewayRequestedDurationS("{")).toThrow(SharedDurationError);
    expect(readReservationEcho({ laneId: "a" })).toBeNull();
    expect(
      readReservationEcho({
        laneId: "r1-wan27-replicate",
        modelId: "wan-video/wan-2.7-i2v",
        usdPerSecond: 0.1,
        estimatedBilledSeconds: 5,
        reservedUsd: 0.5,
      })?.reservedUsd,
    ).toBe(0.5);
  });
});
