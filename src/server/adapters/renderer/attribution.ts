/**
 * Execution provenance for a renderer adapter invocation.
 * Lives outside RendererPort so render returns only RenderResultDocument.
 */
export type RenderExecutionAttribution = {
  providerKey: string;
  capability: string;
  modelId: string | null;
  modelVersion: string | null;
};
