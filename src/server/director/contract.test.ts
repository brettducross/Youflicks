import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { ProviderRegistry } from "@/server/analysis/registry";
import { PreferredThenFirstPolicy } from "@/server/analysis/selection";
import { DirectorCapabilityGateway } from "@/server/director/capabilities";
import { CREATIVE_PLAN_SCHEMA_VERSION } from "@/server/director/schema";
import { TasteDimension, TasteOrigin, TasteSignalKind } from "@/server/domain/personalization";
import { prisma } from "@/server/db";
import { AnalysisCapability, Capability } from "@/server/ports/capabilities";
import type { MediaAnalysisAdapter } from "@/server/ports/media-analysis-adapter";
import { AnalysisService } from "@/server/services/analysis";
import { DirectorContractService } from "@/server/services/director-contract";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { TasteService } from "@/server/services/taste";

function adapter(): MediaAnalysisAdapter {
  return {
    providerKey: "test.vision",
    capabilities: [AnalysisCapability.IMAGE_ANALYSIS],
    configured: true,
    enabled: true,
    health: () => ({
      providerKey: "test.vision",
      configured: true,
      enabled: true,
      available: true,
      capabilities: [AnalysisCapability.IMAGE_ANALYSIS],
    }),
    analyze: async () => ({
      providerKey: "test.vision",
      observations: { technical: { mimeType: "image/png" } },
    }),
  };
}

describe("DirectorContractService", () => {
  const ownerId = `director-owner-${Date.now()}`;
  const strangerId = `director-stranger-${Date.now()}`;
  let projectId = "";
  let dir = "";
  let media: MediaService;
  let contract: DirectorContractService;
  const taste = new TasteService();
  const projects = new ProjectService();
  const intent = new IntentService(projects, taste);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-director-"));
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Owner", email: `${ownerId}@example.com`, emailVerified: false },
        { id: strangerId, name: "Stranger", email: `${strangerId}@example.com`, emailVerified: false },
      ],
    });
    const project = await projects.create(ownerId, { title: "Director contract", logline: "Foundation." });
    projectId = project.id;
    media = new MediaService(new LocalStorageAdapter(dir), projects);
    const registry = new ProviderRegistry().register(adapter());
    const analysis = new AnalysisService(
      media,
      new PostgresJobQueue(),
      {
        async analyze() {
          return {
            analysis: { analysisSchemaVersion: "1.0", technical: { mimeType: "image/png" } },
            provenance: { providerKey: "test.vision", modelId: "fake", modelVersion: null },
          };
        },
      },
      projects,
    );
    contract = new DirectorContractService(
      projects,
      taste,
      intent,
      media,
      analysis,
      new DirectorCapabilityGateway(registry, new PreferredThenFirstPolicy()),
    );
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("assembles provider-neutral minimized input and keeps taste distinct from intent", async () => {
    await taste.replacePreferences(ownerId, ownerId, {
      preferences: [{ dimension: TasteDimension.VISUAL_STYLE, value: "Cinematic and slow" }],
    });
    await taste.recordSignal(ownerId, ownerId, {
      kind: TasteSignalKind.USER_CHANGED_EDIT,
      origin: TasteOrigin.INFERRED,
      payload: { longerCuts: true },
    });
    await intent.upsert(ownerId, projectId, {
      mood: "Funny and fast",
      visualStyle: "Handheld",
      purpose: "Birthday",
      desiredDurationMs: 300000,
      explicitInstructions: "Make this funny.",
    });

    const before = await taste.getForUser(ownerId, ownerId);
    const input = await contract.assembleInput(ownerId, projectId);
    const after = await taste.getForUser(ownerId, ownerId);

    expect(after.preferences.map((item) => item.value)).toEqual(before.preferences.map((item) => item.value));
    expect(input.effectiveBrief.visualStyle).toBe("Handheld");
    expect(input.effectiveBrief.overriddenByProject).toContain("visualStyle");
    expect(input.tasteBrief.explicitPreferences.some((item) => item.value === "Cinematic and slow")).toBe(
      true,
    );
    expect(input.tasteBrief.inferredSignalSummary.some((item) => item.kind === TasteSignalKind.USER_CHANGED_EDIT)).toBe(
      true,
    );
    expect(input.tasteBrief.inferredSignalSummary[0]).not.toHaveProperty("payload");
    expect(JSON.stringify(input)).not.toMatch(/openai|anthropic|gemini|apiKey|@example.com|storageKey/i);
    expect(input).not.toHaveProperty("sponsor");
    expect(input.mediaInventory.every((item) => !("originalUrl" in item))).toBe(true);
    expect(input.capabilityAvailability.every((item) => !("providerKey" in item))).toBe(true);
  });

  it("can ignore general taste for one project without rewriting the profile", async () => {
    await intent.upsert(ownerId, projectId, {
      visualStyle: "Party lights",
      extras: { ignoreGeneralTaste: true },
    });
    const input = await contract.assembleInput(ownerId, projectId);
    expect(input.tasteBrief.ignoreGeneralTaste).toBe(true);
    expect(input.tasteBrief.explicitPreferences).toEqual([]);
    expect(input.effectiveBrief.visualStyle).toBe("Party lights");
    const profile = await taste.getForUser(ownerId, ownerId);
    expect(profile.preferences.some((item) => item.value === "Cinematic and slow")).toBe(true);
  });

  it("rejects a stranger assembling Director input", async () => {
    await expect(contract.assembleInput(strangerId, projectId)).rejects.toBeInstanceOf(AppError);
  });

  it("rejects invalid plans and invented confidence", async () => {
    const input = await contract.assembleInput(ownerId, projectId);
    expect(() => contract.validatePlan(input, { concept: "no version" })).toThrow(AppError);
    expect(() =>
      contract.validatePlan(input, {
        schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
        concept: "Birthday",
        confidence: 0.9,
      }),
    ).toThrow(/confidence/);
    const valid = contract.validatePlan(input, {
      schemaVersion: CREATIVE_PLAN_SCHEMA_VERSION,
      concept: "Birthday recap",
      tone: "Funny",
    });
    expect(valid.schemaVersion).toBe("1.0");
  });

  it("requests capabilities without selecting vendors and fails when none exist", () => {
    expect(contract.requireCapability(AnalysisCapability.IMAGE_ANALYSIS)).toEqual({
      capability: AnalysisCapability.IMAGE_ANALYSIS,
      available: true,
    });
    try {
      contract.requireCapability(Capability.STORY_REASONING);
    } catch (error) {
      expect(error).toMatchObject({ code: "DIRECTOR_CAPABILITY_UNAVAILABLE" });
    }
  });
});
