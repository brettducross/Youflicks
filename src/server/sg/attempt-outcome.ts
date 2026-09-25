import type { AttemptOutcome } from "@/server/sg/constants";

/**
 * Maps a PR-1 settlement onto a ShotFulfillmentAttempt outcome.
 * This does not move money and does not choose another lane.
 *
 * Still-counted results other than CANCELLED use TIMEOUT_UNRECONCILED.
 * failureCode keeps the PR-1 reason and is never null for those rows.
 * REJECTED_TECHNICAL is an output-contract outcome (lock L559), recorded
 * by AssetService after a billed success. It is not a submit-status mapping.
 */
export type SettlementLabel = "RELEASED" | "RECONCILED" | "UNRECONCILED" | "NONE" | "MISSING";

export type AttemptOutcomeMapping = {
  outcome: AttemptOutcome;
  failureCode: string | null;
};

/** Reasons that stay counted even when a 4xx status is also present. */
const STILL_COUNTED_REASONS = new Set([
  "TIMEOUT",
  "ABORTED",
  "SUBMIT_UNKNOWN",
  "UNKNOWN",
  "STATUS_UNKNOWN",
  "RESULT_UNKNOWN",
]);

export function attemptOutcomeFromSettlement(input: {
  spendCap: boolean;
  settlement: SettlementLabel | null;
  settleReason: string | null;
  gatewayStatus?: number | null;
  gatewayCode?: string | null;
}): AttemptOutcomeMapping {
  if (input.spendCap || input.settleReason === "CAP_DENIED") {
    return { outcome: "CAP_DENIED", failureCode: "CAP_DENIED" };
  }
  if (input.settleReason === "CANCELLED") {
    return { outcome: "CANCELLED", failureCode: "CANCELLED" };
  }
  if (
    input.settlement === "UNRECONCILED" ||
    input.settlement === "MISSING" ||
    input.settlement == null ||
    (input.settleReason != null && STILL_COUNTED_REASONS.has(input.settleReason))
  ) {
    return {
      outcome: "TIMEOUT_UNRECONCILED",
      failureCode: input.settleReason ?? input.gatewayCode ?? "SETTLEMENT_MISSING",
    };
  }
  if (
    (input.settlement === "RELEASED" || input.settlement === "NONE") &&
    (input.settleReason === "SUBMIT_REJECTED" ||
      (input.settleReason == null && isDefinitiveClientRejection(input.gatewayStatus)))
  ) {
    return { outcome: "FAILED", failureCode: "SUBMIT_REJECTED" };
  }
  if (input.settlement === "RECONCILED") {
    return { outcome: "FAILED", failureCode: input.settleReason ?? "RECONCILED" };
  }
  if (input.settlement === "NONE") {
    return { outcome: "FAILED", failureCode: input.settleReason ?? "GATEWAY_NONE" };
  }
  if (input.settlement === "RELEASED") {
    return { outcome: "FAILED", failureCode: input.settleReason ?? "RELEASED" };
  }
  return {
    outcome: "TIMEOUT_UNRECONCILED",
    failureCode: input.settleReason ?? input.gatewayCode ?? "SETTLEMENT_MISSING",
  };
}

/** 408 and 409 stay unknown (PR-1). 429 is the spend-cap path, not a submit rejection. */
function isDefinitiveClientRejection(status: number | null | undefined): boolean {
  if (status == null || !Number.isInteger(status)) {
    return false;
  }
  if (status === 408 || status === 409 || status === 429) {
    return false;
  }
  return status >= 400 && status < 500;
}
