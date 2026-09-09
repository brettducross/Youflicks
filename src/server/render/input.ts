import type { RenderManifest, RenderOutputProfile } from "@/server/render/schema";

/**
 * Provider-neutral renderer input.
 * Must not include credentials, sponsor records, user email/identity,
 * vendor host JSON, or playback device config.
 */
export type RenderComposerInput = {
  projectId: string;
  timelineId: string;
  timelineVersion: number;
  manifest: RenderManifest;
  outputProfile: RenderOutputProfile;
  /** Service-assigned opaque destination key. Final key is preferred. */
  destinationKeyHint: string;
};
