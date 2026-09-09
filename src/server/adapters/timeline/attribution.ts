/**
 * Execution provenance for a timeline composer adapter invocation.
 * Lives outside TimelineComposerPort so composeTimeline returns only TimelineDocument.
 */
export type TimelineExecutionAttribution = {
  providerKey: string;
  capability: string;
  modelId: string | null;
  modelVersion: string | null;
};
