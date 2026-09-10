import type {
  WatermarkApplyResult,
  WatermarkChromeView,
  WatermarkDecision,
} from "@/server/watermark/types";

/**
 * Presentation / export watermark policy. Not a Director creative beat.
 * Must not write CreativePlan / Story / Timeline.
 *
 * applyToOutput may stamp local deterministic text fixtures only. HTTP /
 * binary movie essence returns CHROME_ONLY (player chrome) until Brett §H4
 * visual design — do not invent an overlay or mutate video essence.
 */
export type WatermarkPolicy = {
  decide(input: { watermarkRequired: boolean }): WatermarkDecision;
  applyToOutput(bytes: Uint8Array, decision: WatermarkDecision): WatermarkApplyResult;
  chrome(decision: WatermarkDecision): WatermarkChromeView;
};
