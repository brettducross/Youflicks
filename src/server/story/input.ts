import type { CreativePlan } from "@/server/director/schema";
import type { CreativeIntentView, EffectiveCreativeBrief } from "@/server/personalization/views";
import type { StoryDocument, StoryNarrativeSubset } from "@/server/story/schema";

/**
 * Privacy-minimized media inventory. No storage keys, URLs, or identity.
 */
export type StoryMediaInventoryItem = {
  assetId: string;
  kind: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  analysisStatus: string;
};

/**
 * Provider-neutral story composer input.
 * Must not include credentials, sponsor records, raw storage keys,
 * user email/identity, or Timeline/Render artifacts.
 */
export type StoryComposerInput = {
  projectId: string;
  creativePlan: CreativePlan;
  creativePlanId: string;
  creativePlanVersion: number;
  planFingerprint?: string;
  mediaInventory: StoryMediaInventoryItem[];
  projectIntent: CreativeIntentView;
  effectiveBrief: EffectiveCreativeBrief;
  priorStory?: StoryDocument | StoryNarrativeSubset;
};
