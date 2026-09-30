import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BACKUP_DRILL_EXPECTED_COUNTS_INVALID,
  BACKUP_DRILL_RESTORE_FAILED,
  BACKUP_DRILL_RESTORE_TOOL_MISSING,
  BACKUP_DRILL_SCRATCH_EQUALS_DATABASE,
  BACKUP_DRILL_SNAPSHOT_UNREADABLE,
  BACKUP_SURVIVAL_TABLES,
  scratchTargetsProduction,
  type SqlClient,
} from "@/server/ops/backup-evidence";
import {
  buildRestoreInvocation,
  detectSnapshotFormat,
  redactSecret,
  runBackupLiveDryRun,
  type BackupRestoreDeps,
} from "@/server/ops/backup-restore";

const PROD = "postgres://prod.example/youflicks";
const SCRATCH = "postgres://scratch.example/youflicks_restore";

function expectNoReadyClaim(text: string) {
  expect(text).not.toMatch(/\bREADY\b/);
}

function connectedClient(): SqlClient & { end: () => Promise<void> } {
  return {
    query: async (sql, params) => {
      if (sql.includes("pg_class")) {
        const requested = (params?.[0] as string[]) ?? [...BACKUP_SURVIVAL_TABLES];
        return { rows: requested.map((name) => ({ name })) };
      }
      if (sql.includes("count(*)")) return { rows: [{ count: 1 }] };
      if (sql.includes("md5(")) {
        return { rows: [{ checksum: "abcabcabcabcabcabcabcabcabcabcab" }] };
      }
      return { rows: [] };
    },
    end: vi.fn(async () => undefined),
  };
}

function deps(overrides: Partial<BackupRestoreDeps> = {}): BackupRestoreDeps {
  return {
    snapshotReadable: () => true,
    readHeader: () => Buffer.from("-- sql dump"),
    readText: () => '{"minCounts":{}}',
    spawnRestore: vi.fn(async () => ({ code: 0, stderr: "" })),
    connect: vi.fn(async () => connectedClient()),
    ...overrides,
  };
}

describe("restore command builder", () => {
  it("detects custom dumps and builds psql or pg_restore args for the scratch URL only", () => {
    expect(detectSnapshotFormat(Buffer.from("PGDMP01"))).toBe("custom");
    expect(detectSnapshotFormat(Buffer.from("-- SQL"))).toBe("sql");
    expect(
      buildRestoreInvocation({
        format: "sql",
        snapshotPath: "/tmp/snap.sql",
        scratchDatabaseUrl: SCRATCH,
      }),
    ).toEqual({
      command: "psql",
      args: [SCRATCH, "-w", "-v", "ON_ERROR_STOP=1", "-f", "/tmp/snap.sql"],
    });
    expect(
      buildRestoreInvocation({
        format: "custom",
        snapshotPath: "/tmp/snap.dump",
        scratchDatabaseUrl: SCRATCH,
      }),
    ).toEqual({
      command: "pg_restore",
      args: ["--clean", "--if-exists", "--no-owner", "--dbname", SCRATCH, "/tmp/snap.dump"],
    });
  });

  it("redacts the scratch URL from tool output", () => {
    expect(redactSecret(`password failed for ${SCRATCH}`, SCRATCH)).toBe(
      "password failed for [redacted]",
    );
  });
});

