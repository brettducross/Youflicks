import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertProductionStorageDriver, PRODUCTION_LOCAL_STORAGE_ERROR } from "@/lib/env";

describe("assertProductionStorageDriver", () => {
  it("refuses boot when production STORAGE_DRIVER is local (including unset→local)", () => {
    expect(() => assertProductionStorageDriver("production", "local")).toThrow(
      PRODUCTION_LOCAL_STORAGE_ERROR,
    );
  });

  it("allows r2 and s3 in production", () => {
    expect(() => assertProductionStorageDriver("production", "r2")).not.toThrow();
    expect(() => assertProductionStorageDriver("production", "s3")).not.toThrow();
  });

  it("keeps local disk allowed outside production", () => {
    expect(() => assertProductionStorageDriver("development", "local")).not.toThrow();
    expect(() => assertProductionStorageDriver("test", "local")).not.toThrow();
  });
});

describe(".env.example launch-gate hygiene", () => {
  const example = readFileSync(".env.example", "utf8");
  const activeLines = example
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  it("does not set BETA_INVITE_ONLY=false as an active value", () => {
    expect(activeLines.some((line) => /^BETA_INVITE_ONLY="false"$/.test(line))).toBe(false);
    expect(activeLines.some((line) => /^BETA_INVITE_ONLY="true"$/.test(line))).toBe(true);
  });

  it("keeps production-unsafe local/log values documented as local-only", () => {
    expect(example).toMatch(/LOCAL \/ DEV TEMPLATE/);
    expect(example).toMatch(/docs\/LAUNCH_GATE_CHECKLIST\.md/);
    expect(activeLines.some((line) => /^STORAGE_DRIVER="local"$/.test(line))).toBe(true);
    expect(activeLines.some((line) => /^EMAIL_DRIVER="log"$/.test(line))).toBe(true);
  });
});
