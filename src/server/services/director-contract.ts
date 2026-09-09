import "server-only";

import { AppError } from "@/lib/errors";
import { TasteOrigin } from "@/server/domain/personalization";
import { DirectorCapabilityGateway } from "@/server/director/capabilities";
import type { DirectorInput, DirectorMediaItem } from "@/server/director/input";
import { assertDirectorInputPrivacy, isIgnoreGeneralTaste } from "@/server/director/privacy";
import {
  assertNoCommercialPlanFields,
  assertNoInventedConfidence,
  assertPlanRespectsConstraints,
  assertPlanSchemaVersion,
  validateCreativePlan,
} from "@/server/director/validate";
import { resolveEffectiveCreativeBrief } from "@/server/personalization/brief";
import type { TasteProfileView } from "@/server/personalization/views";
import { AnalysisService } from "@/server/services/analysis";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { TasteService } from "@/server/services/taste";
import type { CreativePlan } from "@/server/director/schema";

/**
 * Director contract foundation. Assembles minimized input, asks for
 * capabilities, and validates plans. It does not generate a film,
 * story, timeline, or credits. It never selects a vendor by name.
 */
export class DirectorContractService {
  constructor(
    private readonly projects: ProjectService,
    private readonly taste: TasteService,
    private readonly intent: IntentService,
    private readonly media: MediaService,
    private readonly analysis: AnalysisService,
    private readonly capabilities: DirectorCapabilityGateway,
  ) {}

  async assembleInput(userId: string, projectId: string): Promise<DirectorInput> {
    await this.projects.getForUser(userId, projectId);
    const [profile, intent, assets, understanding] = await Promise.all([
      this.taste.getForUser(userId, userId),
      this.intent.getForProject(userId, projectId),
      this.media.listForProject(userId, projectId),
      this.analysis.listLatestCompletedForProject(userId, projectId),
    ]);

    const ignoreGeneralTaste = isIgnoreGeneralTaste(intent.extras);
    const tasteForBrief = ignoreGeneralTaste ? null : profile;
    const effectiveBrief = resolveEffectiveCreativeBrief(tasteForBrief, intent);

    const input: DirectorInput = {
      projectId,
      tasteBrief: minimizeTaste(profile, ignoreGeneralTaste),
      projectIntent: intent,
      effectiveBrief,
      mediaInventory: assets.map(toInventoryItem),
      mediaUnderstanding: understanding.map((item) => ({
        assetId: item.assetId,
        kind: item.kind,
        analysis: item.analysis,
      })),
      constraints: {
        desiredDurationMs: intent.desiredDurationMs,
        explicitInstructions: intent.explicitInstructions,
        ignoreGeneralTaste,
      },
      availableCapabilities: this.capabilities.advertised(),
      capabilityAvailability: this.capabilities.availability(),
      priorDecisions: [],
    };

    assertDirectorInputPrivacy(input);
    return input;
  }

  requireCapability(capability: Parameters<DirectorCapabilityGateway["require"]>[0]) {
    return this.capabilities.require(capability);
  }

  validatePlan(input: DirectorInput, raw: unknown): CreativePlan {
    const plan = validateCreativePlan(raw);
    assertPlanSchemaVersion(plan);
    assertNoInventedConfidence(plan);
    assertNoCommercialPlanFields(plan);
    assertPlanRespectsConstraints(input, plan);
    return plan;
  }
}

function minimizeTaste(profile: TasteProfileView, ignoreGeneralTaste: boolean) {
  const inferred = new Map<string, number>();
  for (const signal of profile.signals) {
    if (signal.origin !== TasteOrigin.INFERRED) continue;
    inferred.set(signal.kind, (inferred.get(signal.kind) ?? 0) + 1);
  }
  return {
    explicitPreferences: ignoreGeneralTaste
      ? []
      : profile.preferences
          .filter((item) => item.source === TasteOrigin.EXPLICIT)
          .map((item) => ({ dimension: item.dimension, value: item.value })),
    inferredSignalSummary: [...inferred.entries()].map(([kind, count]) => ({ kind, count })),
    ignoreGeneralTaste,
  };
}

function toInventoryItem(asset: {
  id: string;
  kind: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  analysisStatus: string;
  originalUrl?: string;
  previewUrl?: string | null;
}): DirectorMediaItem {
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

export function assertDirectorUnimplemented(): never {
  throw AppError.providerNotConfigured("AiDirectorPort");
}