describe("runBackupLiveDryRun", () => {
  it("refuses production before reading a snapshot or connecting", async () => {
    const used = deps();
    const result = await runBackupLiveDryRun(
      {
        scratchDatabaseUrl: PROD,
        snapshotPath: "/tmp/snap.sql",
        databaseUrl: PROD,
      },
      used,
    );
    expect(result).toEqual({ ok: false, reason: BACKUP_DRILL_SCRATCH_EQUALS_DATABASE });
    expect(used.spawnRestore).not.toHaveBeenCalled();
    expect(used.connect).not.toHaveBeenCalled();
  });

  it("fails closed when the snapshot path is missing", async () => {
    const used = deps({ snapshotReadable: () => false });
    const result = await runBackupLiveDryRun(
      {
        scratchDatabaseUrl: SCRATCH,
        snapshotPath: "/tmp/missing.sql",
        databaseUrl: PROD,
      },
      used,
    );
    expect(result).toEqual({ ok: false, reason: BACKUP_DRILL_SNAPSHOT_UNREADABLE });
    expect(used.spawnRestore).not.toHaveBeenCalled();
    expect(used.connect).not.toHaveBeenCalled();
    expectNoReadyClaim(result.ok ? "" : result.reason);
  });

  it("fails closed when expected counts are missing or invalid, before restore", async () => {
    const unreadable = deps({
      readText: () => {
        throw new Error("ENOENT");
      },
    });
    expect(
      await runBackupLiveDryRun(
        {
          scratchDatabaseUrl: SCRATCH,
          snapshotPath: "/tmp/snap.sql",
          expectedCountsPath: "/tmp/missing.json",
          databaseUrl: PROD,
        },
        unreadable,
      ),
    ).toEqual({ ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID });
    expect(unreadable.spawnRestore).not.toHaveBeenCalled();

    const invalid = deps({ readText: () => '{"user": 4}' });
    expect(
      await runBackupLiveDryRun(
        {
          scratchDatabaseUrl: SCRATCH,
          snapshotPath: "/tmp/snap.sql",
          expectedCountsPath: "/tmp/counts.json",
          databaseUrl: PROD,
        },
        invalid,
      ),
    ).toEqual({ ok: false, reason: BACKUP_DRILL_EXPECTED_COUNTS_INVALID });
    expect(invalid.spawnRestore).not.toHaveBeenCalled();
  });

  it("applies SQL to the scratch URL and does not pass DATABASE_URL", async () => {
    const used = deps();
    const result = await runBackupLiveDryRun(
      {
        scratchDatabaseUrl: SCRATCH,
        snapshotPath: "/tmp/snap.sql",
        databaseUrl: PROD,
      },
      used,
    );
    expect(result.ok).toBe(true);
    expect(used.spawnRestore).toHaveBeenCalledWith(
      "psql",
      expect.arrayContaining([SCRATCH, "/tmp/snap.sql"]),
    );
    const args = (used.spawnRestore as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string[];
    expect(args.join(" ")).not.toContain(PROD);
    expect(used.connect).toHaveBeenCalledWith(SCRATCH);
    if (result.ok) {
      for (const table of BACKUP_SURVIVAL_TABLES) {
        expect(result.counts[table]).toBe(1);
      }
    }
  });

  it("does not connect when restore exits non-zero, and redacts the scratch URL", async () => {
    const used = deps({
      spawnRestore: vi.fn(async () => ({
        code: 1,
        stderr: `psql: error on ${SCRATCH}`,
      })),
    });
    const result = await runBackupLiveDryRun(
      {
        scratchDatabaseUrl: SCRATCH,
        snapshotPath: "/tmp/snap.sql",
        databaseUrl: PROD,
      },
      used,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(BACKUP_DRILL_RESTORE_FAILED);
      expect(result.detail).toBe("psql: error on [redacted]");
      expect(result.detail).not.toContain(SCRATCH);
      expectNoReadyClaim(result.reason);
    }
    expect(used.connect).not.toHaveBeenCalled();
  });

  it("reports a missing restore tool without claiming success", async () => {
    const error = Object.assign(new Error(`spawn pg_restore ENOENT ${SCRATCH}`), { code: "ENOENT" });
    const used = deps({
      readHeader: () => Buffer.from("PGDMP"),
      spawnRestore: vi.fn(async () => {
        throw error;
      }),
    });
    const result = await runBackupLiveDryRun(
      {
        scratchDatabaseUrl: SCRATCH,
        snapshotPath: "/tmp/snap.dump",
        databaseUrl: PROD,
      },
      used,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(BACKUP_DRILL_RESTORE_TOOL_MISSING);
      expect(result.detail).not.toContain(SCRATCH);
    }
    expect(used.connect).not.toHaveBeenCalled();
    expect(used.spawnRestore).toHaveBeenCalledWith(
      "pg_restore",
      expect.arrayContaining(["--dbname", SCRATCH]),
    );
  });

  it("closes the scratch connection when the survival check throws", async () => {
    const end = vi.fn(async () => undefined);
    const used = deps({
      connect: vi.fn(async () => ({
        query: async () => {
          throw new Error(`boom ${SCRATCH}`);
        },
        end,
      })),
    });
    const result = await runBackupLiveDryRun(
      {
        scratchDatabaseUrl: SCRATCH,
        snapshotPath: "/tmp/snap.sql",
        databaseUrl: PROD,
      },
      used,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toBe("boom [redacted]");
    expect(end).toHaveBeenCalledTimes(1);
  });
});

const scratchFromEnv = process.env.BETA_BACKUP_SCRATCH_DATABASE_URL?.trim() ?? "";
const databaseFromEnv = process.env.DATABASE_URL;

describe("optional scratch integration", () => {
  it.skipIf(scratchFromEnv.length === 0)(
    "restores a tiny SQL fixture when a disposable scratch URL is configured",
    async () => {
      if (scratchTargetsProduction(scratchFromEnv, databaseFromEnv)) {
        const refused = await runBackupLiveDryRun({
          scratchDatabaseUrl: scratchFromEnv,
          snapshotPath: "/tmp/unused.sql",
          databaseUrl: databaseFromEnv,
        });
        expect(refused).toEqual({ ok: false, reason: BACKUP_DRILL_SCRATCH_EQUALS_DATABASE });
        return;
      }

      const directory = mkdtempSync(path.join(tmpdir(), "yf-backup-drill-"));
      const snapshotPath = path.join(directory, "survival.sql");
      const drops = BACKUP_SURVIVAL_TABLES.map(
        (table) => `DROP TABLE IF EXISTS "${table}";`,
      ).join("\n");
      const creates = BACKUP_SURVIVAL_TABLES.map(
        (table) => `CREATE TABLE "${table}" (id text);`,
      ).join("\n");
      writeFileSync(
        snapshotPath,
        `${drops}\n${creates}\nINSERT INTO "user" (id) VALUES ('fixture-user');\n`,
        "utf8",
      );
      const result = await runBackupLiveDryRun({
        scratchDatabaseUrl: scratchFromEnv,
        snapshotPath,
        databaseUrl: databaseFromEnv,
        expectedCountsPath: undefined,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const table of BACKUP_SURVIVAL_TABLES) {
          expect(result.counts[table]).toBeGreaterThanOrEqual(0);
        }
        expect(result.counts.user).toBeGreaterThanOrEqual(1);
      }
    },
    60_000,
  );
});
