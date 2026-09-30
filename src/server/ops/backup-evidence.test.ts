import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SG_ROUTING_MODE } from "@/server/sg/routing-mode";
import {
  assertBackupSurvival,
  BACKUP_DRILL_EXPECTED_COUNTS_INVALID,
  BACKUP_DRILL_LIVE_FAIL_CLOSED,
  BACKUP_DRILL_SCRATCH_EQUALS_DATABASE,
  BACKUP_DRILL_SURVIVAL_FAILED,
  BACKUP_SURVIVAL_TABLES,
  backupLiveModeRequested,
  evaluateBackupDrill,
  formatBackupVerifySuccess,
  formatEvidenceNotReady,
  isEvidenceValueFilled,
  parseBackupEvidence,
  parseBackupExpectedAssertions,
  planBackupVerify,
  quoteIdent,
  scratchTargetsProduction,
  type BackupLiveReady,
  type SqlClient,
} from "@/server/ops/backup-evidence";

const UNSIGNED_EVIDENCE_FIELDS = [
  "Drill date (UTC)",
  "Operator",
  "Snapshot identifier / timestamp",
  "Target RPO",
  "Observed RPO (age of snapshot used)",
  "Target RTO",
  "Observed RTO (restore start → step 6 PASS)",
  "Sign-off (Brett or delegated ops)",
];

function evidenceDoc(rows: string): string {
  return [
    "## Numbered restore drill",
    "",
    "| Target | Value | Notes |",
    "| --- | --- | --- |",
    "| RPO (max acceptable data loss) | `_fill_` | outside the Evidence table |",
    "",
    "## Evidence (sign before invites)",
    "",
    "| Field | Value |",
    "| --- | --- |",
    rows,
    "",
    "Prose may mention `_fill_` without becoming a cell.",
    "",
  ].join("\n");
}

const FILLED_ROWS = [
  "| Drill date (UTC) | fixture-date |",
  "| Operator | fixture-operator |",
  "| Snapshot identifier / timestamp | fixture-snapshot |",
  "| Target RPO | fixture-rpo |",
  "| Observed RPO (age of snapshot used) | fixture-observed-rpo |",
  "| Target RTO | fixture-rto |",
  "| Observed RTO (restore start → step 6 PASS) | fixture-observed-rto |",
  "| `gateway_spend_ledger` survived | yes |",
  "| `ai_processing_consent` survived | yes |",
  "| `beta_invite` survived | yes |",
  "| Project + media keys resolved | yes |",
  "| Object versioning confirmed | yes |",
  "| Sign-off (Brett or delegated ops) | fixture-signoff |",
].join("\n");

function expectNoReadyClaim(text: string) {
  expect(text).not.toMatch(/\bREADY\b/);
}

describe("isEvidenceValueFilled", () => {
  it("rejects _fill_, empty, and whitespace-only cells", () => {
    expect(isEvidenceValueFilled("_fill_")).toBe(false);
    expect(isEvidenceValueFilled("`_fill_`")).toBe(false);
    expect(isEvidenceValueFilled("  `_fill_`  ")).toBe(false);
    expect(isEvidenceValueFilled("")).toBe(false);
    expect(isEvidenceValueFilled("   ")).toBe(false);
    expect(isEvidenceValueFilled("``")).toBe(false);
  });

  it("accepts a non-blank value that is not _fill_", () => {
    expect(isEvidenceValueFilled("fixture-operator")).toBe(true);
    expect(isEvidenceValueFilled("yes / no")).toBe(true);
    expect(isEvidenceValueFilled("yes")).toBe(true);
  });
});

