import type { GeneratedAssetKind } from "@/server/assets/kinds";
import type { CreativeIntentView, EffectiveCreativeBrief } from "@/server/personalization/views";

/**
 * Privacy-minimized creative hints. No taste dump, storage keys, or identity.
 */
export type AssetCreativeHints = {
  scenePurpose?: string;
  sceneMood?: string;
  rolePurpose?: string;
  briefMood?: string;
  briefVisualStyle?: string;
  briefMusicStyle?: string;
  voiceOverOutline?: string;
};

/**
 * Optional prior GeneratedAsset metadata for regenerate continuity — not a chat.
 */
export type PriorGeneratedAssetRef = {
  generatedAssetId: string;
  kind: GeneratedAssetKind;
  role: string;
  mimeType: string;
  rationale?: string;
};

/**
 * Provider-neutral asset generator input.
 * Must not include credentials, sponsor records, raw storage keys,
 * user email/identity, render manifests, playback config, or vendor host JSON.
 */
export type AssetGeneratorInput = {
  projectId: string;
  kind: GeneratedAssetKind;
  role: string;
  storySceneId?: string;
  reason?: string;
  creativeHints: AssetCreativeHints;
  projectIntent: CreativeIntentView;
  effectiveBrief: EffectiveCreativeBrief;
  sourceMediaAssetId?: string;
  timelineId: string;
  timelineVersion: number;
  storyStructureId?: string;
  storyStructureVersion?: number;
  briefFingerprint?: string;
  priorAsset?: PriorGeneratedAssetRef;
};
