/**
 * Privacy boundary for taste and sponsorship.
 *
 * Taste belongs to the subscriber. Capability adapters receive only a
 * capability-specific hint — never the full TasteProfile.
 * Sponsors never receive taste, footage, analysis, or personal identifiers.
 */

import type { TasteProfileView } from "@/server/personalization/views";

export function tasteHintForCapability(profile: TasteProfileView, capability: string) {
  void profile;
  void capability;
  return {} as Record<string, never>;
}

export function assertNoTasteInProviderPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const keys = Object.keys(payload as Record<string, unknown>);
  const forbidden = ["tasteProfile", "preferences", "signals", "favorite_films"];
  if (keys.some((key) => forbidden.includes(key))) {
    throw new Error("Taste data must not be sent to a capability adapter.");
  }
}

export const SPONSOR_CREATIVE_DENYLIST = [
  "footage selection",
  "story structure",
  "AI Director",
  "user taste",
  "timeline",
  "rendering decisions",
] as const;

export const SPONSOR_MAY_AFFECT = [
  "approved credit presentation",
  "approved end-card presentation",
  "approved advertisement placement",
] as const;
