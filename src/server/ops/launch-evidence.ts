/**
 * CI-safe scan for unsigned launch-evidence placeholders.
 * Ready is true only when none of the documents still contain `_fill_`.
 * A ready result does not authorize invites.
 *
 * Empty Date/Operator cells are not inferred. Only the explicit `_fill_`
 * token counts, so unrelated tables are not false positives.
 */
export const LAUNCH_EVIDENCE_FILL_TOKEN = "_fill_";

export const DEFAULT_LAUNCH_EVIDENCE_PATHS = [
  "docs/BETA_BACKUP_MONITORING.md",
  "docs/BETA_WIPE_RUNBOOK.md",
  "docs/LAUNCH_GATE_CHECKLIST.md",
] as const;

export type LaunchEvidenceDocument = {
  path: string;
  text: string;
};

export type LaunchEvidenceScan = {
  ready: boolean;
  files: string[];
};

export function scanLaunchEvidence(
  documents: readonly LaunchEvidenceDocument[],
): LaunchEvidenceScan {
  const files = documents
    .filter((document) => document.text.includes(LAUNCH_EVIDENCE_FILL_TOKEN))
    .map((document) => document.path);
  return {
    ready: files.length === 0,
    files,
  };
}
