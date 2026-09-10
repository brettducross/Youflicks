import type { WatermarkPolicy } from "@/server/ports/watermark";
import {
  WATERMARK_LABEL,
  WatermarkSurface,
  type WatermarkApplyResult,
  type WatermarkChromeView,
  type WatermarkDecision,
} from "@/server/watermark/types";

const LOCAL_RENDER_PREFIX = "YouFlicks local deterministic render";
const WATERMARK_MARKER = "watermark=YouFlicks\n";

/**
 * M8.4 WatermarkPolicy adapter. Presentation / export post-process only.
 * Does not invent a Director scene or mutate Timeline / CreativePlan.
 */
export class WatermarkPolicyService implements WatermarkPolicy {
  decide(input: { watermarkRequired: boolean }): WatermarkDecision {
    if (!input.watermarkRequired) {
      return { required: false, label: WATERMARK_LABEL, applyTo: [] };
    }
    return {
      required: true,
      label: WATERMARK_LABEL,
      applyTo: [
        WatermarkSurface.RENDER_PRESENTATION,
        WatermarkSurface.EXPORT_POST,
        WatermarkSurface.PLAYER_CHROME,
      ],
    };
  }

  applyToOutput(bytes: Uint8Array, decision: WatermarkDecision): WatermarkApplyResult {
    if (!decision.required) {
      return {
        required: false,
        applied: false,
        mutated: false,
        bytes,
        surface: "CHROME_ONLY",
      };
    }
    const head = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 80))).toString("utf8");
    if (!head.startsWith(LOCAL_RENDER_PREFIX)) {
      return {
        required: true,
        applied: true,
        mutated: false,
        bytes,
        surface: "CHROME_ONLY",
      };
    }
    const text = Buffer.from(bytes).toString("utf8");
    if (text.includes("watermark=YouFlicks")) {
      return {
        required: true,
        applied: true,
        mutated: false,
        bytes,
        surface: "OUTPUT_BYTES",
      };
    }
    const stamped = Buffer.concat([Buffer.from(bytes), Buffer.from(WATERMARK_MARKER)]);
    return {
      required: true,
      applied: true,
      mutated: true,
      bytes: new Uint8Array(stamped),
      surface: "OUTPUT_BYTES",
    };
  }

  chrome(decision: WatermarkDecision): WatermarkChromeView {
    return {
      required: decision.required,
      label: decision.label,
      placement: WatermarkSurface.PLAYER_CHROME,
    };
  }
}
