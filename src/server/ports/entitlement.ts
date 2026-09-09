import type {
  AuthorizeGenerationIntent,
  AuthorizeGenerationResult,
  EntitlementSnapshot,
  EntitlementSummary,
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
  assertOutputDuration(userId: string, durationMs: number | null | undefined): Promise<void>;
};
