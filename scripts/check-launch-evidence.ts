/**
 * Fail closed while launch-evidence markdown still has unfilled `_fill_`
 * placeholder cells. Legends that only name the token do not count.
 * RPO/RTO target cells count the same as Evidence cells.
 *
 *   npm run ops:check-launch-evidence
 *
 * Exit 1 while any placeholder cell remains (expected on an unsigned tip).
 * Exit 0 only when none remain. Exit 0 does not authorize invites.
 * This script reads docs only. It does not use Sentry, R2, or other secrets.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_LAUNCH_EVIDENCE_PATHS,
  scanLaunchEvidence,
  type LaunchEvidenceDocument,
} from "@/server/ops/launch-evidence";

const INVITE_DISCLAIMER =
  "This result does not authorize invites, minting, or CLEAR-FOR-INVITES.";

function loadDocuments(): LaunchEvidenceDocument[] {
  const documents: LaunchEvidenceDocument[] = [];
  for (const path of DEFAULT_LAUNCH_EVIDENCE_PATHS) {
    try {
      documents.push({
        path,
        text: readFileSync(resolve(process.cwd(), path), "utf8"),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unreadable";
      console.error(`NOT_READY: cannot read ${path} (${message})`);
      console.error(INVITE_DISCLAIMER);
      process.exit(1);
    }
  }
  return documents;
}

const result = scanLaunchEvidence(loadDocuments());
const payload = JSON.stringify({ ready: result.ready, files: result.files });

if (!result.ready) {
  console.error(payload);
  console.error(INVITE_DISCLAIMER);
  process.exit(1);
}

console.log(payload);
console.log(INVITE_DISCLAIMER);
