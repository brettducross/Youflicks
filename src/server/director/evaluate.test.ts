import { describe, expect, it } from "vitest";
import { createDirectorEvaluationBoundary } from "@/server/director/evaluate";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import type { DirectorInput } from "@/server/director/input";

describe("Director evaluation boundary", () => {
  it("does not invent scores or confidence", () => {
    const result = createDirectorEvaluationBoundary({
      input: { projectId: "p1" } as DirectorInput,
      plan: { schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION },
      focus: ["project_intent", "pacing"],
    });
    expect(result.status).toBe("NOT_IMPLEMENTED");
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("confidence");
  });
});
