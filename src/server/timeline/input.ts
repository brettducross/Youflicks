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
 * Privacy-minimized READY GeneratedAsset inventory for explicit Rebuild cut (D8).
 * Ids and role/kind only — no storage keys, vendor URLs, or host JSON.
 */
export type TimelineGeneratedInventoryItem = {
  generatedAssetId: string;
  kind: string;
  role: string;
  durationMs: number | null;
  storySceneId?: string;
};

/**
 * Provider-neutral timeline composer input.
 * Must not include credentials, sponsor records, raw storage keys,
 * user email/identity, render manifests, playback config, or vendor host JSON.
 * generatedInventory is YouFlicks ids only (D8) — not GeneratedAsset documents.
 */
export type TimelineComposerInput = {
  projectId: string;
  story: StoryDocument;
  storyStructureId: string;
  storyStructureVersion: number;
  storyFingerprint?: string;
  mediaInventory: TimelineMediaInventoryItem[];
  generatedInventory?: TimelineGeneratedInventoryItem[];
  projectIntent: CreativeIntentView;
  effectiveBrief: EffectiveCreativeBrief;
  priorTimeline?: TimelineDocument | TimelineContinuitySubset;
};
