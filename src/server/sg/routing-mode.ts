import { routingModeSchema, type RoutingMode } from "@/server/sg/constants";

/**
 * E-R1 decided 2026-09-26: LEGACY for now; ENFORCED before invites.
 * See docs/wave0-wave1/PO_SG_E-R1_ROUTING_MODE_DECISION_2026-09-26.md.
 * This is the only mode default. Do not add a second default.
 * Switching to ENFORCED is a separate reviewed change required before invites.
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
