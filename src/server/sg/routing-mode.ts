import { routingModeSchema, type RoutingMode } from "@/server/sg/constants";

/**
 * E-R1 working default. This is the only mode default.
 *
 * LEGACY is temporary: the live R1 lane (LEGACY_R1, Wan via Replicate) may
 * still serve while internal, and E-R1 is not a launch decision. ENFORCED
 * is required before any invite or hosted flip. Flip this constant, or set
 * SG_ROUTING_MODE, without restructuring callers.
 */
export const DEFAULT_SG_ROUTING_MODE = "LEGACY" as const satisfies RoutingMode;

/**
 * E12 is open. Null means a dialogue close-up is ORIGINAL when the original
 * media covers the slot, and DEFER otherwise. Never GENERATE. A later PO
 * value may be ORIGINAL, STATIC, or KEN_BURNS; it is never a paid treatment.
 */
export const E12_DIALOGUE_TREATMENT: "ORIGINAL" | "STATIC" | "KEN_BURNS" | null = null;

export function readSgRoutingMode(
  source: Record<string, string | undefined> = process.env,
): RoutingMode {
  const raw = source.SG_ROUTING_MODE?.trim() ?? "";
  if (raw.length === 0) {
    return DEFAULT_SG_ROUTING_MODE;
  }
  const parsed = routingModeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("SG_ROUTING_MODE must be LEGACY or ENFORCED.");
  }
  return parsed.data;
}
