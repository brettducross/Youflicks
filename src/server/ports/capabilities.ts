/**
 * Named capabilities YouFlicks can ask for.
 * Providers advertise one or more of these. No vendor names live here.
 * The Director requests these; the registry selects an adapter.
 */
export const AnalysisCapability = {
  VIDEO_ANALYSIS: "VIDEO_ANALYSIS",
  IMAGE_ANALYSIS: "IMAGE_ANALYSIS",
  AUDIO_ANALYSIS: "AUDIO_ANALYSIS",
  TRANSCRIPTION: "TRANSCRIPTION",
  VISION: "VISION",
  EMBEDDINGS: "EMBEDDINGS",
} as const;

export type AnalysisCapabilityValue =
  (typeof AnalysisCapability)[keyof typeof AnalysisCapability];

export const ALL_ANALYSIS_CAPABILITIES = Object.values(AnalysisCapability);

/** Capabilities the Director may request. Adapters advertise only what they support. */
export const DirectorCapability = {
  STORY_REASONING: "STORY_REASONING",
  STORYBOARDING: "STORYBOARDING",
  MUSIC_SELECTION: "MUSIC_SELECTION",
  VOICE_GENERATION: "VOICE_GENERATION",
  TIMELINE_PLANNING: "TIMELINE_PLANNING",
  RENDERING: "RENDERING",
} as const;

export type DirectorCapabilityValue =
  (typeof DirectorCapability)[keyof typeof DirectorCapability];

/** Capabilities the story composer may use. Separate from AiDirectorPort. */
export const StoryCapability = {
  STORY_COMPOSITION: "STORY_COMPOSITION",
} as const;

export type StoryCapabilityValue = (typeof StoryCapability)[keyof typeof StoryCapability];

export const Capability = {
  ...AnalysisCapability,
  ...DirectorCapability,
  ...StoryCapability,
} as const;

export type CapabilityValue = (typeof Capability)[keyof typeof Capability];

export const ALL_CAPABILITIES = Object.values(Capability);
