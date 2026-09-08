/**
 * Execution provenance for a Director adapter invocation.
 * Lives outside AiDirectorPort so the frozen Phase 2E contract stays
 * provider-neutral: composePlan returns only CreativePlan.
 */
export type DirectorExecutionAttribution = {
  providerKey: string;
  capability: string;
  modelId: string | null;
  modelVersion: string | null;
};
