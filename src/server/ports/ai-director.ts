/**
 * AI Director port.
 *
 * Phase 1 ships the interface only. Do not add a vendor-specific
 * implementation until a Director adapter is intentionally selected.
 */
export type ProposeStoryInput = {
  projectId: string;
  brief: string;
  assetSummaries: Array<{
    assetId: string;
    kind: string;
    notes?: string;
  }>;
};

export type StoryDraft = {
  providerKey: string;
  payload: unknown;
};

export interface AiDirectorPort {
  readonly providerKey: string;
  proposeStory(input: ProposeStoryInput): Promise<StoryDraft>;
}
