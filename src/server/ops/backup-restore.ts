/**
 * Optional scratch-database restore. Callers must already have refused a
 * scratch URL that string-equals DATABASE_URL. This module never reads or
 * writes the Evidence markdown file.
 */
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { Client } from "pg";
import {
  assertBackupSurvival,
  BACKUP_DRILL_EXPECTED_COUNTS_INVALID,
  BACKUP_DRILL_RESTORE_FAILED,
  BACKUP_DRILL_RESTORE_TOOL_MISSING,
  BACKUP_DRILL_SCRATCH_EQUALS_DATABASE,
  BACKUP_DRILL_SNAPSHOT_UNREADABLE,
  BACKUP_DRILL_SURVIVAL_FAILED,
  parseBackupExpectedAssertions,
  scratchTargetsProduction,
  type BackupExpectedAssertions,
  type BackupLiveReady,
  type BackupLiveRunResult,
  type SqlClient,
  type SqlRow,
} from "@/server/ops/backup-evidence";

export type RestoreFormat = "custom" | "sql";

export type RestoreInvocation = {
  command: "pg_restore" | "psql";
  args: string[];
};

export type BackupRestoreDeps = {
  snapshotReadable: (filePath: string) => boolean;
  readHeader: (filePath: string) => Uint8Array;
  readText: (filePath: string) => string;
  spawnRestore: (
    command: string,
    args: readonly string[],
  ) => Promise<{ code: number; stderr: string }>;
  connect: (connectionString: string) => Promise<SqlClient & { end: () => Promise<void> }>;
};

export function detectSnapshotFormat(header: Uint8Array): RestoreFormat {
  const magic = Buffer.from(header.subarray(0, 5)).toString("ascii");
  return magic === "PGDMP" ? "custom" : "sql";
}

export function readSnapshotHeader(filePath: string): Uint8Array {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(5);
    const bytesRead = readSync(fd, buffer, 0, 5, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

export function snapshotFileReadable(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function buildRestoreInvocation(input: {
  format: RestoreFormat;
  snapshotPath: string;
  scratchDatabaseUrl: string;
}): RestoreInvocation {
  if (input.format === "custom") {
    return {
      command: "pg_restore",
      args: [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--dbname",
        input.scratchDatabaseUrl,
        input.snapshotPath,
      ],
    };
  }
  return {
    command: "psql",
    args: [
      input.scratchDatabaseUrl,
      "-w",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      input.snapshotPath,
    ],
  };
}

export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  const trimmed = secret.trim();
  let redacted = text.split(secret).join("[redacted]");
  if (trimmed && trimmed !== secret) {
    redacted = redacted.split(trimmed).join("[redacted]");
  }
  return redacted;
}

export function spawnRestoreCommand(
  command: string,
  args: readonly string[],
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "ignore", "pipe"] });
    const stderrChunks: Buffer[] = [];
    let settled = false;
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const stderr = Buffer.concat(stderrChunks).toString("utf8").slice(-4000);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

async function connectScratch(
  connectionString: string,
): Promise<SqlClient & { end: () => Promise<void> }> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
    application_name: "youflicks-backup-drill",
  });
  await client.connect();
  await client.query("SET statement_timeout = 60000");
  return {
    query: async (sql, params) => {
      const result = await client.query<SqlRow>(sql, (params ? [...params] : undefined) as never);
      return { rows: result.rows };
    },
    end: () => client.end(),
  };
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function defaultDeps(): BackupRestoreDeps {
  return {
    snapshotReadable: snapshotFileReadable,
    readHeader: readSnapshotHeader,
    readText: (filePath) => readFileSync(filePath, "utf8"),
    spawnRestore: spawnRestoreCommand,
    connect: connectScratch,
  };
}

export async function runBackupLiveDryRun(
  plan: BackupLiveReady,
  deps: BackupRestoreDeps = defaultDeps(),
): Promise<BackupLiveRunResult> {
  if (scratchTargetsProduction(plan.scratchDatabaseUrl, plan.databaseUrl)) {
    return { ok: false, reason: BACKUP_DRILL_SCRATCH_EQUALS_DATABASE };
  }
  if (!deps.snapshotReadable(plan.snapshotPath)) {
    return { ok: false, reason: BACKUP_DRILL_SNAPSHOT_UNREADABLE };
  }

  let assertions: BackupExpectedAssertions = { minCounts: {}, checksums: {} };
  if (plan.expectedCountsPath) {
    let text: string;
    try {
      text = deps.readText(plan.expectedCountsPath);
    } catch {
      return { ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID };
    }
    const parsed = parseBackupExpectedAssertions(text);
    if (!parsed.ok) return parsed;
    assertions = parsed.assertions;
  }

  const invocation = buildRestoreInvocation({
    format: detectSnapshotFormat(deps.readHeader(plan.snapshotPath)),
    snapshotPath: plan.snapshotPath,
    scratchDatabaseUrl: plan.scratchDatabaseUrl,
  });

  let restore: { code: number; stderr: string };
  try {
    restore = await deps.spawnRestore(invocation.command, invocation.args);
  } catch (error) {
    const detail = redactSecret(
      error instanceof Error ? error.message : "unknown restore error",
      plan.scratchDatabaseUrl,
    );
    if (isEnoent(error)) {
      return { ok: false, reason: BACKUP_DRILL_RESTORE_TOOL_MISSING, detail };
    }
    return { ok: false, reason: BACKUP_DRILL_RESTORE_FAILED, detail };
  }
  if (restore.code !== 0) {
    return {
      ok: false,
      reason: BACKUP_DRILL_RESTORE_FAILED,
      detail: redactSecret(restore.stderr.trim(), plan.scratchDatabaseUrl),
    };
  }

  let connected: (SqlClient & { end: () => Promise<void> }) | null = null;
  try {
    connected = await deps.connect(plan.scratchDatabaseUrl);
    const survival = await assertBackupSurvival(connected, assertions);
    if (!survival.ok) return survival;
    return { ok: true, counts: survival.counts };
  } catch (error) {
    const detail = redactSecret(
      error instanceof Error ? error.message : "unknown scratch check error",
      plan.scratchDatabaseUrl,
    );
    return { ok: false, reason: BACKUP_DRILL_SURVIVAL_FAILED, detail };
  } finally {
    if (connected) {
      try {
        await connected.end();
      } catch {
        // The survival result is the operator-facing outcome.
      }
    }
  }
}
