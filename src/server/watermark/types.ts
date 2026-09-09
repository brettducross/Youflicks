/**
 * M8.4 watermark presentation types. Policy only — not Director / Timeline meaning.
 */

export const WATERMARK_LABEL = "YouFlicks";

export const WatermarkSurface = {
  RENDER_PRESENTATION: "RENDER_PRESENTATION",
  EXPORT_POST: "EXPORT_POST",
  PLAYER_CHROME: "PLAYER_CHROME",
} as const;

export type WatermarkSurfaceValue =
  (typeof WatermarkSurface)[keyof typeof WatermarkSurface];

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
};
