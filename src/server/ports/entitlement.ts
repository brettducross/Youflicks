import type {
  AuthorizeGenerationIntent,
  AuthorizeGenerationResult,
  EntitlementSnapshot,
  PlatformGate,
} from "@/server/entitlement/types";

/**
 * Resolve effective entitlements and authorize movie generation.
 * Platform gate only — never writes CreativePlan / Story / Timeline.
 */
export type EntitlementPort = {
  resolve(userId: string): Promise<EntitlementSnapshot>;
  getPlatformGate(userId: string): Promise<PlatformGate>;
  authorizeGeneration(
    userId: string,
    intent?: AuthorizeGenerationIntent,
  ): Promise<AuthorizeGenerationResult>;
};