describe("parseBackupEvidence", () => {
  it("fails when _fill_ is treated as a filled value would", () => {
    const result = parseBackupEvidence(evidenceDoc("| Operator | `_fill_` |"));
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain("Operator");
    expectNoReadyClaim(JSON.stringify(result));
  });

  it("rejects empty and whitespace-only evidence values", () => {
    const result = parseBackupEvidence(
      evidenceDoc(["| Operator |  |", "| Snapshot identifier / timestamp |     |"].join("\n")),
    );
    expect(result).toEqual({
      ready: false,
      missingFields: ["Operator", "Snapshot identifier / timestamp"],
    });
  });

  it("is ready only when every Evidence value is non-blank and not _fill_", () => {
    const result = parseBackupEvidence(evidenceDoc(FILLED_ROWS));
    expect(result).toEqual({ ready: true, missingFields: [] });
  });

  it("stays not ready when only the Sign-off cell is still _fill_", () => {
    const rows = FILLED_ROWS.replace(
      "| Sign-off (Brett or delegated ops) | fixture-signoff |",
      "| Sign-off (Brett or delegated ops) | `_fill_` |",
    );
    const result = parseBackupEvidence(evidenceDoc(rows));
    expect(result).toEqual({
      ready: false,
      missingFields: ["Sign-off (Brett or delegated ops)"],
    });
  });

  it("ignores _fill_ outside the Evidence table", () => {
    const result = parseBackupEvidence(evidenceDoc("| Operator | fixture-operator |"));
    expect(result.ready).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("fails closed when the Evidence section or table is missing", () => {
    expect(parseBackupEvidence("# No evidence\n")).toEqual({
      ready: false,
      missingFields: ["Evidence"],
    });
    expect(parseBackupEvidence("## Evidence (sign before invites)\n\nNo table.\n")).toEqual({
      ready: false,
      missingFields: ["Evidence table"],
    });
  });

  it("does not modify the shipped runbook and reports its unsigned Evidence cells", () => {
    const docPath = "docs/BETA_BACKUP_MONITORING.md";
    const before = readFileSync(docPath, "utf8");
    const result = parseBackupEvidence(before);
    expect(readFileSync(docPath, "utf8")).toBe(before);
    expect(result).toEqual({ ready: false, missingFields: UNSIGNED_EVIDENCE_FIELDS });
    expect(before).toContain("`_fill_`");
  });
});

describe("backup verify plan", () => {
  const prod = "postgres://prod.example/youflicks";
  const scratch = "postgres://scratch.example/youflicks_restore";

  it("stays in evidence mode unless --live or both knobs are set", () => {
    expect(planBackupVerify({}, false)).toEqual({ mode: "evidence" });
    expect(
      planBackupVerify({ BETA_BACKUP_SCRATCH_DATABASE_URL: scratch, DATABASE_URL: prod }, false),
    ).toEqual({ mode: "evidence" });
    expect(backupLiveModeRequested({ BETA_BACKUP_SNAPSHOT_PATH: "/tmp/snap.sql" }, false)).toBe(
      false,
    );
  });

  it("fails closed when live mode is missing a scratch URL or snapshot path", () => {
    expect(
      planBackupVerify(
        { BETA_BACKUP_SNAPSHOT_PATH: "/tmp/snap.sql", DATABASE_URL: prod },
        true,
      ),
    ).toEqual({ mode: "live", ok: false, reason: BACKUP_DRILL_LIVE_FAIL_CLOSED });
    expect(
      planBackupVerify(
        { BETA_BACKUP_SCRATCH_DATABASE_URL: scratch, DATABASE_URL: prod },
        true,
      ),
    ).toEqual({ mode: "live", ok: false, reason: BACKUP_DRILL_LIVE_FAIL_CLOSED });
    expect(
      planBackupVerify(
        {
          BETA_BACKUP_SCRATCH_DATABASE_URL: "   ",
          BETA_BACKUP_SNAPSHOT_PATH: "  ",
          DATABASE_URL: prod,
        },
        true,
      ),
    ).toEqual({ mode: "live", ok: false, reason: BACKUP_DRILL_LIVE_FAIL_CLOSED });
  });

  it("refuses a scratch URL that string-equals DATABASE_URL", () => {
    expect(scratchTargetsProduction(prod, prod)).toBe(true);
    expect(
      planBackupVerify(
        {
          BETA_BACKUP_SCRATCH_DATABASE_URL: prod,
          BETA_BACKUP_SNAPSHOT_PATH: "/tmp/snap.sql",
          DATABASE_URL: prod,
        },
        false,
      ),
    ).toEqual({ mode: "live", ok: false, reason: BACKUP_DRILL_SCRATCH_EQUALS_DATABASE });
    expect(scratchTargetsProduction(`  ${prod}\n`, prod)).toBe(true);
    expect(
      planBackupVerify(
        {
          BETA_BACKUP_SCRATCH_DATABASE_URL: `  ${prod}  `,
          BETA_BACKUP_SNAPSHOT_PATH: "/tmp/snap.sql",
          DATABASE_URL: prod,
        },
        true,
      ),
    ).toEqual({ mode: "live", ok: false, reason: BACKUP_DRILL_SCRATCH_EQUALS_DATABASE });
  });

  it("resolves a disposable scratch URL without inventing counts", () => {
    expect(
      planBackupVerify(
        {
          BETA_BACKUP_SCRATCH_DATABASE_URL: scratch,
          BETA_BACKUP_SNAPSHOT_PATH: "/tmp/snap.sql",
          BETA_BACKUP_EXPECTED_COUNTS_JSON: "/tmp/counts.json",
          DATABASE_URL: prod,
        },
        true,
      ),
    ).toEqual({
      mode: "live",
      ok: true,
      scratchDatabaseUrl: scratch,
      snapshotPath: "/tmp/snap.sql",
      expectedCountsPath: "/tmp/counts.json",
      databaseUrl: prod,
    });
  });
});

describe("parseBackupExpectedAssertions", () => {
  it("accepts minCounts and checksums and rejects everything else", () => {
    expect(parseBackupExpectedAssertions('{"minCounts":{"user":1},"checksums":{}}')).toEqual({
      ok: true,
      assertions: {
        minCounts: { user: 1 },
        checksums: {},
      },
    });
    expect(parseBackupExpectedAssertions("{}")).toEqual({
      ok: true,
      assertions: { minCounts: {}, checksums: {} },
    });
    expect(parseBackupExpectedAssertions('{"user":1}')).toEqual({
      ok: false,
      reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID,
    });
    expect(parseBackupExpectedAssertions('{"minCounts":{"User":1}}')).toEqual({
      ok: false,
      reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID,
    });
    expect(parseBackupExpectedAssertions("not-json")).toEqual({
      ok: false,
      reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID,
    });
  });
});

describe("assertBackupSurvival", () => {
  function client(input?: {
    missing?: string[];
    counts?: Record<string, number>;
    checksums?: Record<string, string>;
  }): SqlClient & { queries: string[] } {
    const missing = new Set(input?.missing ?? []);
    const queries: string[] = [];
    const sqlClient: SqlClient & { queries: string[] } = {
      queries,
      query: async (sql, params) => {
        queries.push(sql);
        if (sql.includes("pg_class")) {
          const requested = (params?.[0] as string[]) ?? [];
          expect(requested).toEqual(expect.arrayContaining([...BACKUP_SURVIVAL_TABLES]));
          return {
            rows: requested.filter((name) => !missing.has(name)).map((name) => ({ name })),
          };
        }
        const table = /"([a-z_][a-z0-9_]*)"/.exec(sql)?.[1] ?? "";
        if (sql.includes("count(*)")) {
          return { rows: [{ count: input?.counts?.[table] ?? 2 }] };
        }
        if (sql.includes("md5(")) {
          return {
            rows: [{ checksum: input?.checksums?.[table] ?? "abcabcabcabcabcabcabcabcabcabcab" }],
          };
        }
        return { rows: [] };
      },
    };
    return sqlClient;
  }

  it("requires the runbook survival tables and quotes user", () => {
    expect([...BACKUP_SURVIVAL_TABLES]).toEqual([
      "gateway_spend_ledger",
      "ai_processing_consent",
      "beta_invite",
      "project",
      "media_asset",
      "generated_asset",
      "render_job",
      "finished_movie",
      "user",
    ]);
    expect(quoteIdent("user")).toBe('"user"');
    expect(() => quoteIdent("user;drop")).toThrow(/Unsafe SQL identifier/);
  });

  it("fails when a survival table is missing and does not claim success", async () => {
    const result = await assertBackupSurvival(client({ missing: ["beta_invite"] }), {
      minCounts: {},
      checksums: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("beta_invite");
      expectNoReadyClaim(result.reason);
    }
  });

  it("fails when a fixture minimum or checksum is not met", async () => {
    const low = await assertBackupSurvival(client({ counts: { user: 0 } }), {
      minCounts: { user: 1 },
      checksums: {},
    });
    expect(low).toEqual({
      ok: false,
      reason: "Backup drill failed: user count 0 is below minimum 1. No success was claimed.",
    });

    const checksum = await assertBackupSurvival(client({ checksums: { project: "deadbeef" } }), {
      minCounts: {},
      checksums: { project: "abcabcabcabcabcabcabcabcabcabcab" },
    });
    expect(checksum.ok).toBe(false);
    if (!checksum.ok) expect(checksum.reason).toContain("project checksum");
  });

  it("returns counts when survival tables exist and fixture assertions pass", async () => {
    const result = await assertBackupSurvival(
      client({ checksums: { user: "abcabcabcabcabcabcabcabcabcabcab" } }),
      { minCounts: { user: 1 }, checksums: { user: "ABCABCABCABCABCABCABCABCABCABCAB" } },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const table of BACKUP_SURVIVAL_TABLES) {
        expect(result.counts[table]).toBe(2);
      }
    }
  });

  it("rejects an unsafe fixture table before querying", async () => {
    const query = vi.fn();
    const result = await assertBackupSurvival(
      { query },
      { minCounts: { "users;drop": 1 }, checksums: {} },
    );
    expect(result).toEqual({ ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("evaluateBackupDrill", () => {
  const prod = "postgres://prod.example/youflicks";
  const scratch = "postgres://scratch.example/youflicks_restore";

  it("exits 1 on unsigned evidence without calling live restore or printing READY", async () => {
    const runLive = vi.fn();
    const decision = await evaluateBackupDrill({
      markdown: evidenceDoc("| Operator | `_fill_` |\n| Sign-off (Brett or delegated ops) |  |"),
      env: {},
      liveFlag: false,
      runLive,
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.stdout).toBe("");
    expect(decision.stderr).toContain("NOT_READY");
    expect(decision.stderr).toContain("Operator");
    expect(decision.stderr).toContain("The Evidence file was not modified.");
    expectNoReadyClaim(decision.stdout);
    expectNoReadyClaim(decision.stderr);
    expect(runLive).not.toHaveBeenCalled();
  });

  it("exits 0 with ready true only when the evidence fixture is filled", async () => {
    const runLive = vi.fn();
    const decision = await evaluateBackupDrill({
      markdown: evidenceDoc(FILLED_ROWS),
      env: {},
      liveFlag: false,
      runLive,
    });
    expect(decision.exitCode).toBe(0);
    expect(decision.stderr).toBe("");
    expect(JSON.parse(decision.stdout)).toEqual({ ok: true, mode: "evidence", ready: true });
    expect(runLive).not.toHaveBeenCalled();
  });

  it("fails closed in live mode without a network claim when knobs are missing", async () => {
    const runLive = vi.fn();
    const decision = await evaluateBackupDrill({
      markdown: evidenceDoc(FILLED_ROWS),
      env: { DATABASE_URL: prod, BETA_BACKUP_SNAPSHOT_PATH: "/tmp/snap.sql" },
      liveFlag: true,
      runLive,
    });
    expect(decision).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: BACKUP_DRILL_LIVE_FAIL_CLOSED,
    });
    expectNoReadyClaim(decision.stderr);
    expect(runLive).not.toHaveBeenCalled();
  });

  it("does not call live restore when scratch string-equals DATABASE_URL", async () => {
    const runLive = vi.fn();
    const decision = await evaluateBackupDrill({
      markdown: evidenceDoc("| Operator | `_fill_` |"),
      env: {
        DATABASE_URL: prod,
        BETA_BACKUP_SCRATCH_DATABASE_URL: prod,
        BETA_BACKUP_SNAPSHOT_PATH: "/tmp/snap.sql",
      },
      liveFlag: true,
      runLive,
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.stdout).toBe("");
    expect(decision.stderr).toBe(BACKUP_DRILL_SCRATCH_EQUALS_DATABASE);
    expect(runLive).not.toHaveBeenCalled();
  });

  it("prints live success JSON without treating unsigned evidence as host sign-off", async () => {
    const runLive = vi.fn(async (plan: BackupLiveReady) => {
      expect(plan.scratchDatabaseUrl).toBe(scratch);
      expect(plan.databaseUrl).toBe(prod);
      return { ok: true as const, counts: { user: 1 } };
    });
    const decision = await evaluateBackupDrill({
      markdown: evidenceDoc("| Operator | `_fill_` |"),
      env: {
        DATABASE_URL: prod,
        BETA_BACKUP_SCRATCH_DATABASE_URL: scratch,
        BETA_BACKUP_SNAPSHOT_PATH: "/tmp/snap.sql",
      },
      liveFlag: false,
      runLive,
    });
    expect(runLive).toHaveBeenCalledTimes(1);
    expect(decision.exitCode).toBe(0);
    expect(JSON.parse(decision.stdout)).toEqual({
      ok: true,
      mode: "live",
      ready: false,
      counts: { user: 1 },
    });
    expectNoReadyClaim(decision.stdout);
  });

  it("exits 1 when the live restore reports failure", async () => {
    const decision = await evaluateBackupDrill({
      markdown: evidenceDoc(FILLED_ROWS),
      env: {
        DATABASE_URL: prod,
        BETA_BACKUP_SCRATCH_DATABASE_URL: scratch,
        BETA_BACKUP_SNAPSHOT_PATH: "/tmp/snap.sql",
      },
      liveFlag: true,
      runLive: async () => ({ ok: false, reason: BACKUP_DRILL_SURVIVAL_FAILED }),
    });
    expect(decision).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: BACKUP_DRILL_SURVIVAL_FAILED,
    });
  });
});

describe("printed status strings", () => {
  it("uses NOT_READY and does not print a READY claim", () => {
    const stderr = formatEvidenceNotReady(UNSIGNED_EVIDENCE_FIELDS);
    expect(stderr).toContain("NOT_READY");
    expectNoReadyClaim(stderr);
    const success = formatBackupVerifySuccess({ mode: "evidence", ready: true });
    expect(JSON.parse(success)).toEqual({ ok: true, mode: "evidence", ready: true });
    expect(success).not.toContain("READY");
  });
});

describe("posture locks", () => {
  it("keeps LEGACY routing, kenburns disabled, and backup knobs off app boot", () => {
    expect(DEFAULT_SG_ROUTING_MODE).toBe("LEGACY");
    const registry = JSON.parse(readFileSync("config/sg-lane-registry.json", "utf8")) as {
      processors: Array<{ laneId: string; enabled: boolean }>;
    };
    const kenburns = registry.processors.find((lane) => lane.laneId === "yf.kenburns.v1");
    expect(kenburns?.enabled).toBe(false);
    expect(readFileSync("src/lib/env.ts", "utf8")).not.toContain("BETA_BACKUP_");
    for (const file of [
      "src/server/ops/backup-evidence.ts",
      "src/server/ops/backup-restore.ts",
      "scripts/verify-backup-drill.ts",
    ]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/writeFile|appendFile/);
    }
  });
});

describe("ops:verify-backup CLI", () => {
  it("exits 1 on the unsigned runbook and does not print READY or edit the doc", async () => {
    const docPath = "docs/BETA_BACKUP_MONITORING.md";
    const before = readFileSync(docPath, "utf8");
    const tsxBin = path.resolve("node_modules/.bin/tsx");
    const execFileAsync = promisify(execFile);
    let result: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await execFileAsync(tsxBin, ["scripts/verify-backup-drill.ts"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          BETA_BACKUP_SCRATCH_DATABASE_URL: "",
          BETA_BACKUP_SNAPSHOT_PATH: "",
          BETA_BACKUP_EXPECTED_COUNTS_JSON: "",
        },
      });
      result = { code: 0, stdout, stderr };
    } catch (error) {
      const failed = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      result = {
        code: typeof failed.code === "number" ? failed.code : 1,
        stdout: failed.stdout ?? "",
        stderr: failed.stderr ?? "",
      };
    }
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("NOT_READY");
    expect(result.stderr).toContain("Operator");
    expect(result.stderr).toContain("Sign-off (Brett or delegated ops)");
    expectNoReadyClaim(result.stdout);
    expectNoReadyClaim(result.stderr);
    expect(readFileSync(docPath, "utf8")).toBe(before);
  }, 60_000);
});
