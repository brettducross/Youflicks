import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import type { CreativePlan } from "@/server/director/schema";
import { creativePlanSchema } from "@/server/director/schema";
import { resolveEffectiveCreativeBrief } from "@/server/personalization/brief";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { TasteService } from "@/server/services/taste";
import { fingerprintCreativePlan } from "@/server/story/fingerprint";
import type { StoryComposerInput, StoryMediaInventoryItem } from "@/server/story/input";
import { assertStoryComposerInputPrivacy } from "@/server/story/privacy";
import type { StoryDocument, StoryNarrativeSubset } from "@/server/story/schema";
import { storyDocumentSchema } from "@/server/story/schema";
import { validateStoryDocument } from "@/server/story/validate";

export type ReadyCreativePlanSource = {
  id: string;
  version: number;
  plan: CreativePlan;
  planFingerprint: string;
};

/**
 * Assembles StoryComposerInput and validates StoryDocument.
 * Does not compose, persist, or select a vendor.
 */
export class StoryContractService {
  constructor(
    private readonly projects: ProjectService,
    private readonly taste: TasteService,
    private readonly intent: IntentService,
    private readonly media: MediaService,
  ) {}

  async assembleInput(
    userId: string,
    projectId: string,
    source: ReadyCreativePlanSource,
    priorStory?: StoryDocument | StoryNarrativeSubset,
  ): Promise<StoryComposerInput> {
    await this.projects.getForUser(userId, projectId);
    const [profile, intent, assets] = await Promise.all([
      this.taste.getForUser(userId, userId),
      this.intent.getForProject(userId, projectId),
      this.media.listForProject(userId, projectId),
    ]);

    const effectiveBrief = resolveEffectiveCreativeBrief(profile, intent);

    const input: StoryComposerInput = {
      projectId,
      creativePlan: source.plan,
      creativePlanId: source.id,
      creativePlanVersion: source.version,
      planFingerprint: source.planFingerprint,
      mediaInventory: assets.map(toInventoryItem),
      projectIntent: intent,
      effectiveBrief,
      priorStory,
    };

    assertStoryComposerInputPrivacy(input);
    return input;
  }

  validateDocument(
    source: ReadyCreativePlanSource,
    raw: unknown,
  ): StoryDocument {
    const document = validateStoryDocument(raw);
    if (
      document.source.creativePlanId !== source.id ||
      document.source.creativePlanVersion !== source.version
    ) {
      throw AppError.storyDocumentInvalid(
        "Story document source must match the READY CreativePlan used for composition.",
        {
          expected: { creativePlanId: source.id, creativePlanVersion: source.version },
          received: document.source,
        },
      );
    }
    return {
      ...document,
      source: {
        creativePlanId: source.id,
        creativePlanVersion: source.version,
        planFingerprint: source.planFingerprint,
      },
    };
  }
}

export function parseCreativePlanJson(value: Prisma.JsonValue): CreativePlan {
  const parsed = creativePlanSchema.safeParse(value);
  if (!parsed.success) {
    throw AppError.storyInputInvalid("Stored CreativePlan is not a valid owned plan document.");
  }
  return parsed.data;
}

export function fingerprintStoredPlan(value: Prisma.JsonValue): string {
  return fingerprintCreativePlan(parseCreativePlanJson(value));
}

export function extractPriorStory(
  payload: Prisma.JsonValue | null | undefined,
): StoryDocument | StoryNarrativeSubset | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const full = storyDocumentSchema.safeParse(payload);
  if (full.success) {
    return full.data;
  }
  const record = payload as Record<string, unknown>;
  const spine = record.spine;
  const acts = record.acts;
  if (
    spine &&
    typeof spine === "object" &&
    !Array.isArray(spine) &&
    Array.isArray(acts) &&
    acts.length > 0
  ) {
    return {
      title: typeof record.title === "string" ? record.title : undefined,
      logline: typeof record.logline === "string" ? record.logline : undefined,
      spine: spine as StoryNarrativeSubset["spine"],
      acts: acts as StoryNarrativeSubset["acts"],
    };
  }
  return undefined;
}

function toInventoryItem(asset: {
  id: string;
  kind: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  analysisStatus: string;
}): StoryMediaInventoryItem {
  return {
    assetId: asset.id,
    kind: asset.kind,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    analysisStatus: asset.analysisStatus,
  };
}
