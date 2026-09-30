/**
 * Pure backup-drill evidence gate and live-mode resolver.
 * Reads markdown text the caller already loaded. Does not write files,
 * invent operator / RPO / RTO / snapshot ids, or open a database connection.
 */

export const BACKUP_EVIDENCE_DOC_PATH = "docs/BETA_BACKUP_MONITORING.md";

export const BACKUP_DRILL_LIVE_FAIL_CLOSED =
  "Backup drill refused: live mode requires BETA_BACKUP_SCRATCH_DATABASE_URL and BETA_BACKUP_SNAPSHOT_PATH. Missing or empty knobs fail closed. No restore was attempted.";

export const BACKUP_DRILL_SCRATCH_EQUALS_DATABASE =
  "Backup drill refused: BETA_BACKUP_SCRATCH_DATABASE_URL equals DATABASE_URL. Scratch restore must not target the production database. No restore was attempted.";

export const BACKUP_DRILL_SNAPSHOT_UNREADABLE =
  "Backup drill refused: BETA_BACKUP_SNAPSHOT_PATH is missing or unreadable. No restore was attempted.";

export const BACKUP_DRILL_EXPECTED_COUNTS_INVALID =
  "Backup drill refused: BETA_BACKUP_EXPECTED_COUNTS_JSON is missing or invalid. No restore was attempted.";

export const BACKUP_DRILL_RESTORE_FAILED =
  "Backup drill failed: snapshot restore exited non-zero. No success was claimed.";

export const BACKUP_DRILL_RESTORE_TOOL_MISSING =
  "Backup drill failed: pg_restore or psql could not be started. No success was claimed.";

export const BACKUP_DRILL_SURVIVAL_FAILED =
  "Backup drill failed: scratch survival check did not pass. No success was claimed.";

/** Runbook §4 tables that must exist after a scratch restore. */
export const BACKUP_SURVIVAL_TABLES = [
  "gateway_spend_ledger",
  "ai_processing_consent",
  "beta_invite",
  "project",
  "media_asset",
  "generated_asset",
  "render_job",
  "finished_movie",
  "user",
] as const;

export type BackupSurvivalTable = (typeof BACKUP_SURVIVAL_TABLES)[number];

const SAFE_TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const MD5_HEX = /^[0-9a-f]{32}$/i;

export type BackupEvidenceResult = {
  ready: boolean;
  missingFields: string[];
};

export type BackupDrillEnv = {
  BETA_BACKUP_SCRATCH_DATABASE_URL?: string;
  BETA_BACKUP_SNAPSHOT_PATH?: string;
  BETA_BACKUP_EXPECTED_COUNTS_JSON?: string;
  DATABASE_URL?: string;
  [key: string]: string | undefined;
};

export type BackupExpectedAssertions = {
  minCounts: Record<string, number>;
  checksums: Record<string, string>;
};

export type BackupLiveReady = {
  scratchDatabaseUrl: string;
  snapshotPath: string;
  expectedCountsPath?: string;
  databaseUrl?: string;
};

export type BackupVerifyPlan =
  | { mode: "evidence" }
  | { mode: "live"; ok: false; reason: string }
  | ({ mode: "live"; ok: true } & BackupLiveReady);

export type SqlRow = Record<string, unknown>;

export type SqlClient = {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: SqlRow[] }>;
};

export type BackupLiveRunResult =
  | { ok: true; counts: Record<string, number> }
  | { ok: false; reason: string; detail?: string };

export type BackupVerifyExit = {
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
};

export function isEvidenceValueFilled(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("_fill_")) return false;
  const unquoted = trimmed.replace(/^`+|`+$/g, "").trim();
  if (unquoted.length === 0) return false;
  if (unquoted.includes("_fill_")) return false;
  return true;
}

