import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UsageKind } from "@/server/usage/types";
import {
  DEFAULT_USAGE_CREDIT_POLICY,
  debitQuantityForUsage,
} from "@/server/billing/usage-credit-policy";

describe("UsageCreditPolicy", () => {
  it("does not hard-code 1 MOVIE_GENERATION = 1 credit as the default path", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/server/billing/usage-credit-policy.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/MOVIE_GENERATION\s*:\s*1/);
    expect(src).not.toMatch(/AI_DIRECT\s*[=:]\s*1/);
    expect(DEFAULT_USAGE_CREDIT_POLICY.creditsPerCostUnit).toBeNull();
    expect(DEFAULT_USAGE_CREDIT_POLICY.creditsPerUsageQuantity).toEqual({});
    expect(
      debitQuantityForUsage({ kind: UsageKind.MOVIE_GENERATION, quantity: 1 }),
    ).toBeNull();
    expect(
      debitQuantityForUsage({
        kind: UsageKind.MOVIE_GENERATION,
        quantity: 1,
        costUnits: 100,
      }),
    ).toBeNull();
  });

  it("debits from configured engine-cost coefficients, not a movie constant", () => {
    const config = {
      creditsPerCostUnit: 0.02,
      creditsPerUsageQuantity: {} as Record<string, number | null>,
    };
    expect(
      debitQuantityForUsage(
        { kind: UsageKind.MOVIE_GENERATION, quantity: 1, costUnits: 250 },
        config,
      ),
    ).toBe(5);
    expect(
      debitQuantityForUsage(
        { kind: UsageKind.RENDER_SECONDS, quantity: 8, costUnits: 250 },
        config,
      ),
    ).toBe(5);
    expect(
      debitQuantityForUsage(
        { kind: UsageKind.ASSET_CALL, quantity: 3, costUnits: 40 },
        config,
      ),
    ).toBe(0.8);
  });

  it("uses per-kind config only when supplied, including non-movie kinds", () => {
    const config = {
      creditsPerCostUnit: null,
      creditsPerUsageQuantity: {
        RENDER_SECONDS: 0.25,
        ASSET_CALL: 2,
      },
    };
    expect(
      debitQuantityForUsage({ kind: UsageKind.RENDER_SECONDS, quantity: 8 }, config),
    ).toBe(2);
    expect(debitQuantityForUsage({ kind: UsageKind.ASSET_CALL, quantity: 2 }, config)).toBe(
      4,
    );
    expect(
      debitQuantityForUsage({ kind: UsageKind.MOVIE_GENERATION, quantity: 1 }, config),
    ).toBeNull();
  });
});
