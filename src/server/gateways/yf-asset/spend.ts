export class GatewaySpendCapError extends Error {
  readonly code = "GATEWAY_SPEND_CAP";

  constructor(message: string) {
    super(message);
    this.name = "GatewaySpendCapError";
  }
}

export type SpendGuardSnapshot = {
  jobsAccepted: number;
  spendUsd: number;
  maxJobs?: number;
  maxSpendUsd?: number;
  estimatedUsdPerJob: number;
};

/**
 * Process-local spend / job caps. Ops only — never fed to Director / Story / Timeline.
 * Values are placeholders until Brett sets real keys + caps.
 */
export class SpendGuard {
  jobsAccepted = 0;
  spendUsd = 0;

  constructor(
    private readonly maxJobs?: number,
    private readonly maxSpendUsd?: number,
    private readonly estimatedUsdPerJob = 0.5,
  ) {}

  snapshot(): SpendGuardSnapshot {
    return {
      jobsAccepted: this.jobsAccepted,
      spendUsd: this.spendUsd,
      maxJobs: this.maxJobs,
      maxSpendUsd: this.maxSpendUsd,
      estimatedUsdPerJob: this.estimatedUsdPerJob,
    };
  }

  assertWithinCap(): void {
    if (this.maxJobs !== undefined && this.jobsAccepted >= this.maxJobs) {
      throw new GatewaySpendCapError(
        `Gateway job cap reached (${this.maxJobs}). Raise YF_GATEWAY_MAX_JOBS or wait.`,
      );
    }
    if (
      this.maxSpendUsd !== undefined &&
      this.spendUsd + this.estimatedUsdPerJob > this.maxSpendUsd
    ) {
      throw new GatewaySpendCapError(
        `Gateway spend cap reached ($${this.maxSpendUsd}). Raise YF_GATEWAY_MAX_SPEND_USD or wait.`,
      );
    }
  }

  recordAccepted(): number {
    this.assertWithinCap();
    this.jobsAccepted += 1;
    this.spendUsd += this.estimatedUsdPerJob;
    return this.estimatedUsdPerJob;
  }
}
