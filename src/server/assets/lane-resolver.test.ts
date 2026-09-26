import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { HttpAssetGeneratorAdapter } from "@/server/adapters/assets/http-asset";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import type { AssetGeneratorInput } from "@/server/assets/input";
import {
  LaneResolverError,
  resolveAssetGeneratorLanes,
  resolvedAssetGeneratorForLanes,
  type EnhancementProcessorHook,
  type ResolvedLaneGenerator,
} from "@/server/assets/lane-resolver";
import { describeAssetAvailability } from "@/server/assets/provider-config";
import type { GeneratedAssetDocument } from "@/server/assets/schema";
import { prisma } from "@/server/db";
import { YF_ASSET_GATEWAY_BACKENDS } from "@/server/gateways/yf-asset/config";
import { AssetCapability, ALL_ASSET_CAPABILITIES } from "@/server/ports/capabilities";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import { actualBilledSecondsFromDurationMs, estimateLaneCharge } from "@/server/sg/lane-rate";
import { decide, SG_POLICY_CONTRACT_REASON } from "@/server/sg/policy";
import { PrismaShotFulfillment } from "@/server/sg/shot-fulfillment";
import { ProjectService } from "@/server/services/projects";
import {
  isTbdProviderKey,
  loadSgLaneRegistry,
  parseLaneRegistry,
  type SgLaneRegistry,
} from "@/server/sg/lane-registry";

/**
 * Compile-time pin: AssetGeneratorPort is still only generate(AssetGeneratorInput).
 * Adding laneId, model, or any other port member fails this file's typecheck.
 */
type Expect<T extends true> = T;
type InputKeys = keyof AssetGeneratorInput;
type ExpectedInputKeys =
  | "projectId"
  | "kind"
  | "role"
  | "storySceneId"
  | "reason"
  | "creativeHints"
  | "projectIntent"
  | "effectiveBrief"
  | "sourceMediaAssetId"
  | "timelineId"
  | "timelineVersion"
  | "storyStructureId"
  | "storyStructureVersion"
  | "briefFingerprint"
  | "priorAsset";
type PortKeys = keyof AssetGeneratorPort;
type PortUnchanged = Expect<
  [PortKeys] extends ["generate"] ? (["generate"] extends [PortKeys] ? true : false) : false
>;
type GenerateParam = Parameters<AssetGeneratorPort["generate"]>[0];
type GenerateReturn = ReturnType<AssetGeneratorPort["generate"]>;
type GenerateSignatureUnchanged = Expect<
  [GenerateParam] extends [AssetGeneratorInput]
    ? [AssetGeneratorInput] extends [GenerateParam]
      ? [GenerateReturn] extends [Promise<GeneratedAssetDocument>]
        ? [Promise<GeneratedAssetDocument>] extends [GenerateReturn]
          ? true
          : false
        : false
      : false
    : false
>;
type InputUnchanged = Expect<
  [InputKeys] extends [ExpectedInputKeys]
    ? [ExpectedInputKeys] extends [InputKeys]
      ? true
      : false
    : false
>;
type InputHasNoLaneOrModel = Expect<
  "laneId" extends keyof AssetGeneratorInput
    ? false
    : "model" extends keyof AssetGeneratorInput
      ? false
      : true
>;

const SHARED_MODEL_ID = "shared-swap-model";
const PROVIDER_KEY_BY_BACKEND = {
  fal: "fal:fal-ai/ltx-video",
  replicate: "replicate:shared-swap-model",
  http: "http.asset",
  mock: "mock.asset",
} as const satisfies Record<(typeof YF_ASSET_GATEWAY_BACKENDS)[number], string>;

function notQualified() {
  return { status: "NOT_QUALIFIED" as const };
}

