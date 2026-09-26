import { randomUUID } from "node:crypto";
import {
  assertGatewaySecrets,
  type YfAssetGatewayConfig,
} from "@/server/gateways/yf-asset/config";
import {
  capabilityForGenerateKind,
  gatewayError,
  yfGenerateRequestSchema,
  type GatewayErrorBody,
  type GatewaySettlement,
  type YfGenerateSuccess,
} from "@/server/gateways/yf-asset/contract";
import { downloadNormalizedAsset } from "@/server/gateways/yf-asset/download";
import { GatewayJobStore } from "@/server/gateways/yf-asset/jobs";
import { extractBackendRequestId, mapQueueStatus, normalizeBackendAsset } from "@/server/gateways/yf-asset/normalize";
import { promptFromGenerateRequest } from "@/server/gateways/yf-asset/prompt";
import { alertSpendCap, GatewaySpendCapError } from "@/server/gateways/yf-asset/ledger";
import {
  type GatewayReservationPort,
  type GatewayReservationRecord,
} from "@/server/gateways/yf-asset/reservation";
import { SpendGuard } from "@/server/gateways/yf-asset/spend";
import { BackendSubmitError, type VideoBackend } from "@/server/gateways/yf-asset/backends/types";
import { AssetCapability } from "@/server/ports/capabilities";
import {
  actualBilledSecondsFromDurationMs,
  estimateLaneCharge,
  gatewayChargeLedgerIds,
  LaneDurationError,
  numericExtraDuration,
  requireLiveLane,
  roundMeasure,
  type LaneRate,
  type RegistryLane,
} from "@/server/sg/lane-rate";

export type GenerateHandlerResult =
  | { ok: true; status: 200; body: YfGenerateSuccess }
  | { ok: false; status: number; body: GatewayErrorBody };

export class YfAssetGenerateService {
  constructor(
    private readonly config: YfAssetGatewayConfig,
    private readonly backend: VideoBackend,
    private readonly jobs: GatewayJobStore,
    private readonly spend: SpendGuard,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly reservations?: GatewayReservationPort,
  ) {}

  async generate(rawBody: unknown): Promise<GenerateHandlerResult> {
    try {
      assertGatewaySecrets(this.config);
    } catch (error) {
      return noReservationError(
        503,
        "GATEWAY_NOT_CONFIGURED",
        error instanceof Error ? error.message : "Asset gateway is not configured.",
      );
    }

    const parsed = yfGenerateRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return noReservationError(
        400,
        "ASSET_INPUT_INVALID",
        "Generate body is not a YouFlicks /v1/generate request.",
      );
    }

    const request = parsed.data;
    const capability = capabilityForGenerateKind(request.kind);
    if (!this.config.capabilities.includes(capability)) {
      return noReservationError(
        503,
        "ASSET_CAPABILITY_UNAVAILABLE",
        `This gateway does not advertise ${capability}. Voice, music, and SFX stay unmet unless a real adapter covers them.`,
        { capability },
      );
    }

    const model = resolveModel(this.config, request.model, capability);
    if (!model) {
      return noReservationError(
        503,
        "GATEWAY_NOT_CONFIGURED",
        "No open-string model is configured. Set ASSET_HTTP_MODEL or YF_GATEWAY_MODEL.",
      );
    }

