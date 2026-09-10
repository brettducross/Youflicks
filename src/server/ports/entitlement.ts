import type {
  AuthorizeGenerationIntent,
  AuthorizeGenerationResult,
  EntitlementSnapshot,
  EntitlementSummary,
  GenerationConstraintReceipt,
  GenerationConstraints,
  PlatformGate,
} from "@/server/entitlement/types";

/**
 * Resolve effective entitlements and authorize movie generation.
 * Platform gate only — never writes CreativePlan / Story / Timeline.
 */
export type EntitlementPort = {
  resolve(userId: string): Promise<EntitlementSnapshot>;
  getPlatformGate(userId: string): Promise<PlatformGate>;
  getEntitlementSummary(userId: string): Promise<EntitlementSummary>;
  authorizeGeneration(
    userId: string,
    intent?: AuthorizeGenerationIntent,
  ): Promise<AuthorizeGenerationResult>;
  policyConstraints(userId: string, projectId?: string): Promise<GenerationConstraints>;
  latestConstraintReceipt(
    userId: string,
    projectId?: string,
  ): Promise<GenerationConstraintReceipt | null>;
  /**
   * Enforce maxOutputDurationMs against a known produced or requested duration.
   * Null/undefined is fail-closed (OUTPUT_DURATION_UNKNOWN) — do not no-op
   * past the entitlement cap when SUCCEEDED/READY output omitted durationMs.
   */
  assertOutputDuration(
    userId: string,
    durationMs: number | null | undefined,
    projectId?: string,
  ): Promise<void>;
};
