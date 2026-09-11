import { reportOpsAlert, OpsAlertKind } from "@/lib/ops-alerts";
import { GATEWAY_SPEND_LEDGER_ID } from "@/server/beta/defaults";
import type { PrismaClient } from "@/generated/prisma/client";

export class GatewaySpendCapError extends Error {
  readonly code = "GATEWAY_SPEND_CAP";

  constructor(message: string) {
    super(message);
    this.name = "GatewaySpendCapError";
  }
}

export type SpendLedgerSnapshot = {
  jobsAccepted: number;
  spendUsd: number;
};

export type SpendLedgerCaps = {
  maxJobs?: number;
  maxSpendUsd?: number;
};

export interface SpendLedgerPort {
  snapshot(): Promise<SpendLedgerSnapshot>;
  tryReserve(estimatedUsd: number, caps: SpendLedgerCaps): Promise<void>;
}

export class MemorySpendLedger implements SpendLedgerPort {
  private jobsAccepted = 0;
  private spendUsd = 0;

  async snapshot(): Promise<SpendLedgerSnapshot> {
    return { jobsAccepted: this.jobsAccepted, spendUsd: this.spendUsd };
  }

  async tryReserve(estimatedUsd: number, caps: SpendLedgerCaps): Promise<void> {
    assertWithinCaps(this.jobsAccepted, this.spendUsd, estimatedUsd, caps);
    this.jobsAccepted += 1;
    this.spendUsd += estimatedUsd;
  }
}

type SpendLedgerDb = Pick<PrismaClient, "gatewaySpendLedger" | "$transaction">;

/**
 * Durable Postgres ledger. Restart of the gateway process must not reset spend.
 */
export class PrismaSpendLedger implements SpendLedgerPort {
  constructor(
    private readonly db: SpendLedgerDb,
    private readonly id: string = GATEWAY_SPEND_LEDGER_ID,
  ) {}

  async snapshot(): Promise<SpendLedgerSnapshot> {
    const row = await this.db.gatewaySpendLedger.findUnique({ where: { id: this.id } });
    return {
      jobsAccepted: row?.jobsAccepted ?? 0,
      spendUsd: row?.spendUsd ?? 0,
    };
  }

  async tryReserve(estimatedUsd: number, caps: SpendLedgerCaps): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const row = await tx.gatewaySpendLedger.upsert({
        where: { id: this.id },
        create: { id: this.id, jobsAccepted: 0, spendUsd: 0 },
        update: {},
      });
      assertWithinCaps(row.jobsAccepted, row.spendUsd, estimatedUsd, caps);
      await tx.gatewaySpendLedger.update({
        where: { id: this.id },
        data: {
          jobsAccepted: { increment: 1 },
          spendUsd: { increment: estimatedUsd },
        },
      });
    });
  }
}

export function assertWithinCaps(
  jobsAccepted: number,
  spendUsd: number,
  estimatedUsd: number,
  caps: SpendLedgerCaps,
) {
  if (caps.maxJobs !== undefined && jobsAccepted >= caps.maxJobs) {
    throw new GatewaySpendCapError(
      `Gateway job cap reached (${caps.maxJobs}). Raise YF_GATEWAY_MAX_JOBS or wait.`,
    );
  }
  if (caps.maxSpendUsd !== undefined && spendUsd + estimatedUsd > caps.maxSpendUsd) {
    throw new GatewaySpendCapError(
      `Gateway spend cap reached ($${caps.maxSpendUsd}). Raise YF_GATEWAY_MAX_SPEND_USD or wait.`,
    );
  }
}

export async function alertSpendCap(error: GatewaySpendCapError, context: Record<string, unknown>) {
  await reportOpsAlert({
    kind: OpsAlertKind.SPEND_GUARD,
    message: error.message,
    context,
  });
}