    const input = asRecord(request.input);
    if (this.config.backend === "mock") {
      return this.generateFlat(capability, model, request, input);
    }
    return this.generateLanePriced(capability, model, request, input);
  }

  /** Mock only. Live backends never reserve a flat per-job amount. */
  private async generateFlat(
    capability: string,
    model: string,
    request: { kind: string; role: string },
    input: Record<string, unknown>,
  ): Promise<GenerateHandlerResult> {
    try {
      await this.spend.assertWithinCap();
    } catch (error) {
      if (error instanceof GatewaySpendCapError) {
        return gatewayError(429, error.code, error.message);
      }
      throw error;
    }

    const estimatedCostUsd = await this.spend.recordAccepted();
    const job = this.jobs.create({
      providerKey: this.config.providerKey,
      capability,
      modelId: model,
      estimatedCostUsd,
    });

    try {
      const downloaded = await this.runBackend(job.jobId, model, request, input);
      this.jobs.markSucceeded(job.jobId, {
        url: downloaded.assetUrl,
        mimeType: downloaded.mimeType,
        durationMs: downloaded.durationMs,
        width: downloaded.width,
        height: downloaded.height,
      });
      return {
        ok: true,
        status: 200,
        body: {
          mimeType: downloaded.mimeType,
          bytesBase64: Buffer.from(downloaded.bytes).toString("base64"),
          durationMs: downloaded.durationMs,
          width: downloaded.width,
          height: downloaded.height,
          jobId: job.jobId,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Asset gateway generate failed.";
      this.jobs.markFailed(job.jobId, message);
      return gatewayError(503, "ASSET_PROVIDER_UNAVAILABLE", message);
    }
  }

  private async generateLanePriced(
    capability: string,
    model: string,
    request: { kind: string; role: string },
    input: Record<string, unknown>,
  ): Promise<GenerateHandlerResult> {
    let lane: RegistryLane;
    try {
      lane = requireLiveLane(this.config.laneId ?? "", this.config.registryPath);
    } catch (error) {
      return noReservationError(
        503,
        "GATEWAY_NOT_CONFIGURED",
        error instanceof Error ? error.message : "Live gateway lane is not configured.",
      );
    }

    if (model !== lane.modelId) {
      return noReservationError(
        409,
        "MODEL_LANE_MISMATCH",
        "The request model does not match the configured lane.",
      );
    }

    let charge;
    try {
      charge = estimateLaneCharge(lane, numericExtraDuration(this.config.extraInput));
    } catch (error) {
      if (error instanceof LaneDurationError) {
        return noReservationError(400, error.code, error.message);
      }
      throw error;
    }

    if (!this.reservations) {
      return noReservationError(
        503,
        "GATEWAY_NOT_CONFIGURED",
        "A live gateway requires a durable spend reservation ledger. Flat per-job reservation is not used.",
      );
    }
    const reservations = this.reservations;
    let reservation: GatewayReservationRecord;
    try {
      reservation = await reservations.reserve({
        idempotencyKey: randomUUID(),
        ledgerIds: gatewayChargeLedgerIds(this.config.ledgerId, lane.laneId),
        laneId: lane.laneId,
        providerKey: lane.providerKey,
        capability,
        modelId: model,
        requestedDurationS: charge.requestedDurationS,
        estimatedBilledSeconds: charge.estimatedBilledSeconds,
        usdPerSecond: lane.usdPerSecond,
        reservedUsd: charge.reservedUsd,
        primaryLedgerId: this.config.ledgerId,
        maxJobs: this.config.maxJobs,
        maxSpendUsd: this.config.maxSpendUsd,
        maxBilledSeconds: this.config.maxBilledSeconds,
        laneLedgerId: `lane:${lane.laneId}`,
        laneMaxSpendUsd: this.config.laneMaxSpendUsd,
      });
    } catch (error) {
      if (error instanceof GatewaySpendCapError) {
        const current = await reservations.snapshot(this.config.ledgerId);
        await alertSpendCap(error, {
          maxJobs: this.config.maxJobs,
          maxSpendUsd: this.config.maxSpendUsd,
          jobsAccepted: current.jobsAccepted,
          spendUsd: current.spendUsd,
          laneId: lane.laneId,
          ledgerId: this.config.ledgerId,
        });
        return gatewayError(429, error.code, error.message);
      }
      throw error;
    }

    const job = this.jobs.create({
      providerKey: this.config.providerKey,
      capability,
      modelId: model,
      estimatedCostUsd: charge.reservedUsd,
    });
    await reservations.bindGatewayJob(reservation.id, job.jobId);

    try {
      const outcome = await this.runBackend(job.jobId, model, request, input);
      const actual = actualBilledSecondsFromDurationMs(
        outcome.durationMs,
        lane.billingGranularityS,
        charge.estimatedBilledSeconds,
      );
      await reservations.reconcile(reservation.id, {
        actualBilledSeconds: actual.seconds,
        reason: actual.flagged ? "ACTUAL_DURATION_FALLBACK" : "SUCCEEDED",
      });
      this.jobs.markSucceeded(job.jobId, {
        url: outcome.assetUrl,
        mimeType: outcome.mimeType,
        durationMs: outcome.durationMs,
        width: outcome.width,
        height: outcome.height,
      });
      return {
        ok: true,
        status: 200,
        body: {
          mimeType: outcome.mimeType,
          bytesBase64: Buffer.from(outcome.bytes).toString("base64"),
          durationMs: outcome.durationMs,
          width: outcome.width,
          height: outcome.height,
          jobId: job.jobId,
          gatewayReservationId: reservation.id,
          actualBilledSeconds: actual.seconds,
          actualUsd: roundMeasure(actual.seconds * lane.usdPerSecond),
        },
      };
    } catch (error) {
      const settled = await this.settleLaneFailure(
        reservations,
        reservation,
        lane,
        charge.estimatedBilledSeconds,
        error,
      );
      const message = error instanceof Error ? error.message : "Asset gateway generate failed.";
      this.jobs.markFailed(job.jobId, message);
      const extra = {
        settlement: settled.settlement,
        settleReason: settled.settleReason,
        gatewayReservationId: reservation.id,
        gatewayJobId: job.jobId,
        ...(settled.actualBilledSeconds !== undefined
          ? { actualBilledSeconds: settled.actualBilledSeconds }
          : {}),
        ...(settled.actualUsd !== undefined ? { actualUsd: settled.actualUsd } : {}),
      };
      if (error instanceof LaneDurationError) {
        return gatewayError(400, error.code, message, extra);
      }
      return gatewayError(503, "ASSET_PROVIDER_UNAVAILABLE", message, extra);
    }
  }

  private async settleLaneFailure(
    reservations: GatewayReservationPort,
    reservation: GatewayReservationRecord,
    lane: LaneRate,
    estimatedBilledSeconds: number,
    error: unknown,
  ): Promise<{
    settlement: GatewaySettlement;
    settleReason: string;
    actualBilledSeconds?: number;
    actualUsd?: number;
  }> {
    const classified = classifyBackendFailure(error);
    if (classified.kind === "download_after_success") {
      const actual = actualBilledSecondsFromDurationMs(
        classified.durationMs,
        lane.billingGranularityS,
        estimatedBilledSeconds,
      );
      const reason = actual.flagged
        ? "DOWNLOAD_FAILURE_ACTUAL_DURATION_FALLBACK"
        : "DOWNLOAD_FAILURE_BILLED";
      await reservations.reconcile(reservation.id, {
        actualBilledSeconds: actual.seconds,
        reason,
      });
      return {
        settlement: "RECONCILED",
        settleReason: reason,
        actualBilledSeconds: actual.seconds,
        actualUsd: roundMeasure(actual.seconds * lane.usdPerSecond),
      };
    }
    if (classified.kind === "backend_failed") {
      if (lane.failuresBillable) {
        await reservations.reconcile(reservation.id, {
          actualBilledSeconds: estimatedBilledSeconds,
          reason: "FAILURE_BILLABLE",
        });
        return {
          settlement: "RECONCILED",
          settleReason: "FAILURE_BILLABLE",
          actualBilledSeconds: estimatedBilledSeconds,
          actualUsd: roundMeasure(estimatedBilledSeconds * lane.usdPerSecond),
        };
      }
      await reservations.release(reservation.id, "FAILURE_NOT_BILLABLE");
      return { settlement: "RELEASED", settleReason: "FAILURE_NOT_BILLABLE" };
    }
    if (classified.kind === "submit_rejected") {
      await reservations.release(reservation.id, "SUBMIT_REJECTED");
      return { settlement: "RELEASED", settleReason: "SUBMIT_REJECTED" };
    }
    await reservations.markUnreconciled(reservation.id, classified.reason);
    return { settlement: "UNRECONCILED", settleReason: classified.reason };
  }

  private async runBackend(
    jobId: string,
    model: string,
    request: { kind: string; role: string },
    input: Record<string, unknown>,
  ): Promise<{
    bytes: Uint8Array;
    mimeType: string;
    durationMs?: number;
    width?: number;
    height?: number;
    assetUrl: string;
  }> {
    let submitted;
    try {
      submitted = await this.backend.submit({
        model,
        prompt: promptFromGenerateRequest({
          kind: request.kind,
          role: request.role,
          creativeHints: asRecord(input.creativeHints),
          projectIntent: asRecord(input.projectIntent),
          effectiveBrief: asRecord(input.effectiveBrief),
        }),
        extra: this.config.extraInput,
        webhookUrl: this.config.webhookUrl,
      });
    } catch (error) {
      const disposition = classifySubmitThrow(error);
      const message = error instanceof Error ? error.message : "Backend submit failed.";
      if (disposition === "unknown") {
        throw new GatewayUnreconciledError(message, "SUBMIT_UNKNOWN");
      }
      throw new GatewaySubmitRejectedError(message);
    }
    this.jobs.bindBackendRequest(jobId, submitted.backendRequestId);
    const asset = await this.waitForAsset(jobId, model, submitted.backendRequestId);
    try {
      const downloaded = await downloadNormalizedAsset(asset, {
        maxBytes: this.config.downloadMaxBytes,
        fetchImpl: this.fetchImpl,
      });
      return { ...downloaded, assetUrl: asset.url };
    } catch (error) {
      throw new GatewayDownloadFailedError(
        error instanceof Error ? error.message : "Asset download failed.",
        asset.durationMs,
      );
    }
  }

  /**
   * Accept a backend webhook. Keep only a normalized URL; drop vendor JSON.
   * In-progress and unknown events do not change the job. A missing URL is not a failure.
   */
  acceptWebhook(rawBody: unknown): { status: number; body: { ok: boolean; jobId?: string } } {
    const backendRequestId = extractBackendRequestId(rawBody);
    if (!backendRequestId) {
      return { status: 202, body: { ok: true } };
    }
    const job = this.jobs.getByBackendRequest(backendRequestId);
    if (!job) {
      return { status: 202, body: { ok: true } };
    }
    const status = mapQueueStatus(webhookStatus(rawBody));
    if (status === "canceled") {
      this.jobs.markCanceled(job.jobId);
      return { status: 200, body: { ok: true, jobId: job.jobId } };
    }
    if (status === "failed") {
      this.jobs.markFailed(job.jobId, webhookError(rawBody) ?? "Backend generation failed.");
      return { status: 200, body: { ok: true, jobId: job.jobId } };
    }
    if (status === "succeeded") {
      const asset = normalizeBackendAsset(rawBody);
      if (asset) {
        this.jobs.markSucceeded(job.jobId, asset);
        return { status: 200, body: { ok: true, jobId: job.jobId } };
      }
    }
    return { status: 202, body: { ok: true } };
  }

  private async waitForAsset(jobId: string, model: string, backendRequestId: string) {
    const deadline = Date.now() + this.config.timeoutMs;
    while (Date.now() < deadline) {
      const local = this.jobs.get(jobId);
      if (local?.status === "succeeded" && local.assetUrl) {
        return {
          url: local.assetUrl,
          mimeType: local.mimeType,
          durationMs: local.durationMs,
          width: local.width,
          height: local.height,
        };
      }
      if (local?.status === "canceled") {
        throw new GatewayUnreconciledError(
          local.error ?? "Backend generation was canceled.",
          "CANCELLED",
        );
      }
      if (local?.status === "failed") {
        const message = local.error ?? "Gateway job failed.";
        throw new GatewayBackendFailedError(message);
      }

      let status;
      try {
        status = await this.backend.status(model, backendRequestId);
      } catch (error) {
        throw new GatewayUnreconciledError(
          error instanceof Error ? error.message : "Backend status is unknown.",
          "STATUS_UNKNOWN",
        );
      }
      if (status.status === "canceled") {
        throw new GatewayUnreconciledError(
          status.error ?? "Backend generation was canceled.",
          "CANCELLED",
        );
      }
      if (status.status === "failed") {
        throw new GatewayBackendFailedError(status.error ?? "Backend generation failed.");
      }
      if (status.status === "succeeded") {
        try {
          return await this.backend.result(model, backendRequestId);
        } catch (error) {
          throw new GatewayUnreconciledError(
            error instanceof Error ? error.message : "Backend result is unknown.",
            "RESULT_UNKNOWN",
          );
        }
      }
      await this.sleep(this.config.pollMs);
    }
    throw new GatewayUnreconciledError(
      "Asset gateway timed out waiting for the video backend.",
      "TIMEOUT",
    );
  }
}

class GatewaySubmitRejectedError extends Error {
  readonly kind = "submit_rejected";
  constructor(message: string) {
    super(message);
    this.name = "GatewaySubmitRejectedError";
  }
}

class GatewayBackendFailedError extends Error {
  readonly kind = "backend_failed";
  constructor(message: string) {
    super(message);
    this.name = "GatewayBackendFailedError";
  }
}

class GatewayDownloadFailedError extends Error {
  readonly kind = "download_after_success";
  readonly durationMs?: number;
  constructor(message: string, durationMs?: number) {
    super(message);
    this.name = "GatewayDownloadFailedError";
    this.durationMs = durationMs;
  }
}

class GatewayUnreconciledError extends Error {
  readonly kind = "unreconciled";
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = "GatewayUnreconciledError";
    this.reason = reason;
  }
}

