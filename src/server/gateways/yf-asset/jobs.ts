import { randomUUID } from "node:crypto";

export type GatewayJobStatus = "queued" | "running" | "succeeded" | "failed";

/**
 * YouFlicks-owned gateway job. Persist only job id + normalized asset
 * metadata + open providerKey. Never vendor JSON, CreativePlan, Story, or Timeline.
 */
export type GatewayJobRecord = {
  jobId: string;
  providerKey: string;
  capability: string;
  modelId: string;
  status: GatewayJobStatus;
  assetUrl?: string;
  mimeType?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  estimatedCostUsd: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type NormalizedAssetMeta = {
  url: string;
  mimeType?: string;
  durationMs?: number;
  width?: number;
  height?: number;
};

export class GatewayJobStore {
  private readonly jobs = new Map<string, GatewayJobRecord>();
  private readonly byBackendRequest = new Map<string, string>();

  create(input: {
    providerKey: string;
    capability: string;
    modelId: string;
    estimatedCostUsd: number;
  }): GatewayJobRecord {
    const now = new Date().toISOString();
    const record: GatewayJobRecord = {
      jobId: `yf_asset_${randomUUID()}`,
      providerKey: input.providerKey,
      capability: input.capability,
      modelId: input.modelId,
      status: "queued",
      estimatedCostUsd: input.estimatedCostUsd,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(record.jobId, record);
    return { ...record };
  }

  get(jobId: string): GatewayJobRecord | undefined {
    const row = this.jobs.get(jobId);
    return row ? { ...row } : undefined;
  }

  getByBackendRequest(backendRequestId: string): GatewayJobRecord | undefined {
    const jobId = this.byBackendRequest.get(backendRequestId);
    return jobId ? this.get(jobId) : undefined;
  }

  bindBackendRequest(jobId: string, backendRequestId: string): void {
    this.byBackendRequest.set(backendRequestId, jobId);
    this.patch(jobId, { status: "running" });
  }

  markSucceeded(jobId: string, asset: NormalizedAssetMeta): GatewayJobRecord | undefined {
    return this.patch(jobId, {
      status: "succeeded",
      assetUrl: asset.url,
      mimeType: asset.mimeType,
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
    });
  }

  markFailed(jobId: string, error: string): GatewayJobRecord | undefined {
    return this.patch(jobId, { status: "failed", error });
  }

  private patch(
    jobId: string,
    update: Partial<Omit<GatewayJobRecord, "jobId" | "createdAt">>,
  ): GatewayJobRecord | undefined {
    const current = this.jobs.get(jobId);
    if (!current) {
      return undefined;
    }
    const next: GatewayJobRecord = {
      ...current,
      ...update,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, next);
    return { ...next };
  }
}
