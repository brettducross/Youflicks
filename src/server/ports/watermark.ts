import type {
  WatermarkApplyResult,
  WatermarkChromeView,
  WatermarkDecision,
} from "@/server/watermark/types";

/**
 * Presentation / export watermark policy. Not a Director creative beat.
 * Must not write CreativePlan / Story / Timeline.
 */
export type WatermarkPolicy = {
  decide(input: { watermarkRequired: boolean }): WatermarkDecision;
  applyToOutput(bytes: Uint8Array, decision: WatermarkDecision): WatermarkApplyResult;
  chrome(decision: WatermarkDecision): WatermarkChromeView;
};
