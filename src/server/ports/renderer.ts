/**
 * Rendering port.
 *
 * Phase 1 ships the interface only. A later adapter (local FFmpeg,
 * a cloud renderer, etc.) will produce a FinishedMovie from a Timeline.
 */
export type RenderInput = {
  projectId: string;
  timelineId: string;
  outputKey: string;
};

export type RenderOutput = {
  providerKey: string;
  storageKey: string;
  durationMs: number;
};

export interface RendererPort {
  readonly providerKey: string;
  render(input: RenderInput): Promise<RenderOutput>;
}