function lane(overrides: Record<string, unknown> = {}) {
  return {
    laneId: "lane-a",
    laneClass: "standard",
    providerKey: "open:model",
    modelId: "open-model",
    gateway: { baseUrlEnv: "SG_LANE_A_BASE_URL", apiKeyEnv: "SG_LANE_A_API_KEY" },
    resolutionTier: "720p",
    usdPerSecond: 0.1,
    rateRef: "ESTIMATE fixture; not a price",
    clipDurationS: 5,
    supportedDurationsS: [5],
    billingGranularityS: 1,
    failuresBillable: true,
    audioMode: "OFF",
    enabled: true,
    designation: "NONE",
    gates: {
      HERO: notQualified(),
      IDENTITY: notQualified(),
      NON_IDENTITY: notQualified(),
    },
    ...overrides,
  };
}

function processor(enabled: boolean) {
  return {
    laneId: "yf.kenburns.v1",
    laneClass: "processor",
    providerKey: "yf.kenburns.v1",
    modelId: "yf.kenburns.v1",
    resolutionTier: "output-profile",
    usdPerSecond: 0,
    rateRef: "ESTIMATE fixture; not a price",
    duration: "slot-derived",
    audioMode: "OFF",
    enabled,
    generative: false,
  };
}

function document(lanes: unknown[], processors: unknown[] = []): SgLaneRegistry {
  return parseLaneRegistry({
    registryVersion: "sg-lanes-v1",
    thresholdsVersion: "po-sg-2026-09-25",
    regenCeilings: { "draft-cost": 3, "draft-quality": 2, standard: 2, premium: 2 },
    classOrder: ["draft-cost", "draft-quality", "standard", "premium"],
    lanes,
    processors,
  });
}

function baseInput(overrides: Partial<AssetGeneratorInput> = {}): AssetGeneratorInput {
  return {
    projectId: "proj_lanes",
    kind: "VIDEO_CLIP",
    role: "broll_sunrise",
    storySceneId: "scene-arrive",
    creativeHints: { scenePurpose: "Hold on a face." },
    projectIntent: {
      projectId: "proj_lanes",
      purpose: "Birthday weekend",
      audience: "family",
      mood: "joyful",
      desiredDurationMs: 120_000,
      narrativeStyle: "documentary",
      visualStyle: "handheld warmth",
      musicStyle: "acoustic",
      explicitInstructions: "Keep it short",
      extras: null,
    },
    effectiveBrief: {
      purpose: "Birthday weekend",
      audience: "family",
      mood: "joyful",
      narrativeStyle: "documentary",
      visualStyle: "handheld warmth",
      musicStyle: "acoustic",
      desiredDurationMs: 120_000,
      pacing: null,
      whatMatters: [],
      explicitInstructions: "Keep it short",
      overriddenByProject: [],
    },
    timelineId: "tl_lanes",
    timelineVersion: 1,
    storyStructureId: "story_lanes",
    storyStructureVersion: 2,
    ...overrides,
  };
}

function okGenerateResponse() {
  return new Response(
    JSON.stringify({
      mimeType: "video/mp4",
      bytesBase64: Buffer.from("lane-mp4").toString("base64"),
      durationMs: 5000,
      width: 1280,
      height: 720,
      jobId: "yf_lane_contract",
    }),
    { status: 200 },
  );
}

