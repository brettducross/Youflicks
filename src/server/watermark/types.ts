/**
 * M8.4 watermark presentation types. Policy only — not Director / Timeline meaning.
 *
 * Honesty (YF-040 / Brett §H4 still open for visual branding):
 * - Local deterministic text fixtures may receive a trailing policy stamp
 *   (`watermark=YouFlicks`) on OUTPUT_BYTES. That is a policy receipt, not a
 *   designed on-film brand mark.
 * - HTTP / binary movie essence is CHROME_ONLY. Mutating video bytes (trailer
 *   or invented overlay) can corrupt playback and would invent §H4 branding.
 *   Player chrome is the honest free-tier surface until Product Owner sets
 *   visual design.
 */

export const WATERMARK_LABEL = "YouFlicks";

export const WatermarkSurface = {
  RENDER_PRESENTATION: "RENDER_PRESENTATION",
  EXPORT_POST: "EXPORT_POST",
  PLAYER_CHROME: "PLAYER_CHROME",
} as const;

export type WatermarkSurfaceValue =
  (typeof WatermarkSurface)[keyof typeof WatermarkSurface];

export const WatermarkApplyReason = {
  NOT_REQUIRED: "NOT_REQUIRED",
  LOCAL_TEXT_STAMPED: "LOCAL_TEXT_STAMPED",
  ALREADY_STAMPED: "ALREADY_STAMPED",
  BINARY_ESSENCE_CHROME_ONLY: "BINARY_ESSENCE_CHROME_ONLY",
} as const;

export type WatermarkApplyReasonValue =
  (typeof WatermarkApplyReason)[keyof typeof WatermarkApplyReason];

export type WatermarkDecision = {
  required: boolean;
  label: string;
  applyTo: WatermarkSurfaceValue[];
};

export type WatermarkChromeView = {
  required: boolean;
  label: string;
  placement: typeof WatermarkSurface.PLAYER_CHROME;
};

export type WatermarkApplyResult = {
  required: boolean;
  applied: boolean;
  mutated: boolean;
  bytes: Uint8Array;
  surface: "OUTPUT_BYTES" | "CHROME_ONLY";
  reason: WatermarkApplyReasonValue;
};
