import type { AttemptOutcome } from "@/server/sg/constants";

/**
 * Maps a PR-1 settlement onto a ShotFulfillmentAttempt outcome.
 * This does not move money and does not choose another lane.
 *
 * Still-counted results other than CANCELLED use TIMEOUT_UNRECONCILED,
 * because the attempt vocabulary has no separate SUBMIT_UNKNOWN outcome.
 * failureCode keeps the PR-1 reason.
 */
export type SettlementLabel = "RELEASED" | "RECONCILED" | "UNRECONCILED" | "NONE" | "MISSING";

export type AttemptOutcomeMapping = {
  outcome: AttemptOutcome;
  failureCode: string | null;
};

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
  if (input.settleReason === "SUBMIT_REJECTED" || isDefinitiveClientRejection(input.gatewayStatus)) {
    return {
      outcome: "REJECTED_TECHNICAL",
      failureCode: input.settleReason ?? input.gatewayCode ?? "REJECTED_TECHNICAL",
    };
  }
  if (input.settleReason === "TIMEOUT" || input.settleReason === "ABORTED") {
    return { outcome: "TIMEOUT_UNRECONCILED", failureCode: input.settleReason };
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
    failureCode:
      input.settleReason ??
      (input.settlement === "MISSING" ? "SETTLEMENT_MISSING" : "UNRECONCILED"),
  };
}

/** 408 and 409 stay unknown (PR-1). 429 is the spend-cap path, not a technical rejection. */
function isDefinitiveClientRejection(status: number | null | undefined): boolean {
  if (status == null || !Number.isInteger(status)) {
    return false;
  }
  if (status === 408 || status === 409 || status === 429) {
    return false;
  }
  return status >= 400 && status < 500;
}
