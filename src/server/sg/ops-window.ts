/**
 * Ops read bounds for PR-5 rollups.
 * Invalid day counts are rejected, not clamped: a clamped window would look complete.
 */
export const LANE_ROLLUP_DEFAULT_DAYS = 14;
export const LANE_ROLLUP_MAX_DAYS = 90;

/** ai_video_budget_ledger pages. The primary key is the index; updatedAt is not indexed. */
export const BUDGET_LEDGER_PAGE_SIZE = 50;

const DAYS_MESSAGE = "days must be an integer from 1 to 90.";

export class OpsQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpsQueryError";
  }
}

/**
 * Absent `days` is 14. A present value must be a base-10 integer from 1 through 90.
 * Leading zeros, fractions, and values above 90 are rejected.
 */
export function parseRollupDays(raw: string | null): number {
  if (raw == null) {
    return LANE_ROLLUP_DEFAULT_DAYS;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new OpsQueryError(DAYS_MESSAGE);
  }
  const days = Number(raw);
  if (days > LANE_ROLLUP_MAX_DAYS) {
    throw new OpsQueryError(DAYS_MESSAGE);
  }
  return days;
}

export function rollupSince(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * Absent cursor is the first page. A present cursor is the last id already returned.
 * The next page is `id > cursor`, which uses the primary key.
 */
export function parseBudgetLedgerCursor(raw: string | null): string | null {
  if (raw == null) {
    return null;
  }
  if (raw.length === 0 || raw.length > 200) {
    throw new OpsQueryError("ledgerCursor must be a non-empty id of at most 200 characters.");
  }
  return raw;
}
