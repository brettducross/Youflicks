import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { validateCreativePlan } from "@/server/director/validate";
import { JobType } from "@/server/domain/status";
import { BillingJobType } from "@/server/billing/types";

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkFiles(full, acc);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("M8.5a / M8.6 commercial boundary", () => {
  it("forbids BillingPort imports in Director adapters and compose path", () => {
    const roots = [
      path.join(process.cwd(), "src/server/adapters/director"),
      path.join(process.cwd(), "src/server/director"),
      path.join(process.cwd(), "src/server/services/director.ts"),
      path.join(process.cwd(), "src/server/services/director-contract.ts"),
      path.join(process.cwd(), "src/server/services/director-worker.ts"),
    ];
    const files = roots.flatMap((root) =>
      statSync(root).isDirectory() ? walkFiles(root) : [root],
    );
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/@\/server\/ports\/billing/);
      expect(src, file).not.toMatch(/BillingPort/);
      expect(src, file).not.toMatch(/CreditLedger/);
      expect(src, file).not.toMatch(/UsageCreditPolicy/);
    }
  });

  it("rejects planKey / credits on CreativePlan and keeps IN_MOVIE out of JobType", () => {
    expect(() =>
      validateCreativePlan({
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "Birthday dock",
        planKey: "FAMILY",
        credits: 4,
      }),
    ).toThrow(/commercial entitlement/i);
    expect("AI_BILL" in JobType).toBe(false);
    expect("AI_ADS" in JobType).toBe(false);
    expect(BillingJobType.BILLING_WEBHOOK).toBe("BILLING_WEBHOOK");
  });

  it("does not hard-wire an ad network or payment vendor into domain files", () => {
    const domainFiles = [
      "src/server/billing/types.ts",
      "src/server/billing/plan-catalog.ts",
      "src/server/ports/billing.ts",
      "src/server/ports/advertising.ts",
      "src/server/advertising/types.ts",
      "src/server/services/billing.ts",
      "src/server/services/advertising.ts",
    ];
    for (const rel of domainFiles) {
      const src = readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src, rel).not.toMatch(/stripe|paddle|adsense|admob|googleads/i);
    }
  });
});
