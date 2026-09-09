/**
 * Simple abuse quarantine. Start-simple M8.2 — a per-user flag, not heuristics.
 */
export type AbuseSignalPort = {
  isQuarantined(userId: string): Promise<boolean>;
  setQuarantined(userId: string, quarantined: boolean, reason?: string | null): Promise<void>;
};
