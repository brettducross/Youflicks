/**
 * CI-safe scan for unsigned launch-evidence placeholder cells.
 *
 * A markdown table cell counts only when its trimmed value is `_fill_`
 * or `` `_fill_` ``. Explanatory prose that names the token does not count,
 * so runbook legends can stay after the host fills the cells.
 *
 * Every such cell counts, including backup RPO/RTO target cells that sit
 * outside an Evidence heading. Limiting the scan to Evidence sections would
 * drop those cells. Empty Date/Operator cells are not inferred.
 *
 * Ready is true only when no placeholder cell remains.
 * A ready result does not authorize invites.
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

function isPlaceholderCell(cell: string): boolean {
  const value = cell.trim();
  if (value === LAUNCH_EVIDENCE_FILL_TOKEN) {
    return true;
  }
  return (
    value.length === LAUNCH_EVIDENCE_FILL_TOKEN.length + 2 &&
    value.startsWith("`") &&
    value.endsWith("`") &&
    value.slice(1, -1) === LAUNCH_EVIDENCE_FILL_TOKEN
  );
}

export function lineHasPlaceholderCell(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.includes("|", 1)) {
    return false;
  }
  const cells = trimmed.split("|");
  const inner = cells.slice(1, trimmed.endsWith("|") ? -1 : undefined);
  return inner.some(isPlaceholderCell);
}

export function scanLaunchEvidence(
  documents: readonly LaunchEvidenceDocument[],
): LaunchEvidenceScan {
  const files = documents
    .filter((document) => document.text.split(/\r?\n/).some(lineHasPlaceholderCell))
    .map((document) => document.path);
  return {
    ready: files.length === 0,
    files,
  };
}
