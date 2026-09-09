import type { CreativeIntentView, EffectiveCreativeBrief } from "@/server/personalization/views";
import type { StoryDocument } from "@/server/story/schema";
import type { TimelineContinuitySubset, TimelineDocument } from "@/server/timeline/schema";

/**
 * Privacy-minimized analysis hints. No storage keys, transcripts, or identity.
 */
export type TimelineAnalysisSummary = {
  sceneDescription?: string;
  objects?: string[];
  environments?: string[];
  peopleCount?: number;
  technicallyUsable?: boolean;
};

/**
 * Privacy-minimized media inventory. No storage keys, URLs, credentials, or email.
 */
export type TimelineMediaInventoryItem = {
  assetId: string;
  kind: string;
  durationMs: number | null;
  analysisStatus: string;
  analysisSummary?: TimelineAnalysisSummary;
};

/**
 * Provider-neutral timeline composer input.
 * Must not include credentials, sponsor records, raw storage keys,
 * user email/identity, render manifests, playback config, or GeneratedAsset records.
 */
export type TimelineComposerInput = {
  projectId: string;
  story: StoryDocument;
  storyStructureId: string;
  storyStructureVersion: number;
  storyFingerprint?: string;
  mediaInventory: TimelineMediaInventoryItem[];
  projectIntent: CreativeIntentView;
  effectiveBrief: EffectiveCreativeBrief;
  priorTimeline?: TimelineDocument | TimelineContinuitySubset;
};
