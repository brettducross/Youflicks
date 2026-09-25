export type AiVideoBudgetCaps = {
  projectMaxSeconds?: number;
  projectMaxUsd?: number;
  userWindowMaxSeconds?: number;
  userWindowMaxUsd?: number;
};

export type AiVideoBudgetResolution = {
  userId: string;
  projectId: string;
  /** UTC calendar date, e.g. 2026-09-25. */
  windowKey: string;
  caps: AiVideoBudgetCaps;
};

export class AiVideoBudgetConfigError extends Error {
  readonly code = "AI_VIDEO_BUDGET_CONFIG";

  constructor(message: string) {
    super(message);
    this.name = "AiVideoBudgetConfigError";
  }
}

/**
 * Ops caps only. Unset means that scope is not enforced.
 * Per-plan numbers are E9 and are not set here.
 */
export class AiVideoBudgetSource {
  static resolve(
    userId: string,
    projectId: string,
    env: Record<string, string | undefined> = process.env,
    now: Date = new Date(),
  ): AiVideoBudgetResolution {
    return {
      userId,
      projectId,
      windowKey: utcWindowKey(now),
      caps: {
        projectMaxSeconds: readOptionalCap(env.SG_BUDGET_PROJECT_MAX_SECONDS, "SG_BUDGET_PROJECT_MAX_SECONDS"),
        projectMaxUsd: readOptionalCap(env.SG_BUDGET_PROJECT_MAX_USD, "SG_BUDGET_PROJECT_MAX_USD"),
        userWindowMaxSeconds: readOptionalCap(
          env.SG_BUDGET_USER_WINDOW_MAX_SECONDS,
          "SG_BUDGET_USER_WINDOW_MAX_SECONDS",
        ),
        userWindowMaxUsd: readOptionalCap(
          env.SG_BUDGET_USER_WINDOW_MAX_USD,
          "SG_BUDGET_USER_WINDOW_MAX_USD",
        ),
      },
    };
  }
}

export function utcWindowKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function projectBudgetLedgerId(projectId: string): string {
  return `project:${projectId}`;
}

export function userWindowBudgetLedgerId(userId: string, windowKey: string): string {
  return `user:${userId}:${windowKey}`;
}

export function hasAnyBudgetCap(caps: AiVideoBudgetCaps): boolean {
  return (
    caps.projectMaxSeconds !== undefined ||
    caps.projectMaxUsd !== undefined ||
    caps.userWindowMaxSeconds !== undefined ||
    caps.userWindowMaxUsd !== undefined
  );
}

function readOptionalCap(raw: string | undefined, name: string): number | undefined {
  if (raw == null || raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AiVideoBudgetConfigError(`${name} must be a positive number when set.`);
  }
  return value;
}
