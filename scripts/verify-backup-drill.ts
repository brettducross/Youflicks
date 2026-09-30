/**
 * Ops helper: fail-closed backup Evidence gate, plus an optional scratch restore.
 *
 * Usage (no secrets in git):
 *   npx tsx scripts/verify-backup-drill.ts
 *   npm run ops:verify-backup
 *   npm run ops:verify-backup -- --live
 *
 * Default mode reads docs/BETA_BACKUP_MONITORING.md and exits 1 with status
 * NOT_READY while any Evidence value is blank or `_fill_`. It does not write
 * that file and does not invent operator, RPO, RTO, or snapshot id.
 *
 * Live mode (flag, or both knobs set) requires BETA_BACKUP_SCRATCH_DATABASE_URL
 * and BETA_BACKUP_SNAPSHOT_PATH. Those knobs are not required at app or
 * gateway boot. Scratch must not string-equal DATABASE_URL.
 *
 * This script does not mint invites, open registration, or print secrets.
 */
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  BACKUP_EVIDENCE_DOC_PATH,
  evaluateBackupDrill,
} from "@/server/ops/backup-evidence";
import { runBackupLiveDryRun } from "@/server/ops/backup-restore";

loadEnv({ quiet: true });

async function main() {
  const liveFlag = process.argv.includes("--live");
  let markdown: string;
  try {
    markdown = readFileSync(BACKUP_EVIDENCE_DOC_PATH, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreadable evidence doc";
    console.error(
      `Backup evidence NOT_READY. Could not read ${BACKUP_EVIDENCE_DOC_PATH}. ${message}`,
    );
    process.exit(1);
  }

  const decision = await evaluateBackupDrill({
    markdown,
    env: process.env,
    liveFlag,
    runLive: (plan) => runBackupLiveDryRun(plan),
  });
  if (decision.stdout.length > 0) {
    console.log(decision.stdout);
  }
  if (decision.stderr.length > 0) {
    console.error(decision.stderr);
  }
  process.exit(decision.exitCode);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown backup drill error";
  console.error(message);
  process.exit(1);
});
