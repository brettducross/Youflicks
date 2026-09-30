import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAUNCH_EVIDENCE_PATHS,
  scanLaunchEvidence,
} from "@/server/ops/launch-evidence";

describe("scanLaunchEvidence", () => {
  it("refuses READY while any document still contains _fill_", () => {
    const result = scanLaunchEvidence([
      {
        path: "docs/BETA_WIPE_RUNBOOK.md",
        text: "| Operator | `_fill_` |\nUnfilled marker remains.\n",
      },
      {
        path: "docs/BETA_BACKUP_MONITORING.md",
        text: "| Sign-off | ada |\n",
      },
    ]);

    expect(result).toEqual({
      ready: false,
      files: ["docs/BETA_WIPE_RUNBOOK.md"],
    });
  });

  it("is ready only when a fixture contains no _fill_ markers", () => {
    const result = scanLaunchEvidence([
      { path: "docs/BETA_WIPE_RUNBOOK.md", text: "| Operator | ada |\n" },
      {
        path: "docs/BETA_BACKUP_MONITORING.md",
        text: "Drill signed. Empty cells are not the placeholder token.\n",
      },
      { path: "docs/LAUNCH_GATE_CHECKLIST.md", text: "| Date | Operator |\n| | |\n" },
    ]);

    expect(result).toEqual({ ready: true, files: [] });
  });

  it("lists every file that still has a marker, including a non-table mention", () => {
    const result = scanLaunchEvidence([
      { path: "docs/a.md", text: "still _fill_ in prose\n" },
      { path: "docs/b.md", text: "clean\n" },
      { path: "docs/c.md", text: "_fill_\n_fill_\n" },
    ]);

    expect(result.ready).toBe(false);
    expect(result.files).toEqual(["docs/a.md", "docs/c.md"]);
  });
});

describe("DEFAULT_LAUNCH_EVIDENCE_PATHS", () => {
  it("scans the backup runbook, wipe runbook, and launch checklist", () => {
    expect([...DEFAULT_LAUNCH_EVIDENCE_PATHS]).toEqual([
      "docs/BETA_BACKUP_MONITORING.md",
      "docs/BETA_WIPE_RUNBOOK.md",
      "docs/LAUNCH_GATE_CHECKLIST.md",
    ]);
  });
});
