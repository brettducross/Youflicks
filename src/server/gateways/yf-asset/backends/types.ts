import type { NormalizedAssetMeta } from "@/server/gateways/yf-asset/jobs";

export type BackendSubmitInput = {
  model: string;
  prompt: string;
  extra: Record<string, unknown>;
  webhookUrl?: string;
};

export type BackendSubmitResult = {
  backendRequestId: string;
};

export type BackendStatusValue = "queued" | "running" | "succeeded" | "failed";

export type BackendStatusResult = {
  status: BackendStatusValue;
  error?: string;
};

/**
 * Config-backed video backend. fal queue+webhooks is one HTTP preset —
 * not domain truth and not an SDK import.
 */
export interface VideoBackend {
  readonly kind: string;
  submit(input: BackendSubmitInput): Promise<BackendSubmitResult>;
  status(model: string, backendRequestId: string): Promise<BackendStatusResult>;
  result(model: string, backendRequestId: string): Promise<NormalizedAssetMeta>;
}