describe("resolveAssetGeneratorLanes", () => {
  let dir = "";
  let storage: LocalStorageAdapter;

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function useStorage() {
    if (!dir) {
      dir = await mkdtemp(path.join(tmpdir(), "youflicks-lane-resolver-"));
      storage = new LocalStorageAdapter(dir);
    }
    return storage;
  }

  it("pins AssetGeneratorPort and AssetGeneratorInput at compile time", () => {
    const portUnchanged: PortUnchanged = true;
    const generateSignatureUnchanged: GenerateSignatureUnchanged = true;
    const inputUnchanged: InputUnchanged = true;
    const inputHasNoLaneOrModel: InputHasNoLaneOrModel = true;
    expect(portUnchanged).toBe(true);
    expect(generateSignatureUnchanged).toBe(true);
    expect(inputUnchanged).toBe(true);
    expect(inputHasNoLaneOrModel).toBe(true);
  });

  it("builds a distinct HttpAssetGeneratorAdapter per lane, with that lane's provenance", async () => {
    const store = await useStorage();
    const registry = document([
      lane({
        laneId: "lane-a",
        providerKey: "replicate:open-video",
        modelId: "open-video",
        gateway: { baseUrlEnv: "SG_LANE_A_BASE_URL", apiKeyEnv: "SG_LANE_A_API_KEY" },
      }),
      lane({
        laneId: "lane-b",
        laneClass: "premium",
        providerKey: "fal:fal-ai/ltx-video",
        modelId: "fal-ai/ltx-video",
        gateway: { baseUrlEnv: "SG_LANE_B_BASE_URL", apiKeyEnv: "SG_LANE_B_API_KEY" },
        usdPerSecond: 0.2,
      }),
    ]);
    const seen: Array<{ url: string; authorization: string | null; model: string; laneId?: unknown }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { model?: string; laneId?: unknown };
      seen.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        model: body.model ?? "",
        laneId: body.laneId,
      });
      return okGenerateResponse();
    });
    const resolver = resolveAssetGeneratorLanes(store, registry, {
      env: {
        SG_LANE_A_BASE_URL: "http://127.0.0.1:4401",
        SG_LANE_A_API_KEY: "key-a",
        SG_LANE_B_BASE_URL: "http://127.0.0.1:4402",
        SG_LANE_B_API_KEY: "key-b",
        ASSET_HTTP_PROVIDER_KEY: "http.asset",
        ASSET_HTTP_MODEL: "request-override-model",
        ASSET_HTTP_CAPABILITIES: "IMAGE_GENERATION,VOICE_SYNTHESIS,VIDEO_GENERATION",
        YF_GATEWAY_LANE_ID: "lane-b",
        YF_GATEWAY_PROVIDER_KEY: "http.asset",
      },
      fetchImpl,
    });

    const laneA = resolver.forLane("lane-a");
    const laneB = resolver.forLane("lane-b");
    expect(laneA.adapter).toBeInstanceOf(HttpAssetGeneratorAdapter);
    expect(laneB.adapter).toBeInstanceOf(HttpAssetGeneratorAdapter);
    expect(laneA.adapter).not.toBe(laneB.adapter);
    expect(resolver.forLane("lane-a").adapter).toBe(laneA.adapter);

    expect(laneA.attribution(AssetCapability.VIDEO_GENERATION)).toEqual({
      providerKey: "replicate:open-video",
      capability: AssetCapability.VIDEO_GENERATION,
      modelId: "open-video",
      modelVersion: null,
    });
    expect(laneB.attribution(AssetCapability.VIDEO_GENERATION).providerKey).toBe("fal:fal-ai/ltx-video");
    expect(laneB.attribution(AssetCapability.VIDEO_GENERATION).modelId).toBe("fal-ai/ltx-video");
    expect(
      (laneA.adapter as HttpAssetGeneratorAdapter).executionAttribution(AssetCapability.VIDEO_GENERATION),
    ).toEqual(laneA.attribution(AssetCapability.VIDEO_GENERATION));

    await laneA.adapter.generate(baseInput());
    await laneB.adapter.generate(baseInput({ role: "broll_other" }));
    expect(seen.map((call) => call.url)).toEqual([
      "http://127.0.0.1:4401/v1/generate",
      "http://127.0.0.1:4402/v1/generate",
    ]);
    expect(seen.map((call) => call.authorization)).toEqual(["Bearer key-a", "Bearer key-b"]);
    expect(seen.map((call) => call.model)).toEqual(["open-video", "fal-ai/ltx-video"]);
    expect(seen.every((call) => call.laneId === undefined)).toBe(true);
    expect(seen.every((call) => call.model !== "request-override-model")).toBe(true);
  });

  it("refuses disabled lanes, TBD lanes, unknown lanes, and lanes with no gateway env", async () => {
    const store = await useStorage();
    const registry = document([
      lane({
        laneId: "live-lane",
        providerKey: "open:live",
        modelId: "live-model",
        gateway: { baseUrlEnv: "SG_LIVE_BASE_URL", apiKeyEnv: "SG_LIVE_API_KEY" },
      }),
      lane({
        laneId: "paused-lane",
        providerKey: "open:paused",
        modelId: "paused-model",
        enabled: false,
        gateway: { baseUrlEnv: "SG_PAUSED_BASE_URL", apiKeyEnv: "SG_PAUSED_API_KEY" },
      }),
      lane({
        laneId: "boreal-720",
        providerKey: "TBD:boreal-720",
        modelId: "TBD:boreal-720",
        enabled: false,
        gateway: { baseUrlEnv: "SG_LANE_BOREAL_720_BASE_URL", apiKeyEnv: "SG_LANE_BOREAL_720_API_KEY" },
      }),
    ]);
    const env = {
      SG_LIVE_BASE_URL: "http://127.0.0.1:4403",
      SG_LIVE_API_KEY: "live-key",
      SG_PAUSED_BASE_URL: "http://127.0.0.1:4404",
      SG_PAUSED_API_KEY: "paused-key",
      SG_LANE_BOREAL_720_BASE_URL: "http://127.0.0.1:4405",
      SG_LANE_BOREAL_720_API_KEY: "boreal-key",
    };
    const resolver = resolveAssetGeneratorLanes(store, registry, { env });

    expect(resolver.forLane("live-lane").attribution(AssetCapability.VIDEO_GENERATION).providerKey).toBe(
      "open:live",
    );
    expect(() => resolver.forLane("paused-lane")).toThrow(LaneResolverError);
    expect(() => resolver.forLane("paused-lane")).toThrow(/disabled/);
    const zeroRate = document([lane({ laneId: "zero-rate" })]);
    zeroRate.lanes[0]!.usdPerSecond = 0;
    expect(() => resolveAssetGeneratorLanes(store, zeroRate, { env }).forLane("zero-rate")).toThrow(
      /usdPerSecond/,
    );
    expect(() => resolver.forLane("boreal-720")).toThrow(/TBD/);
    expect(() => resolver.forLane("yf.kenburns.v1")).toThrow(/not a generative registry lane/);
    expect(() => resolver.forLane("missing")).toThrow(LaneResolverError);

    const bare = resolveAssetGeneratorLanes(store, registry, {
      env: { SG_LIVE_BASE_URL: "  ", SG_LIVE_API_KEY: "live-key" },
    });
    expect(() => bare.forLane("live-lane")).toThrow(/SG_LIVE_BASE_URL/);
    const noKey = resolveAssetGeneratorLanes(store, registry, {
      env: { SG_LIVE_BASE_URL: "http://127.0.0.1:4403" },
    });
    expect(() => noKey.forLane("live-lane")).toThrow(/SG_LIVE_API_KEY/);
  });

  it("maps legacy ASSET_HTTP_* env names to the LEGACY_R1 lane and ignores model overrides", async () => {
    const store = await useStorage();
    const registry = loadSgLaneRegistry();
    const legacy = registry.lanes.find((item) => item.designation === "LEGACY_R1");
    expect(legacy?.gateway).toEqual({
      baseUrlEnv: "ASSET_HTTP_BASE_URL",
      apiKeyEnv: "ASSET_HTTP_API_KEY",
    });
    expect(legacy?.enabled).toBe(true);
    expect(legacy && isTbdProviderKey(legacy.providerKey)).toBe(false);

    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:43148/v1/generate");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer legacy-gateway-key");
      const body = JSON.parse(String(init?.body)) as { model?: string; laneId?: unknown };
      expect(body.model).toBe(legacy?.modelId);
      expect(body.model).not.toBe("request-override-model");
      expect(body.laneId).toBeUndefined();
      return okGenerateResponse();
    });
    const resolver = resolveAssetGeneratorLanes(store, registry, {
      env: {
        ASSET_HTTP_BASE_URL: "http://127.0.0.1:43148",
        ASSET_HTTP_API_KEY: "legacy-gateway-key",
        ASSET_HTTP_PROVIDER_KEY: "http.asset",
        ASSET_HTTP_MODEL: "request-override-model",
        ASSET_HTTP_CAPABILITIES: "IMAGE_GENERATION,VOICE_SYNTHESIS,VIDEO_GENERATION",
        YF_GATEWAY_LANE_ID: "boreal-720",
        YF_GATEWAY_PROVIDER_KEY: "http.asset",
        SG_LANE_BOREAL_720_BASE_URL: "http://127.0.0.1:4409",
        SG_LANE_BOREAL_720_API_KEY: "boreal-key",
      },
      fetchImpl,
    });

    for (const item of registry.lanes) {
      if (!item.enabled || isTbdProviderKey(item.providerKey)) {
        expect(() => resolver.forLane(item.laneId)).toThrow(LaneResolverError);
      }
    }
    expect(registry.processors.map((item) => item.laneId)).toContain("yf.kenburns.v1");
    expect(resolver.processors(AssetCapability.MEDIA_ENHANCEMENT)).toEqual([]);
    expect(() => resolver.forLane("yf.kenburns.v1")).toThrow(LaneResolverError);

    const resolved = resolver.forLane(legacy!.laneId);
    const attribution = resolved.attribution(AssetCapability.VIDEO_GENERATION);
    expect(attribution.providerKey).toBe(legacy!.providerKey);
    expect(attribution.providerKey).not.toBe("http.asset");
    expect(attribution.modelId).toBe(legacy!.modelId);
    expect(attribution.modelId).not.toBe("request-override-model");
    await resolved.adapter.generate(baseInput());
    expect(fetchImpl).toHaveBeenCalledOnce();

    const availability = describeAssetAvailability(
      resolvedAssetGeneratorForLanes([resolved], resolver.processors(AssetCapability.MEDIA_ENHANCEMENT)),
    );
    expect(availability.productionAvailable).toBe(true);
    expect(availability.localDevAvailable).toBe(false);
    expect(availability.capabilities.VIDEO_GENERATION).toEqual({
      productionAvailable: true,
      localDevAvailable: false,
      canGenerate: true,
    });
    for (const capability of ALL_ASSET_CAPABILITIES) {
      if (capability === AssetCapability.VIDEO_GENERATION) continue;
      expect(availability.capabilities[capability]).toEqual({
        productionAvailable: false,
        localDevAvailable: false,
        canGenerate: false,
      });
    }
    await expect(
      resolved.adapter.generate(baseInput({ kind: "ENHANCEMENT", role: "still_move" })),
    ).rejects.toMatchObject({ code: "ASSET_CAPABILITY_UNAVAILABLE" });
  });

  it("keeps describeAssetAvailability honest when several lanes share one process", async () => {
    const store = await useStorage();
    const registry = document(
      [
        lane({
          laneId: "lane-a",
          gateway: { baseUrlEnv: "SG_LANE_A_BASE_URL", apiKeyEnv: "SG_LANE_A_API_KEY" },
        }),
        lane({
          laneId: "lane-b",
          providerKey: "open:other",
          modelId: "other-model",
          gateway: { baseUrlEnv: "SG_LANE_B_BASE_URL", apiKeyEnv: "SG_LANE_B_API_KEY" },
        }),
      ],
      [processor(true)],
    );
    const resolver = resolveAssetGeneratorLanes(store, registry, {
      env: {
        SG_LANE_A_BASE_URL: "http://127.0.0.1:4411",
        SG_LANE_A_API_KEY: "key-a",
        SG_LANE_B_BASE_URL: "http://127.0.0.1:4412",
        SG_LANE_B_API_KEY: "key-b",
        ASSET_ALLOW_LOCAL: "true",
        ASSET_HTTP_CAPABILITIES: "IMAGE_GENERATION,VOICE_SYNTHESIS,MUSIC_GENERATION,SFX_GENERATION,VIDEO_GENERATION,MEDIA_ENHANCEMENT",
      },
    });
    const hooks = resolver.processors(AssetCapability.MEDIA_ENHANCEMENT);
    expect(hooks).toEqual([
      {
        laneId: "yf.kenburns.v1",
        providerKey: "yf.kenburns.v1",
        modelId: "yf.kenburns.v1",
        capability: AssetCapability.MEDIA_ENHANCEMENT,
        adapter: null,
      },
    ]);
    expect(resolver.processors(AssetCapability.VIDEO_GENERATION)).toEqual([]);
    expect(() => resolver.forLane("yf.kenburns.v1")).toThrow(LaneResolverError);

    const lanes = [resolver.forLane("lane-a"), resolver.forLane("lane-b")];
    const availability = describeAssetAvailability(resolvedAssetGeneratorForLanes(lanes, hooks));
    expect(availability.capabilities.VIDEO_GENERATION.canGenerate).toBe(true);
    expect(availability.capabilities.MEDIA_ENHANCEMENT.canGenerate).toBe(false);
    expect(availability.localDevAvailable).toBe(false);
    expect(describeAssetAvailability(resolvedAssetGeneratorForLanes([], hooks)).canGenerate).toBe(false);

    const installed: EnhancementProcessorHook = {
      ...hooks[0]!,
      adapter: {
        async generate(): Promise<GeneratedAssetDocument> {
          throw new Error("PR-9 owns the processor.");
        },
      },
    };
    const withProcessor = describeAssetAvailability(resolvedAssetGeneratorForLanes([], [installed]));
    expect(withProcessor.capabilities.MEDIA_ENHANCEMENT).toEqual({
      productionAvailable: true,
      localDevAvailable: false,
      canGenerate: true,
    });
    expect(withProcessor.capabilities.VIDEO_GENERATION.canGenerate).toBe(false);
  });

  it("rejects a non-positive timeout override before any lane is built", async () => {
    const store = await useStorage();
    const registry = document([lane()]);
    expect(() => resolveAssetGeneratorLanes(store, registry, { env: {}, timeoutMs: 0 })).toThrow(
      /timeoutMs/,
    );
  });

  it("runs the same policy decision on fal, replicate, http, and mock and changes only providerKey", async () => {
    const store = await useStorage();
    const cues = { requiredScopes: ["IDENTITY" as const] };
    const registrySnapshot = {
      lanes: [
        {
          laneId: "swap-lane",
          laneClass: "standard" as const,
          providerKey: "open:model",
          enabled: true,
          gates: {
            HERO: "NOT_QUALIFIED" as const,
            IDENTITY: "NOT_QUALIFIED" as const,
            NON_IDENTITY: "NOT_QUALIFIED" as const,
          },
        },
      ],
    };
    const budgetSnapshot = { projectRemainingUsd: null };
    const attemptsSoFar: [] = [];
    const decision = decide(cues, registrySnapshot, budgetSnapshot, attemptsSoFar);
    expect(decision).toEqual({
      treatment: null,
      laneClass: null,
      laneId: null,
      providerKey: null,
      decisionReason: SG_POLICY_CONTRACT_REASON,
    });

    const records: Array<Awaited<ReturnType<typeof sgRecord>>> = [];
    const userId = "pr7-swap-resolver";
    const projects = new ProjectService();
    const fulfillments = new PrismaShotFulfillment(prisma);
    await prisma.project.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.create({
      data: {
        id: userId,
        name: "PR7 swap",
        email: "pr7-swap-resolver@example.com",
        emailVerified: true,
      },
    });
    const storedIds: string[] = [];
    try {
      for (const backend of YF_ASSET_GATEWAY_BACKENDS) {
        expect(decide(cues, registrySnapshot, budgetSnapshot, attemptsSoFar)).toEqual(decision);
        const providerKey = PROVIDER_KEY_BY_BACKEND[backend];
        const baseEnv = `SG_SWAP_${backend.toUpperCase()}_BASE_URL`;
        const keyEnv = `SG_SWAP_${backend.toUpperCase()}_API_KEY`;
        const port = 4500 + YF_ASSET_GATEWAY_BACKENDS.indexOf(backend);
        const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
          expect(String(url)).toBe(`http://127.0.0.1:${port}/v1/generate`);
          expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer key-${backend}`);
          const body = JSON.parse(String(init?.body)) as { model?: string; laneId?: unknown };
          expect(body.model).toBe(SHARED_MODEL_ID);
          expect(body.laneId).toBeUndefined();
          return okGenerateResponse();
        });
        const registry = document([
          lane({
            laneId: "swap-lane",
            providerKey,
            modelId: SHARED_MODEL_ID,
            gateway: { baseUrlEnv: baseEnv, apiKeyEnv: keyEnv },
          }),
        ]);
        const resolved = resolveAssetGeneratorLanes(store, registry, {
          env: {
            [baseEnv]: `http://127.0.0.1:${port}`,
            [keyEnv]: `key-${backend}`,
            ASSET_HTTP_MODEL: "request-override-model",
            ASSET_HTTP_PROVIDER_KEY: "http.asset",
            YF_GATEWAY_PROVIDER_KEY: "http.asset",
          },
          fetchImpl,
        }).forLane("swap-lane");
        const record = await sgRecord(resolved, decision, cues.requiredScopes);
        records.push(record);
        expect(fetchImpl).toHaveBeenCalledOnce();

        const project = await projects.create(userId, { title: "Swap", logline: "SG.7" });
        const slot = await fulfillments.ensureSlot({
          projectId: project.id,
          timelineId: "tl_swap",
          timelineVersion: 1,
          role: "broll_sunrise",
          storySceneId: "scene-arrive",
        });
        const priced = registry.lanes[0]!;
        const charge = estimateLaneCharge(priced);
        const actual = actualBilledSecondsFromDurationMs(
          record.document.durationMs,
          priced.billingGranularityS,
          charge.estimatedBilledSeconds,
        );
        const attempt = await fulfillments.beginAttempt({
          shotFulfillmentId: slot.id,
          laneClass: "standard",
          laneId: "swap-lane",
          providerKey: record.providerKey,
          modelId: record.modelId,
          requiredScopes: [...cues.requiredScopes],
          jobId: "job_swap",
          estimatedBilledSeconds: charge.estimatedBilledSeconds,
          usdPerSecond: priced.usdPerSecond,
          estimatedUsd: charge.reservedUsd,
        });
        const finished = await fulfillments.finishAttempt({
          attemptId: attempt.id,
          outcome: "SUCCEEDED",
          actualBilledSeconds: actual.seconds,
          outputWidth: record.document.width ?? null,
          outputHeight: record.document.height ?? null,
        });
        storedIds.push(finished.id);
      }

      const stored = await prisma.shotFulfillmentAttempt.findMany({
        where: { id: { in: storedIds } },
        include: { shot: true },
      });
      expect(stored).toHaveLength(YF_ASSET_GATEWAY_BACKENDS.length);
      const attemptView = (row: (typeof stored)[number]) => ({
        attemptNo: row.attemptNo,
        classAttemptNo: row.classAttemptNo,
        laneClass: row.laneClass,
        laneId: row.laneId,
        modelId: row.modelId,
        requiredScopes: row.requiredScopes,
        jobId: row.jobId,
        gatewayJobId: row.gatewayJobId,
        budgetReservationId: row.budgetReservationId,
        gatewayReservationId: row.gatewayReservationId,
        estimatedBilledSeconds: row.estimatedBilledSeconds,
        actualBilledSeconds: row.actualBilledSeconds,
        usdPerSecond: row.usdPerSecond,
        estimatedUsd: row.estimatedUsd,
        actualUsd: row.actualUsd,
        outcome: row.outcome,
        failureCode: row.failureCode,
        keepSignal: row.keepSignal,
        outputWidth: row.outputWidth,
        outputHeight: row.outputHeight,
        generatedAssetId: row.generatedAssetId,
        slot: {
          timelineId: row.shot.timelineId,
          timelineVersion: row.shot.timelineVersion,
          role: row.shot.role,
          storySceneId: row.shot.storySceneId,
          slotKey: row.shot.slotKey,
          scope: row.shot.scope,
          requiredScopes: row.shot.requiredScopes,
          shotRole: row.shot.shotRole,
          identityState: row.shot.identityState,
          identityEvidence: row.shot.identityEvidence,
          motionNeed: row.shot.motionNeed,
          slotDurationMs: row.shot.slotDurationMs,
          treatment: row.shot.treatment,
          status: row.shot.status,
          routingMode: row.shot.routingMode,
          shadowDecision: row.shot.shadowDecision,
          currentLaneClass: row.shot.currentLaneClass,
          currentLaneId: row.shot.currentLaneId,
          attemptsTotal: row.shot.attemptsTotal,
          decisionReason: row.shot.decisionReason,
          userMessageKey: row.shot.userMessageKey,
          registryVersion: row.shot.registryVersion,
          registrySha256: row.shot.registrySha256,
          treatmentParams: row.shot.treatmentParams,
          generatedAssetId: row.shot.generatedAssetId,
          sourceMediaAssetId: row.shot.sourceMediaAssetId,
        },
      });
      const views = stored.map(attemptView);
      for (const view of views.slice(1)) {
        expect(view).toEqual(views[0]);
      }
      expect(stored.map((row) => row.providerKey).sort()).toEqual(
        [...YF_ASSET_GATEWAY_BACKENDS.map((backend) => PROVIDER_KEY_BY_BACKEND[backend])].sort(),
      );
      expect(stored.every((row) => row.shot.currentProviderKey === row.providerKey)).toBe(true);
      expect(new Set(stored.map((row) => row.shot.currentProviderKey)).size).toBe(stored.length);
    } finally {
      await prisma.project.deleteMany({ where: { ownerId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }

    expect(records.map((record) => record.providerKey)).toEqual(
      YF_ASSET_GATEWAY_BACKENDS.map((backend) => PROVIDER_KEY_BY_BACKEND[backend]),
    );
    const comparable = records.map((record) => ({
      decision: record.decision,
      laneId: record.laneId,
      laneClass: record.laneClass,
      modelId: record.modelId,
      modelVersion: record.modelVersion,
      capability: record.capability,
      requiredScopes: record.requiredScopes,
      outcome: record.outcome,
      document: record.document,
    }));
    for (const record of comparable.slice(1)) {
      expect(record).toEqual(comparable[0]);
    }
    expect(comparable[0]?.modelId).toBe(SHARED_MODEL_ID);
    expect(comparable[0]?.modelId).not.toBe("request-override-model");
    expect(comparable[0]?.document.storageKey.startsWith("projects/proj_lanes/generated/")).toBe(true);
    expect(comparable[0]?.document.storageKey).not.toMatch(/^https?:\/\//);
  });
});

async function sgRecord(
  resolved: ResolvedLaneGenerator,
  decision: ReturnType<typeof decide>,
  requiredScopes: readonly string[],
) {
  const capability = AssetCapability.VIDEO_GENERATION;
  const attribution = resolved.attribution(capability);
  const document = await resolved.adapter.generate(baseInput());
  return {
    decision,
    laneId: "swap-lane",
    laneClass: "standard",
    providerKey: attribution.providerKey,
    modelId: attribution.modelId,
    modelVersion: attribution.modelVersion,
    capability: attribution.capability,
    requiredScopes: [...requiredScopes],
    outcome: "SUCCEEDED" as const,
    document,
  };
}
