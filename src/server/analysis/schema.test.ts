import { describe, expect, it } from "vitest";
import {
  ANALYSIS_SCHEMA_VERSION,
  mediaAnalysisDocumentSchema,
} from "@/server/analysis/schema";

describe("YouFlicks analysis schema", () => {
  it("requires an explicit schema version", () => {
    const parsed = mediaAnalysisDocumentSchema.safeParse({
      technical: { mimeType: "image/png" },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts version 1.0 with only known technical fields", () => {
    const parsed = mediaAnalysisDocumentSchema.parse({
      analysisSchemaVersion: ANALYSIS_SCHEMA_VERSION,
      technical: { mimeType: "image/png", width: 640, height: 800 },
    });
    expect(parsed.analysisSchemaVersion).toBe("1.0");
    expect(parsed.visual).toBeUndefined();
    expect(parsed.people).toBeUndefined();
  });

  it("rejects fabricated confidence outside 0–1", () => {
    const parsed = mediaAnalysisDocumentSchema.safeParse({
      analysisSchemaVersion: ANALYSIS_SCHEMA_VERSION,
      quality: { overall: 4 },
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps extra future fields without failing", () => {
    const parsed = mediaAnalysisDocumentSchema.parse({
      analysisSchemaVersion: ANALYSIS_SCHEMA_VERSION,
      futureSection: { hello: true },
    });
    expect(parsed.analysisSchemaVersion).toBe("1.0");
  });
});
