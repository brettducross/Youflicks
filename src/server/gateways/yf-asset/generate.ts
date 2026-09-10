import {
  assertGatewaySecrets,
  type YfAssetGatewayConfig,
} from "@/server/gateways/yf-asset/config";
import {
  capabilityForGenerateKind,
  gatewayError,
  yfGenerateRequestSchema,
  type YfGenerateSuccess,
} from "@/server/gateways/yf-asset/contract";
import { downloadNormalizedAsset } from "@/server/gateways/yf-asset/download";
import { GatewayJobStore } from "@/server/gateways/yf-asset/jobs";
import { extractBackendRequestId, normalizeBackendAsset } from "@/server/gateways/yf-asset/normalize";
import { promptFromGenerateRequest } from "@/server/gateways/yf-asset/prompt";
import { GatewaySpendCapError, SpendGuard } from "@/server/gateways/yf-asset/spend";
import type { VideoBackend } from "@/server/gateways/yf-asset/backends/types";
import { AssetCapability } from "@/server/ports/capabilities";

export type GenerateHandlerResult =
  | { ok: true; status: 200; body: YfGenerateSuccess }
  | { ok: false; status: number; body: { error: string; code: string; capability?: string } };

export class YfAssetGenerateService {
  constructor(
    private readonly config: YfAssetGatewayConfig,
    private readonly backend: VideoBackend,
    private readonly jobs: GatewayJobStore,
    private readonly spend: SpendGuard,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async generate(rawBody: unknown): Promise<GenerateHandlerResult> {
    try {
      assertGatewaySecrets(this.config);
    } catch (error) {
      return gatewayError(
        503,
        "GATEWAY_NOT_CONFIGURED",
        error instanceof Error ? error.message : "Asset gateway is not configured.",
      );
    }

    const parsed = yfGenerateRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return gatewayError(400, "ASSET_INPUT_INVALID", "Generate body is not a YouFlicks /v1/generate request.");
    }

    const request = parsed.data;
    const capability = capabilityForGenerateKind(request.kind);
    if (!this.config.capabilities.includes(capability)) {
      return gatewayError(
        503,
        "ASSET_CAPABILITY_UNAVAILABLE",
        `This gateway does not advertise ${capability}. Voice, music, and SFX stay unmet unless a real adapter covers them.`,
        { capability },
      );
    }

    const model = resolveModel(this.config, request.model, capability);
    if (!model) {
      return gatewayError(
        503,
        "GATEWAY_NOT_CONFIGURED",
        "No open-string model is configured. Set ASSET_HTTP_MODEL or YF_GATEWAY_MODEL.",
      );
    }

    try {
      this.spend.assertWithinCap();
    } catch (error) {
      if (error instanceof GatewaySpendCapError) {
        return gatewayError(429, error.code, error.message);
      }
      throw error;
    }

    const input = asRecord(request.input);
    const estimatedCostUsd = this.spend.recordAccepted();
    const job = this.jobs.create({
      providerKey: this.config.providerKey,
      capability,
      modelId: model,
      estimatedCostUsd,
    });

    try {
      const submitted = await this.backend.submit({
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
      this.jobs.bindBackendRequest(job.jobId, submitted.backendRequestId);
      const asset = await this.waitForAsset(job.jobId, model, submitted.backendRequestId);
      const downloaded = await downloadNormalizedAsset(asset, {
        maxBytes: this.config.downloadMaxBytes,
        fetchImpl: this.fetchImpl,
      });
      this.jobs.markSucceeded(job.jobId, {
        ...asset,
        mimeType: downloaded.mimeType,
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

  /**
   * Accept a backend webhook. Keep only a normalized URL; drop vendor JSON.
   */
  acceptWebhook(rawBody: unknown): { status: number; body: { ok: boolean; jobId?: string } } {
    const backendRequestId = extractBackendRequestId(rawBody);
    const asset = normalizeBackendAsset(rawBody);
    if (!backendRequestId) {
      return { status: 202, body: { ok: true } };
    }
    const job = this.jobs.getByBackendRequest(backendRequestId);
    if (!job) {
      return { status: 202, body: { ok: true } };
    }
    if (asset) {
      this.jobs.markSucceeded(job.jobId, asset);
      return { status: 200, body: { ok: true, jobId: job.jobId } };
    }
    this.jobs.markFailed(job.jobId, "Backend webhook had no normalized asset URL.");
    return { status: 200, body: { ok: true, jobId: job.jobId } };
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
      if (local?.status === "failed") {
        throw new Error(local.error ?? "Gateway job failed.");
      }

      const status = await this.backend.status(model, backendRequestId);
      if (status.status === "failed") {
        throw new Error(status.error ?? "Backend generation failed.");
      }
      if (status.status === "succeeded") {
        return this.backend.result(model, backendRequestId);
      }
      await this.sleep(this.config.pollMs);
    }
    throw new Error("Asset gateway timed out waiting for the video backend.");
  }
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
