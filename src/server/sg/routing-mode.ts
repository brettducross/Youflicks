import { routingModeSchema, type RoutingMode } from "@/server/sg/constants";

/**
 * Working default while E-R1 is pending. This is the only mode default.
 * The default routing mode and any hosted flip await PO decision E-R1 (pending).
 * Flip this constant, or set SG_ROUTING_MODE, without restructuring callers.
 */
export const DEFAULT_SG_ROUTING_MODE = "LEGACY" as const satisfies RoutingMode;

/**
 * E12 is open (lock L507). Null means a dialogue close-up is ORIGINAL when
 * the original media covers the slot, and DEFER otherwise. This constant does
 * not generate. A generated dialogue or talking-face treatment remains a
 * possible later E12 decision, subject to quality and safety gates and a
 * further lock amendment.
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
