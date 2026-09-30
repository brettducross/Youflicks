import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import { OpsAlertKind, parseSentryDsn, reportOpsAlert } from "@/lib/ops-alerts";

const alert = {
  kind: OpsAlertKind.JOB_FAILED,
  message: "job exhausted retries",
  context: { jobId: "job_1" },
};

const ORIGINAL_DSN = process.env.SENTRY_DSN;

function setDsn(value: string | undefined) {
  if (value === undefined) {
    delete process.env.SENTRY_DSN;
    return;
  }
  process.env.SENTRY_DSN = value;
}

describe("reportOpsAlert Sentry posture", () => {
  afterEach(() => {
    if (ORIGINAL_DSN === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = ORIGINAL_DSN;
    }
    vi.restoreAllMocks();
  });

  it("logs ops.alert and does not fetch when SENTRY_DSN is unset", async () => {
    setDsn(undefined);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(reportOpsAlert(alert)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "ops.alert",
      expect.objectContaining({
        alertKind: OpsAlertKind.JOB_FAILED,
        message: "job exhausted retries",
        jobId: "job_1",
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logs ops.alert and does not fetch when SENTRY_DSN is blank", async () => {
    setDsn("   ");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(reportOpsAlert(alert)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith("ops.alert", expect.any(Object));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not throw or POST when the DSN string does not parse", async () => {
    setDsn("not-a-dsn");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(reportOpsAlert(alert)).resolves.toBeUndefined();

    expect(parseSentryDsn("not-a-dsn")).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith("ops.alert", expect.any(Object));
    expect(warnSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not throw when a parsed DSN store POST is not successful", async () => {
    setDsn("https://publickey@o123.ingest.sentry.io/456");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 502,
    } as Response);

    await expect(reportOpsAlert(alert)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith("ops.alert", expect.any(Object));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://o123.ingest.sentry.io/api/456/store/");
    expect(init).toEqual(expect.objectContaining({ method: "POST" }));
    expect(warnSpy).toHaveBeenCalledWith(
      "ops.sentry_failed",
      expect.objectContaining({ error: "Sentry store 502" }),
    );
  });
});

describe("parseSentryDsn", () => {
  it("parses a store DSN into key, ingest base, and project id", () => {
    expect(parseSentryDsn("https://publickey@o123.ingest.sentry.io/456")).toEqual({
      publicKey: "publickey",
      ingestBase: "https://o123.ingest.sentry.io",
      projectId: "456",
    });
    expect(parseSentryDsn("https://pk@ingest.example:8443/42")).toEqual({
      publicKey: "pk",
      ingestBase: "https://ingest.example:8443",
      projectId: "42",
    });
  });

  it("rejects junk and incomplete DSNs", () => {
    expect(parseSentryDsn("not a dsn")).toBeNull();
    expect(parseSentryDsn("")).toBeNull();
    expect(parseSentryDsn("https://ingest.sentry.io/123")).toBeNull();
    expect(parseSentryDsn("https://public@ingest.sentry.io/")).toBeNull();
    expect(parseSentryDsn("https://public@ingest.sentry.io")).toBeNull();
  });
});
