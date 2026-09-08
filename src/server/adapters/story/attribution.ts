/**
 * Execution provenance for a story composer adapter invocation.
 * Lives outside StoryComposerPort so composeStory returns only StoryDocument.
 */
export type StoryExecutionAttribution = {
  providerKey: string;
  capability: string;
  modelId: string | null;
  modelVersion: string | null;
};