export function extractEvidenceSection(markdown: string): string | null {
  const match = /^## Evidence\b.*$/m.exec(markdown);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const parts = trimmed.split("|").map((cell) => cell.trim());
  if (parts.length > 0 && parts[0] === "") parts.shift();
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  if (parts.length < 2) return null;
  return parts;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isHeaderRow(cells: string[]): boolean {
  return cells[0] === "Field" && cells[1] === "Value";
}

/**
 * Evidence table only (the `## Evidence` section). `_fill_`, empty, and
 * whitespace-only values are not ready. Does not write markdown.
 */
export function parseBackupEvidence(markdown: string): BackupEvidenceResult {
  const section = extractEvidenceSection(markdown);
  if (section === null) {
    return { ready: false, missingFields: ["Evidence"] };
  }

  const missingFields: string[] = [];
  let dataRows = 0;
  for (const line of section.split(/\r?\n/)) {
    const cells = splitTableRow(line);
    if (!cells || isSeparatorRow(cells) || isHeaderRow(cells)) continue;
    dataRows += 1;
    const field = cells[0] ?? "";
    const label = field.length > 0 ? field : "(blank field)";
    if (!isEvidenceValueFilled(cells[1] ?? "")) {
      missingFields.push(label);
    }
  }

  if (dataRows === 0) {
    return { ready: false, missingFields: ["Evidence table"] };
  }

  return { ready: missingFields.length === 0, missingFields };
}

export function formatEvidenceNotReady(missingFields: readonly string[]): string {
  const fields = missingFields.length > 0 ? missingFields.join(", ") : "(none listed)";
  return `Backup evidence NOT_READY. missingFields: ${fields}. The Evidence file was not modified.`;
}

export function formatBackupVerifySuccess(input: {
  mode: "evidence" | "live";
  ready: boolean;
  counts?: Record<string, number>;
}): string {
  const body: {
    ok: true;
    mode: "evidence" | "live";
    ready: boolean;
    counts?: Record<string, number>;
  } = {
    ok: true,
    mode: input.mode,
    ready: input.ready,
  };
  if (input.counts) {
    body.counts = input.counts;
  }
  return JSON.stringify(body, null, 2);
}

function trimmedNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Exact env string match, plus a trim match so padding cannot point scratch at production. */
export function scratchTargetsProduction(
  scratchRaw: string | undefined,
  databaseRaw: string | undefined,
): boolean {
  if (scratchRaw === undefined || databaseRaw === undefined) return false;
  if (scratchRaw.length === 0) return false;
  if (scratchRaw === databaseRaw) return true;
  const scratchTrimmed = scratchRaw.trim();
  const databaseTrimmed = databaseRaw.trim();
  return scratchTrimmed.length > 0 && scratchTrimmed === databaseTrimmed;
}

export function backupLiveModeRequested(env: BackupDrillEnv, liveFlag: boolean): boolean {
  if (liveFlag) return true;
  return Boolean(
    trimmedNonEmpty(env.BETA_BACKUP_SCRATCH_DATABASE_URL) &&
      trimmedNonEmpty(env.BETA_BACKUP_SNAPSHOT_PATH),
  );
}

export function planBackupVerify(env: BackupDrillEnv, liveFlag: boolean): BackupVerifyPlan {
  if (!backupLiveModeRequested(env, liveFlag)) {
    return { mode: "evidence" };
  }

  if (scratchTargetsProduction(env.BETA_BACKUP_SCRATCH_DATABASE_URL, env.DATABASE_URL)) {
    return { mode: "live", ok: false, reason: BACKUP_DRILL_SCRATCH_EQUALS_DATABASE };
  }

  const scratchDatabaseUrl = trimmedNonEmpty(env.BETA_BACKUP_SCRATCH_DATABASE_URL);
  const snapshotPath = trimmedNonEmpty(env.BETA_BACKUP_SNAPSHOT_PATH);
  if (!scratchDatabaseUrl || !snapshotPath) {
    return { mode: "live", ok: false, reason: BACKUP_DRILL_LIVE_FAIL_CLOSED };
  }

  return {
    mode: "live",
    ok: true,
    scratchDatabaseUrl,
    snapshotPath,
    expectedCountsPath: trimmedNonEmpty(env.BETA_BACKUP_EXPECTED_COUNTS_JSON),
    databaseUrl: env.DATABASE_URL,
  };
}

function parseCountMap(
  value: unknown,
): { ok: true; value: Record<string, number> } | { ok: false; reason: string } {
  if (value === undefined) return { ok: true, value: {} };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID };
  }
  const counts: Record<string, number> = {};
  for (const [table, count] of Object.entries(value)) {
    if (!SAFE_TABLE_NAME.test(table)) {
      return { ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID };
    }
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      return { ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID };
    }
    counts[table] = count;
  }
  return { ok: true, value: counts };
}

function parseChecksumMap(
  value: unknown,
): { ok: true; value: Record<string, string> } | { ok: false; reason: string } {
  if (value === undefined) return { ok: true, value: {} };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID };
  }
  const checksums: Record<string, string> = {};
  for (const [table, checksum] of Object.entries(value)) {
    if (!SAFE_TABLE_NAME.test(table)) {
      return { ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID };
    }
    if (typeof checksum !== "string" || !MD5_HEX.test(checksum)) {
      return { ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID };
    }
    checksums[table] = checksum.toLowerCase();
  }
  return { ok: true, value: checksums };
}

