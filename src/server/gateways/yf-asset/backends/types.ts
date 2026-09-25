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

export type BackendStatusValue = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type BackendStatusResult = {
  status: BackendStatusValue;
  error?: string;
};

/**
 * Submit outcome the gateway can classify without reading error text.
 * `rejected` — the create request was not sent, or the host answered 4xx.
 * `unknown` — network error, 5xx, or a 2xx body with no provider job id.
 */
export class BackendSubmitError extends Error {
  readonly disposition: "rejected" | "unknown";
  readonly httpStatus?: number;

  constructor(message: string, disposition: "rejected" | "unknown", httpStatus?: number) {
    super(message);
    this.name = "BackendSubmitError";
    this.disposition = disposition;
    this.httpStatus = httpStatus;
  }
}

/** 4xx from the create call is a definite rejection. Anything else may have created a job. */
export function submitHttpError(label: string, status: number, text: string): BackendSubmitError {
  const disposition = status >= 400 && status < 500 ? "rejected" : "unknown";
  return new BackendSubmitError(`${label} (${status}): ${text.slice(0, 240)}`, disposition, status);
}

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
