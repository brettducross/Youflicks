import {
  alertSpendCap,
  assertWithinCaps,
  GatewaySpendCapError,
  MemorySpendLedger,
  type SpendLedgerPort,
} from "@/server/gateways/yf-asset/ledger";

export { GatewaySpendCapError } from "@/server/gateways/yf-asset/ledger";

export type SpendGuardSnapshot = {
  jobsAccepted: number;
  spendUsd: number;
  maxJobs?: number;
  maxSpendUsd?: number;
  estimatedUsdPerJob: number;
};

/**
 * Durable spend / job caps. Ops only — never fed to Director / Story / Timeline.
 * Live backends always have caps (env or beta defaults). Restart must not reset spend.
 */
export class SpendGuard {
  constructor(
    private readonly maxJobs?: number,
    private readonly maxSpendUsd?: number,
    private readonly estimatedUsdPerJob = 0.5,
    private readonly ledger: SpendLedgerPort = new MemorySpendLedger(),
  ) {}

  async snapshot(): Promise<SpendGuardSnapshot> {
    const persisted = await this.ledger.snapshot();
    return {
      jobsAccepted: persisted.jobsAccepted,
      spendUsd: persisted.spendUsd,
      maxJobs: this.maxJobs,
      maxSpendUsd: this.maxSpendUsd,
      estimatedUsdPerJob: this.estimatedUsdPerJob,
    };
  }

  async assertWithinCap(): Promise<void> {
    const current = await this.ledger.snapshot();
    try {
      assertWithinCaps(current.jobsAccepted, current.spendUsd, this.estimatedUsdPerJob, {
        maxJobs: this.maxJobs,
        maxSpendUsd: this.maxSpendUsd,
      });
    } catch (error) {
      if (error instanceof GatewaySpendCapError) {
        await alertSpendCap(error, {
          maxJobs: this.maxJobs,
          maxSpendUsd: this.maxSpendUsd,
          jobsAccepted: current.jobsAccepted,
          spendUsd: current.spendUsd,
        });
      }
      throw error;
    }
  }

  async recordAccepted(): Promise<number> {
    try {
      await this.ledger.tryReserve(this.estimatedUsdPerJob, {
        maxJobs: this.maxJobs,
        maxSpendUsd: this.maxSpendUsd,
      });
    } catch (error) {
      if (error instanceof GatewaySpendCapError) {
        const current = await this.ledger.snapshot();
        await alertSpendCap(error, {
          maxJobs: this.maxJobs,
          maxSpendUsd: this.maxSpendUsd,
          jobsAccepted: current.jobsAccepted,
          spendUsd: current.spendUsd,
        });
      }
      throw error;
    }
    return this.estimatedUsdPerJob;
  }
}
