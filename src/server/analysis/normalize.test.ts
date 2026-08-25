import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { ANALYSIS_SCHEMA_VERSION } from "@/server/analysis/schema";
import { normalizeAnalysisResult } from "@/server/analysis/normalize";

describe("normalizeAnalysisResult", () => {
  it("stamps the YouFlicks schema version and keeps provenance", () => {
    const result = normalizeAnalysisResult({
      providerKey: "test.alpha",
      modelId: "alpha-1",
      modelVersion: "9",
      observations: {
        technical: { mimeType: "video/mp4", width: 320, height: 180 },
      },
    });
    expect(result.analysis.analysisSchemaVersion).toBe(ANALYSIS_SCHEMA_VERSION);
    expect(result.provenance).toEqual({
      providerKey: "test.alpha",
      modelId: "alpha-1",
      modelVersion: "9",
    });
    expect(result.analysis.visual).toBeUndefined();
  });

  it("rejects invalid provider output", () => {
    expect(() =>
      normalizeAnalysisResult({
        providerKey: "test.bad",
        observations: {
          technical: { width: "wide" as unknown as number },
        },
      }),
    ).toThrow(AppError);
  });

  it("rejects a missing observations object", () => {
    expect(() =>
      normalizeAnalysisResult({
        providerKey: "test.bad",
        observations: null as unknown as Record<string, unknown>,
      }),
    ).toThrow(/observations/);
  });
});
