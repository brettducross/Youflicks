import type { DirectorExecutionAttribution } from "@/server/adapters/director/attribution";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { DirectorInput } from "@/server/director/input";
import type { CreativePlan } from "@/server/director/schema";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { DirectorCapability } from "@/server/ports/capabilities";

/**
 * Deterministic Director adapter for tests and explicit local development.
 * Not production AI. Must never advertise production Director availability.
 * Attribution is adapter metadata — not part of AiDirectorPort.composePlan.
 */
export class LocalDeterministicDirector implements AiDirectorPort {
  readonly providerKey = "youflicks.local.director";
  readonly production = false as const;
  readonly modelId = "deterministic-v1";
  readonly modelVersion = "1.0";

  executionAttribution(): DirectorExecutionAttribution {
    return {
      providerKey: this.providerKey,
      capability: DirectorCapability.STORY_REASONING,
      modelId: this.modelId,
      modelVersion: this.modelVersion,
    };
  }

  async composePlan(input: DirectorInput): Promise<CreativePlan> {
    const intent = input.projectIntent;
    const brief = input.effectiveBrief;
    const mediaCount = input.mediaInventory.length;
    const analyzedCount = input.mediaUnderstanding.filter((item) => item.analysis).length;
    const prior = input.priorDecisions;

    const concept =
      brief.purpose ||
      intent.purpose ||
      "A personal film shaped from the owner's media and creative intent.";
    const tone = brief.mood || intent.mood || "sincere and observational";
    const pacing = brief.narrativeStyle || intent.narrativeStyle || "measured";
    const visualDirection =
      brief.visualStyle || intent.visualStyle || "grounded in the provided footage";
    const musicDirection = brief.musicStyle || intent.musicStyle || "subtle and supportive";

    const decisions = [
      ...prior,
      {
        kind: "film_concept",
        summary: concept,
      },
      {
        kind: "tone",
        summary: tone,
      },
      {
        kind: "media_selection_strategy",
        summary: `Work from ${mediaCount} media item(s) with ${analyzedCount} completed analysis document(s). Prefer meaning over coverage.`,
        detail: { mediaCount, analyzedCount },
      },
      {
        kind: "pacing",
        summary: pacing,
      },
      {
        kind: "visual_treatment",
        summary: visualDirection,
      },
      {
        kind: "music_direction",
        summary: musicDirection,
      },
    ];

    if (input.constraints.desiredDurationMs) {
      decisions.push({
        kind: "ending_direction",
        summary: `Honor the requested duration of about ${Math.round(input.constraints.desiredDurationMs / 1000)} seconds.`,
      });
    }

    return {
      schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
      concept,
      objective: brief.audience || intent.audience || undefined,
      tone,
      emotionalArc: "Build from quiet observation toward a clear emotional landing.",
      narrativeApproach: pacing,
      pacing,
      visualDirection,
      musicDirection,
      mediaStrategy: `Select and order from the ${mediaCount} available assets; do not invent footage.`,
      constraints: [
        ...(input.constraints.desiredDurationMs
          ? [`desired_duration_ms:${input.constraints.desiredDurationMs}`]
          : []),
        ...(input.constraints.explicitInstructions
          ? [`explicit_instructions:${input.constraints.explicitInstructions.slice(0, 200)}`]
          : []),
        ...(input.constraints.ignoreGeneralTaste ? ["ignore_general_taste"] : []),
      ],
      decisions,
      rationale:
        "Local deterministic Director: meaning-level creative plan derived only from project intent, taste brief, and media inventory. Not production AI.",
    };
  }
}