function classifyBackendFailure(error: unknown):
  | { kind: "download_after_success"; durationMs?: number }
  | { kind: "backend_failed" }
  | { kind: "submit_rejected" }
  | { kind: "unreconciled"; reason: string } {
  if (error instanceof GatewayDownloadFailedError) {
    return { kind: "download_after_success", durationMs: error.durationMs };
  }
  if (error instanceof GatewayBackendFailedError) {
    return { kind: "backend_failed" };
  }
  if (error instanceof GatewaySubmitRejectedError) {
    return { kind: "submit_rejected" };
  }
  if (error instanceof GatewayUnreconciledError) {
    return { kind: "unreconciled", reason: error.reason };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { kind: "unreconciled", reason: "ABORTED" };
  }
  return { kind: "unreconciled", reason: "UNKNOWN" };
}

/**
 * Release only when the create call definitely did not start a provider job.
 * Network errors, 5xx, and a 2xx with no id stay UNRECONCILED. Cancel is not
 * detected from error text; status() carries an explicit canceled value.
 */
function classifySubmitThrow(error: unknown): "rejected" | "unknown" {
  if (error instanceof BackendSubmitError) {
    return error.disposition;
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TypeError")) {
    return "unknown";
  }
  const message = error instanceof Error ? error.message : "";
  if (/\bfetch failed\b/i.test(message)) {
    return "unknown";
  }
  const status = /failed \((\d{3})\)/.exec(message);
  if (status) {
    const code = Number(status[1]);
    if (code === 408 || code === 409) {
      return "unknown";
    }
    if (code >= 400 && code < 500) {
      return "rejected";
    }
    return "unknown";
  }
  if (/no (prediction|request) id/i.test(message)) {
    return "unknown";
  }
  if (/timeout|timed out|\babort\b/i.test(message)) {
    return "unknown";
  }
  return "rejected";
}

function noReservationError(
  status: number,
  code: string,
  error: string,
  extra?: { capability?: string },
): GenerateHandlerResult {
  return gatewayError(status, code, error, { ...extra, settlement: "NONE" });
}

function webhookStatus(rawBody: unknown): unknown {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return undefined;
  }
  return (rawBody as Record<string, unknown>).status;
}

function webhookError(rawBody: unknown): string | undefined {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return undefined;
  }
  const error = (rawBody as Record<string, unknown>).error;
  return typeof error === "string" && error.length > 0 ? error : undefined;
}

function resolveModel(
  config: YfAssetGatewayConfig,
  requested: string | undefined,
  capability: string,
): string | undefined {
  if (requested && requested.trim().length > 0) {
    return requested.trim();
  }
  if (capability === AssetCapability.IMAGE_GENERATION) {
    return config.imageModel ?? config.model;
  }
  return config.model || undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