export function parseBackupExpectedAssertions(
  text: string,
): { ok: true; assertions: BackupExpectedAssertions } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID };
  }
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "minCounts" && key !== "checksums") {
      return { ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID };
    }
  }
  const minCounts = parseCountMap(record.minCounts);
  if (!minCounts.ok) return minCounts;
  const checksums = parseChecksumMap(record.checksums);
  if (!checksums.ok) return checksums;
  return {
    ok: true,
    assertions: { minCounts: minCounts.value, checksums: checksums.value },
  };
}

export function quoteIdent(name: string): string {
  if (!SAFE_TABLE_NAME.test(name)) {
    throw new Error("Unsafe SQL identifier.");
  }
  return `"${name}"`;
}

function uniqueNames(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    names.push(value);
  }
  return names;
}

export async function assertBackupSurvival(
  client: SqlClient,
  assertions: BackupExpectedAssertions,
): Promise<{ ok: true; counts: Record<string, number> } | { ok: false; reason: string }> {
  const tables = uniqueNames([
    ...BACKUP_SURVIVAL_TABLES,
    ...Object.keys(assertions.minCounts),
    ...Object.keys(assertions.checksums),
  ]);
  for (const table of tables) {
    if (!SAFE_TABLE_NAME.test(table)) {
      return { ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID };
    }
  }

  const present = await client.query(
    `SELECT c.relname AS name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname = ANY($1::text[])`,
    [tables],
  );
  const names = new Set(present.rows.map((row) => String(row.name)));
  const survivalNames = new Set<string>(BACKUP_SURVIVAL_TABLES);
  const missingSurvival = BACKUP_SURVIVAL_TABLES.filter((table) => !names.has(table));
  if (missingSurvival.length > 0) {
    return {
      ok: false,
      reason: `Backup drill failed: scratch database is missing survival tables: ${missingSurvival.join(", ")}. No success was claimed.`,
    };
  }
  const missingExpected = tables.filter((table) => !names.has(table) && !survivalNames.has(table));
  if (missingExpected.length > 0) {
    return {
      ok: false,
      reason: `Backup drill failed: scratch database is missing expected tables: ${missingExpected.join(", ")}. No success was claimed.`,
    };
  }

  const counts: Record<string, number> = {};
  for (const table of tables) {
    const countResult = await client.query(
      `SELECT count(*)::int AS count FROM ${quoteIdent(table)}`,
    );
    const count = Number(countResult.rows[0]?.count);
    if (!Number.isInteger(count) || count < 0) {
      return {
        ok: false,
        reason: `Backup drill failed: could not count ${table}. No success was claimed.`,
      };
    }
    counts[table] = count;
    const minimum = assertions.minCounts[table];
    if (minimum !== undefined && count < minimum) {
      return {
        ok: false,
        reason: `Backup drill failed: ${table} count ${count} is below minimum ${minimum}. No success was claimed.`,
      };
    }
  }

  for (const [table, expected] of Object.entries(assertions.checksums)) {
    const checksumResult = await client.query(
      `SELECT md5(COALESCE(string_agg(row_text, E'\\n' ORDER BY row_text), '')) AS checksum
       FROM (SELECT t::text AS row_text FROM ${quoteIdent(table)} AS t) AS s`,
    );
    const actual = String(checksumResult.rows[0]?.checksum ?? "").toLowerCase();
    if (actual !== expected.toLowerCase()) {
      return {
        ok: false,
        reason: `Backup drill failed: ${table} checksum did not match the fixture. No success was claimed.`,
      };
    }
  }

  return { ok: true, counts };
}

export async function evaluateBackupDrill(input: {
  markdown: string;
  env: BackupDrillEnv;
  liveFlag: boolean;
  runLive: (plan: BackupLiveReady) => Promise<BackupLiveRunResult>;
}): Promise<BackupVerifyExit> {
  const evidence = parseBackupEvidence(input.markdown);
  const plan = planBackupVerify(input.env, input.liveFlag);

  if (plan.mode === "evidence") {
    if (!evidence.ready) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: formatEvidenceNotReady(evidence.missingFields),
      };
    }
    return {
      exitCode: 0,
      stdout: formatBackupVerifySuccess({ mode: "evidence", ready: true }),
      stderr: "",
    };
  }

  if (!plan.ok) {
    return { exitCode: 1, stdout: "", stderr: plan.reason };
  }

  let live: BackupLiveRunResult;
  try {
    live = await input.runLive(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown backup drill error";
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${BACKUP_DRILL_SURVIVAL_FAILED}\n${message}`,
    };
  }

  if (!live.ok) {
    const stderr = live.detail ? `${live.reason}\n${live.detail}` : live.reason;
    return { exitCode: 1, stdout: "", stderr };
  }

  return {
    exitCode: 0,
    stdout: formatBackupVerifySuccess({
      mode: "live",
      ready: evidence.ready,
      counts: live.counts,
    }),
    stderr: "",
  };
}
