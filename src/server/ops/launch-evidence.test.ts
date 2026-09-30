import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAUNCH_EVIDENCE_PATHS,
  scanLaunchEvidence,
} from "@/server/ops/launch-evidence";

describe("scanLaunchEvidence", () => {
  it("refuses READY while a placeholder cell remains", () => {
    const result = scanLaunchEvidence([
      {
        path: "docs/BETA_WIPE_RUNBOOK.md",
        text: [
          "Unfilled `_fill_` means the wipe drill is **not** signed.",
          "| Operator | `_fill_` |",
        ].join("\n"),
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

  it("keeps backup RPO and RTO placeholder cells in scope", () => {
    const result = scanLaunchEvidence([
      {
        path: "docs/BETA_BACKUP_MONITORING.md",
        text: [
          "| Target | Value | Notes |",
          "| --- | --- | --- |",
          "| RPO (max acceptable data loss) | `_fill_` | Snapshot schedule must be at least this tight |",
          "| RTO (max acceptable restore time) | 15 min | Clock starts at declare restore |",
          "Unfilled `_fill_` means the drill is **not** signed.",
        ].join("\n"),
      },
    ]);

    expect(result).toEqual({
      ready: false,
      files: ["docs/BETA_BACKUP_MONITORING.md"],
    });
  });

  it("is ready when cells are filled even if legends name the token", () => {
    const result = scanLaunchEvidence([
      {
        path: "docs/BETA_WIPE_RUNBOOK.md",
        text: [
          "Unfilled `_fill_` means the wipe drill is **not** signed.",
          "| Request time (PT) | 2026-09-30 10:00 PT |",
          "| Sign-off | ada |",
          "Unfilled `_fill_` means this wipe drill is **not** signed. Do not claim READY from code that already deletes objects.",
        ].join("\n"),
      },
      {
        path: "docs/BETA_BACKUP_MONITORING.md",
        text: [
          "| RPO (max acceptable data loss) | 1 hour | Snapshot schedule must be at least this tight |",
          "| RTO (max acceptable restore time) | 15 min | Clock starts at declare restore |",
          "| Sign-off (Brett or delegated ops) | ada |",
          "Unfilled `_fill_` means the drill is **not** signed. Do not treat a merged PR as a completed restore.",
        ].join("\n"),
      },
      {
        path: "docs/LAUNCH_GATE_CHECKLIST.md",
        text: "| Date | Operator |\n| | |\n",
      },
    ]);

    expect(result).toEqual({ ready: true, files: [] });
  });

  it("does not treat a non-table mention as an unfilled placeholder", () => {
    const result = scanLaunchEvidence([
      { path: "docs/a.md", text: "still _fill_ in prose\n" },
      { path: "docs/b.md", text: "clean\n" },
      { path: "docs/c.md", text: "_fill_\n_fill_\n" },
      { path: "docs/d.md", text: "| Operator | _fill_ |\n" },
    ]);

    expect(result.ready).toBe(false);
    expect(result.files).toEqual(["docs/d.md"]);
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
