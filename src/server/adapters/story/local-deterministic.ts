import type { StoryExecutionAttribution } from "@/server/adapters/story/attribution";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import { StoryCapability } from "@/server/ports/capabilities";
import type { StoryComposerInput } from "@/server/story/input";
import {
  STORY_DOCUMENT_SCHEMA_VERSION,
  type StoryDocument,
} from "@/server/story/schema";

/**
 * Deterministic story composer for tests and explicit local development.
 * Not production AI. Must never advertise production story availability.
 * Attribution is adapter metadata — not part of StoryComposerPort.composeStory.
 */
export class LocalDeterministicStoryComposer implements StoryComposerPort {
  readonly providerKey = "youflicks.local.story";
  readonly production = false as const;
  readonly modelId = "deterministic-story-v1";
  readonly modelVersion = "1.0";

  executionAttribution(): StoryExecutionAttribution {
    return {
      providerKey: this.providerKey,
      capability: StoryCapability.STORY_COMPOSITION,
      modelId: this.modelId,
      modelVersion: this.modelVersion,
    };
  }

  async composeStory(input: StoryComposerInput): Promise<StoryDocument> {
    const plan = input.creativePlan;
    const brief = input.effectiveBrief;
    const intent = input.projectIntent;
    const prior = input.priorStory;
    const mediaCount = input.mediaInventory.length;
    const photoCount = input.mediaInventory.filter((item) => item.kind === "PHOTO").length;
    const videoCount = input.mediaInventory.filter((item) => item.kind === "VIDEO").length;

    const title =
      prior?.title ||
      plan.concept ||
      brief.purpose ||
      intent.purpose ||
      "A personal story";
    const logline =
      prior?.logline ||
      plan.objective ||
      brief.purpose ||
      "A narrative shaped from the owner's footage and direction.";
    const tone = plan.tone || brief.mood || intent.mood || "sincere";
    const targetDurationMs = brief.desiredDurationMs ?? intent.desiredDurationMs ?? undefined;

    const spine = prior?.spine ?? {
      opening: plan.emotionalArc
        ? `Open in the feeling of the plan: ${plan.emotionalArc}`
        : `Open with the people and places already in the footage, in a ${tone} register.`,
      development:
        plan.narrativeApproach ||
        plan.mediaStrategy ||
        `Develop the story from ${mediaCount} media item(s), preferring meaning over coverage.`,
      resolution:
        plan.pacing ||
        "Land on a clear emotional close that honors the source direction.",
    };

    const acts = prior?.acts?.length
      ? prior.acts.map((act, index) => ({
          ...act,
          purpose: act.purpose,
          order: index,
        }))
      : defaultActs({
          tone,
          mediaCount,
          photoCount,
          videoCount,
          targetDurationMs,
          voiceDirection: plan.voiceDirection,
        });

    return {
      schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
      title,
      logline,
      spine,
      acts,
      source: {
        creativePlanId: input.creativePlanId,
        creativePlanVersion: input.creativePlanVersion,
        planFingerprint: input.planFingerprint,
      },
      rationale:
        "Local deterministic story composer: narrative structure derived from a READY CreativePlan, project brief, and privacy-minimized media inventory. Not production AI.",
    };
  }
}

function defaultActs(options: {
  tone: string;
  mediaCount: number;
  photoCount: number;
  videoCount: number;
  targetDurationMs?: number;
  voiceDirection?: string;
}): StoryDocument["acts"] {
  const perActTarget =
    options.targetDurationMs && options.targetDurationMs > 0
      ? Math.max(1, Math.round(options.targetDurationMs / 3))
      : undefined;

  return [
    {
      id: "act-opening",
      order: 0,
      title: "Opening",
      purpose: `Establish the world and tone (${options.tone}).`,
      targetDurationMs: perActTarget,
      scenes: [
        {
          id: "scene-arrive",
          order: 0,
          title: "Arrival",
          purpose: "Introduce the people and place already present in the footage.",
          dramaticFunction: "exposition",
          mood: options.tone,
          pacing: "measured",
          mediaRoles: [
            {
              role: "establishing_visual",
              purpose: "Show the setting without inventing footage.",
            },
            {
              role: "intimate_portrait",
              purpose: "Hold on a face or gesture that belongs to this film.",
            },
          ],
          voiceOverOutline: options.voiceDirection
            ? `Voice stays ${options.voiceDirection}.`
            : "Optional quiet voice-over that names the occasion, not the cut.",
        },
      ],
    },
    {
      id: "act-development",
      order: 1,
      title: "Development",
      purpose: `Deepen the story using the ${options.mediaCount} available item(s) (${options.photoCount} stills, ${options.videoCount} clips).`,
      targetDurationMs: perActTarget,
      scenes: [
        {
          id: "scene-gather",
          order: 0,
          title: "Gathering",
          purpose: "Collect the middle of the experience — play, work, or waiting.",
          dramaticFunction: "development",
          mood: options.tone,
          pacing: "unhurried",
          mediaRoles: [
            {
              role: "observational_coverage",
              purpose: "Prefer lived moments over montage-for-its-own-sake.",
            },
          ],
          dialogueOutline: "Keep spoken lines as outline only — not a transcript or cut list.",
        },
        {
          id: "scene-turn",
          order: 1,
          title: "Turn",
          purpose: "A small shift that makes the ending feel earned.",
          dramaticFunction: "turning",
          mediaRoles: [
            {
              role: "detail_hold",
              purpose: "A still or short hold that changes the emotional temperature.",
            },
          ],
        },
      ],
    },
    {
      id: "act-resolution",
      order: 2,
      title: "Resolution",
      purpose: "Close the emotional arc without editorial timing.",
      targetDurationMs: perActTarget,
      scenes: [
        {
          id: "scene-land",
          order: 0,
          title: "Landing",
          purpose: "Resolve the spine with a clear last image and feeling.",
          dramaticFunction: "resolution",
          mood: options.tone,
          pacing: "settled",
          mediaRoles: [
            {
              role: "closing_image",
              purpose: "A last visual the film can rest on.",
            },
          ],
          voiceOverOutline: "If used, a short closing line — not a credit or render instruction.",
        },
      ],
    },
  ];
}
