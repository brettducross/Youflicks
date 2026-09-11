import { logger } from "@/lib/logger";

export const OpsAlertKind = {
  JOB_FAILED: "JOB_FAILED",
  SPEND_GUARD: "SPEND_GUARD",
  STORAGE_ERROR: "STORAGE_ERROR",
} as const;

export type OpsAlertKindValue = (typeof OpsAlertKind)[keyof typeof OpsAlertKind];

export type OpsAlert = {
  kind: OpsAlertKindValue;
  message: string;
  context?: Record<string, unknown>;
};

/**
 * Structured ops alert. Always logs. Optionally POSTs a Sentry store event
 * when SENTRY_DSN is set. Never throws to callers.
 */
export async function reportOpsAlert(alert: OpsAlert): Promise<void> {
  logger.error("ops.alert", {
    alertKind: alert.kind,
    message: alert.message,
    ...alert.context,
  });
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    return;
  }
  try {
    await sendSentryEvent(dsn, alert);
  } catch (error) {
    logger.warn("ops.sentry_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

function sendSentryEvent(dsn: string, alert: OpsAlert): Promise<void> {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) {
    return Promise.resolve();
  }
  const url = `${parsed.ingestBase}/api/${parsed.projectId}/store/`;
  const payload = {
    event_id: crypto.randomUUID().replaceAll("-", ""),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "error",
    logger: "youflicks.ops",
    message: `${alert.kind}: ${alert.message}`,
    tags: { alertKind: alert.kind, service: "youflicks" },
    extra: alert.context ?? {},
  };
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=youflicks/0.1`,
    },
    body: JSON.stringify(payload),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Sentry store ${response.status}`);
    }
  });
}

export function parseSentryDsn(dsn: string): {
  publicKey: string;
  ingestBase: string;
  projectId: string;
} | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\/+/, "");
    if (!publicKey || !projectId) {
      return null;
    }
    return {
      publicKey,
      ingestBase: `${url.protocol}//${url.host}`,
      projectId,
    };
  } catch {
    return null;
  }
}
