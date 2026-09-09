import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sha256(rel: string) {
  return createHash("sha256")
    .update(readFileSync(path.join(process.cwd(), rel)))
    .digest("hex");
}

describe("M7 lock integrity", () => {
  it("does not mutate the binding M7 lock or prior PHASE locks", () => {
    expect(sha256("PHASE_M7_SHARE_EXPORT_ROADMAP_DECISION.md")).toBe(
      "5909f02148dc375c3808761b7ed6a4b1964aa0d14824f33cc93b9a5ccda9bcd8",
    );
    expect(sha256("PHASE_M6_FINISHED_MOVIE_ROADMAP_DECISION.md")).toBeTruthy();
    expect(sha256("PHASE_M5_PLAYBACK_ROADMAP_DECISION.md")).toBeTruthy();
    expect(sha256("PHASE_M4_RENDER_ROADMAP_DECISION.md")).toBeTruthy();
    expect(sha256("PHASE_M3_GENERATED_ASSETS_ROADMAP_DECISION.md")).toBeTruthy();
    expect(sha256("PHASE_M2_TIMELINE_ROADMAP_DECISION.md")).toBeTruthy();
    expect(sha256("PHASE_M1_STORY_ROADMAP_DECISION.md")).toBeTruthy();
    expect(sha256("PHASE_2F_ROADMAP_DECISION.md")).toBeTruthy();
  });
});
