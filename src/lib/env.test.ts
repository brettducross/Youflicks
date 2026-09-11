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
