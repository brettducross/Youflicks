import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { HttpAssetGeneratorAdapter } from "@/server/adapters/assets/http-asset";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import type { AssetGeneratorInput } from "@/server/assets/input";
import {
  LaneResolverError,
  readLaneHealthBaseUrl,
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
import { decide } from "@/server/sg/policy";
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
  fal: "fal:shared-swap-model",
  replicate: "replicate:shared-swap-model",
  http: "http.asset",
  mock: "mock.asset",
} as const satisfies Record<(typeof YF_ASSET_GATEWAY_BACKENDS)[number], string>;

const COST_BODY_KEYS = [
  "usdPerSecond",
  "usd",
  "estimatedUsd",
  "laneClass",
  "laneId",
  "registryVersion",
] as const;

function collectKeys(value: unknown, found: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.push(key);
      collectKeys(child, found);
    }
  }
}

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
        providerKey: "fal:open-video",
        modelId: "open-fal-video",
        gateway: { baseUrlEnv: "SG_LANE_B_BASE_URL", apiKeyEnv: "SG_LANE_B_API_KEY" },
        usdPerSecond: 0.2,
      }),
      lane({
        laneId: "legacy-r1",
        designation: "LEGACY_R1",
        providerKey: "open:legacy",
        modelId: "legacy-model",
        gateway: { baseUrlEnv: "ASSET_HTTP_BASE_URL", apiKeyEnv: "ASSET_HTTP_API_KEY" },
      }),
    ]);
    const seen: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      seen.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body,
      });
      return okGenerateResponse();
    });
    const resolver = resolveAssetGeneratorLanes(store, registry, {
      env: {
        SG_LANE_A_BASE_URL: "http://127.0.0.1:4401",
        SG_LANE_A_API_KEY: "key-a",
        SG_LANE_B_BASE_URL: "http://127.0.0.1:4402",
        SG_LANE_B_API_KEY: "key-b",
        ASSET_HTTP_BASE_URL: "http://127.0.0.1:4399",
        ASSET_HTTP_API_KEY: "legacy-key",
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
    expect(laneB.attribution(AssetCapability.VIDEO_GENERATION).providerKey).toBe("fal:open-video");
    expect(laneB.attribution(AssetCapability.VIDEO_GENERATION).modelId).toBe("open-fal-video");
    expect(
      (laneA.adapter as HttpAssetGeneratorAdapter).executionAttribution(AssetCapability.VIDEO_GENERATION),
    ).toEqual(laneA.attribution(AssetCapability.VIDEO_GENERATION));

    const legacy = resolver.forLane("legacy-r1");
    expect(legacy.adapter).not.toBe(laneA.adapter);
    expect(legacy.adapter).not.toBe(laneB.adapter);
    expect(legacy.attribution(AssetCapability.VIDEO_GENERATION)).toEqual({
      providerKey: "open:legacy",
      capability: AssetCapability.VIDEO_GENERATION,
      modelId: "legacy-model",
      modelVersion: null,
    });

    await laneA.adapter.generate(baseInput());
    await laneB.adapter.generate(baseInput({ role: "broll_other" }));
    await legacy.adapter.generate(baseInput({ role: "broll_legacy" }));
    expect(seen.map((call) => call.url)).toEqual([
      "http://127.0.0.1:4401/v1/generate",
      "http://127.0.0.1:4402/v1/generate",
      "http://127.0.0.1:4399/v1/generate",
    ]);
    expect(seen.map((call) => call.authorization)).toEqual([
      "Bearer key-a",
      "Bearer key-b",
      "Bearer legacy-key",
    ]);
    expect(seen.map((call) => call.body.model)).toEqual(["open-video", "open-fal-video", "legacy-model"]);
    expect(seen.every((call) => call.body.model !== "request-override-model")).toBe(true);
    for (const call of seen) {
      expect(Object.keys(call.body).sort()).toEqual(["input", "kind", "model", "role"]);
      const found: string[] = [];
      collectKeys(call.body, found);
      for (const key of COST_BODY_KEYS) {
        expect(found).not.toContain(key);
      }
    }
  });

  it("refuses IMAGE on a lane adapter even when ASSET_HTTP_CAPABILITIES lists IMAGE_GENERATION", async () => {
    const store = await useStorage();
    const fetchImpl = vi.fn<typeof fetch>(async () => okGenerateResponse());
    const resolved = resolveAssetGeneratorLanes(store, document([lane()]), {
      env: {
        SG_LANE_A_BASE_URL: "http://127.0.0.1:4420",
        SG_LANE_A_API_KEY: "key-a",
        ASSET_HTTP_CAPABILITIES: "IMAGE_GENERATION,VIDEO_GENERATION",
      },
      fetchImpl,
    }).forLane("lane-a");
    const adapter = resolved.adapter as HttpAssetGeneratorAdapter;
    expect(adapter.supports(AssetCapability.IMAGE_GENERATION)).toBe(false);
    expect(adapter.supports(AssetCapability.VIDEO_GENERATION)).toBe(true);
    await expect(adapter.generate(baseInput({ kind: "IMAGE" }))).rejects.toMatchObject({
      code: "ASSET_CAPABILITY_UNAVAILABLE",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses disabled lanes, TBD lanes, unknown lanes, and lanes with no gateway env", async () => {
    const store = await useStorage();
    const registry = document([
      lane({
        laneId: "live-lane",
        providerKey: "open:live",
        modelId: "live-model",
        gateway: { baseUrlEnv: "SG_LANE_LIVE_BASE_URL", apiKeyEnv: "SG_LANE_LIVE_API_KEY" },
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
      SG_LANE_LIVE_BASE_URL: "http://127.0.0.1:4403",
      SG_LANE_LIVE_API_KEY: "live-key",
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
      env: { SG_LANE_LIVE_BASE_URL: "  ", SG_LANE_LIVE_API_KEY: "live-key" },
    });
    expect(() => bare.forLane("live-lane")).toThrow(/SG_LANE_LIVE_BASE_URL/);
    const noKey = resolveAssetGeneratorLanes(store, registry, {
      env: { SG_LANE_LIVE_BASE_URL: "http://127.0.0.1:4403" },
    });
    expect(() => noKey.forLane("live-lane")).toThrow(/SG_LANE_LIVE_API_KEY/);
  });

  it("refuses disallowed gateway env names and non-http base URLs", async () => {
    const store = await useStorage();
    const secret = "super-secret-value-should-not-leak";
    const stolen = document([
      lane({
        laneId: "stolen",
        gateway: { baseUrlEnv: "SG_LANE_STOLEN_BASE_URL", apiKeyEnv: "BETTER_AUTH_SECRET" },
      }),
    ]);
    expect(() =>
      resolveAssetGeneratorLanes(store, stolen, {
        env: {
          SG_LANE_STOLEN_BASE_URL: "http://127.0.0.1:4490",
          BETTER_AUTH_SECRET: secret,
        },
      }).forLane("stolen"),
    ).toThrow(LaneResolverError);
    try {
      resolveAssetGeneratorLanes(store, stolen, {
        env: {
          SG_LANE_STOLEN_BASE_URL: "http://127.0.0.1:4490",
          BETTER_AUTH_SECRET: secret,
        },
      }).forLane("stolen");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LaneResolverError);
      const message = (error as Error).message;
      expect(message).toMatch(/stolen/);
      expect(message).toMatch(/BETTER_AUTH_SECRET/);
      expect(message).not.toContain(secret);
    }

    const fileUrl = "file:///etc/passwd";
    const fileLane = document([
      lane({
        laneId: "file-lane",
        gateway: { baseUrlEnv: "SG_LANE_FILE_BASE_URL", apiKeyEnv: "SG_LANE_FILE_API_KEY" },
      }),
    ]);
    try {
      resolveAssetGeneratorLanes(store, fileLane, {
        env: {
          SG_LANE_FILE_BASE_URL: fileUrl,
          SG_LANE_FILE_API_KEY: "file-key",
        },
      }).forLane("file-lane");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LaneResolverError);
      const message = (error as Error).message;
      expect(message).toMatch(/file-lane/);
      expect(message).toMatch(/SG_LANE_FILE_BASE_URL/);
      expect(message).not.toContain(fileUrl);
      expect(message).not.toContain("file-key");
    }

    const userInfoUrl = "http://user:pass@127.0.0.1:1";
    const userInfoLane = document([
      lane({
        laneId: "userinfo-lane",
        gateway: { baseUrlEnv: "SG_LANE_USERINFO_BASE_URL", apiKeyEnv: "SG_LANE_USERINFO_API_KEY" },
      }),
    ]);
    try {
      resolveAssetGeneratorLanes(store, userInfoLane, {
        env: {
          SG_LANE_USERINFO_BASE_URL: userInfoUrl,
          SG_LANE_USERINFO_API_KEY: "userinfo-key",
        },
      }).forLane("userinfo-lane");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LaneResolverError);
      const message = (error as Error).message;
      expect(message).toMatch(/userinfo-lane/);
      expect(message).toMatch(/username or password/);
      expect(message).not.toContain(userInfoUrl);
      expect(message).not.toContain("user:pass");
    }

    const garbage = "not a url";
    const garbageLane = document([
      lane({
        laneId: "garbage-lane",
        gateway: { baseUrlEnv: "SG_LANE_GARBAGE_BASE_URL", apiKeyEnv: "SG_LANE_GARBAGE_API_KEY" },
      }),
    ]);
    try {
      resolveAssetGeneratorLanes(store, garbageLane, {
        env: {
          SG_LANE_GARBAGE_BASE_URL: garbage,
          SG_LANE_GARBAGE_API_KEY: "garbage-key",
        },
      }).forLane("garbage-lane");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LaneResolverError);
      const message = (error as Error).message;
      expect(message).toMatch(/garbage-lane/);
      expect(message).toMatch(/SG_LANE_GARBAGE_BASE_URL/);
      expect(message).not.toContain(garbage);
      expect(message).not.toContain("garbage-key");
    }

    const misnamed = document([
      lane({
        laneId: "not-legacy",
        designation: "NONE",
        gateway: { baseUrlEnv: "ASSET_HTTP_BASE_URL", apiKeyEnv: "ASSET_HTTP_API_KEY" },
      }),
    ]);
    try {
      resolveAssetGeneratorLanes(store, misnamed, {
        env: {
          ASSET_HTTP_BASE_URL: "http://127.0.0.1:4491",
          ASSET_HTTP_API_KEY: "should-not-leak",
        },
      }).forLane("not-legacy");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LaneResolverError);
      const message = (error as Error).message;
      expect(message).toMatch(/not-legacy/);
      expect(message).toMatch(/ASSET_HTTP_BASE_URL/);
      expect(message).toMatch(/ASSET_HTTP_API_KEY/);
      expect(message).toMatch(/NONE/);
      expect(message).not.toContain("should-not-leak");
      expect(message).not.toContain("4491");
    }
  });

  it("refuses a health URL whose env name or userinfo the resolver would refuse", () => {
    const secret = document([
      lane({
        laneId: "secret-lane",
        gateway: { baseUrlEnv: "DATABASE_URL", apiKeyEnv: "SG_LANE_SECRET_API_KEY" },
      }),
    ]);
    expect(
      readLaneHealthBaseUrl(secret.lanes[0]!, {
        DATABASE_URL: "postgresql://youflicks:youflicks@localhost:5432/youflicks",
      }),
    ).toBeNull();
    const userInfo = document([
      lane({
        laneId: "userinfo-lane",
        gateway: { baseUrlEnv: "SG_LANE_USERINFO_BASE_URL", apiKeyEnv: "SG_LANE_USERINFO_API_KEY" },
      }),
    ]);
    expect(
      readLaneHealthBaseUrl(userInfo.lanes[0]!, {
        SG_LANE_USERINFO_BASE_URL: "http://user:pass@127.0.0.1:1",
      }),
    ).toBeNull();
    const ok = document([
      lane({
        laneId: "ok-lane",
        gateway: { baseUrlEnv: "SG_LANE_OK_BASE_URL", apiKeyEnv: "SG_LANE_OK_API_KEY" },
      }),
    ]);
    expect(
      readLaneHealthBaseUrl(ok.lanes[0]!, { SG_LANE_OK_BASE_URL: "http://127.0.0.1:9" }),
    ).toBe("http://127.0.0.1:9");
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

    const availability = resolvedAssetGeneratorForLanes(
      [resolved],
      resolver.processors(AssetCapability.MEDIA_ENHANCEMENT),
    );
    expect(availability).not.toHaveProperty("adapter");
    expect(availability).not.toHaveProperty("attributionFor");
    const described = describeAssetAvailability({
      adapter: resolved.adapter,
      attributionFor: (capability) => resolved.attribution(capability),
      productionAvailable: true,
      localDevAvailable: false,
      supportedCapabilities: [...resolved.supportedCapabilities],
    });
    expect(described.capabilities).toEqual(availability.capabilities);
    expect(described.localDevAvailable).toBe(false);
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
    expect(() => resolver.forLane("yf.kenburns.v1")).toThrow(/not a generative registry lane/);

    const lanes = [resolver.forLane("lane-a"), resolver.forLane("lane-b")];
    const availability = resolvedAssetGeneratorForLanes(lanes, hooks);
    expect(availability).not.toHaveProperty("adapter");
    expect(availability.capabilities.VIDEO_GENERATION.canGenerate).toBe(true);
    expect(availability.capabilities.MEDIA_ENHANCEMENT.canGenerate).toBe(false);
    expect(availability.localDevAvailable).toBe(false);
    expect(resolvedAssetGeneratorForLanes([], hooks).canGenerate).toBe(false);

    const installed: EnhancementProcessorHook = {
      ...hooks[0]!,
      adapter: {
        async generate(): Promise<GeneratedAssetDocument> {
          throw new Error("PR-9 owns the processor.");
        },
      },
    };
    const withProcessor = resolvedAssetGeneratorForLanes([], [installed]);
    expect(withProcessor).not.toHaveProperty("adapter");
    expect(withProcessor.capabilities.MEDIA_ENHANCEMENT).toEqual({
      productionAvailable: true,
      localDevAvailable: false,
      canGenerate: true,
    });
    expect(withProcessor.capabilities.VIDEO_GENERATION.canGenerate).toBe(false);
  });

  it("rejects a non-positive timeout override and an invalid ASSET_HTTP_TIMEOUT_MS", async () => {
    const store = await useStorage();
    const registry = document([lane()]);
    expect(() => resolveAssetGeneratorLanes(store, registry, { env: {}, timeoutMs: 0 })).toThrow(
      /timeoutMs/,
    );
    const invalid = "abc";
    expect(() =>
      resolveAssetGeneratorLanes(store, registry, { env: { ASSET_HTTP_TIMEOUT_MS: invalid } }),
    ).toThrow(LaneResolverError);
    try {
      resolveAssetGeneratorLanes(store, registry, { env: { ASSET_HTTP_TIMEOUT_MS: invalid } });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/ASSET_HTTP_TIMEOUT_MS/);
      expect(message).not.toContain(invalid);
    }
    expect(() =>
      resolveAssetGeneratorLanes(store, registry, { env: { ASSET_HTTP_TIMEOUT_MS: "  " } }),
    ).not.toThrow();
    expect(() =>
      resolveAssetGeneratorLanes(store, registry, { env: { ASSET_HTTP_TIMEOUT_MS: "90000" } }),
    ).not.toThrow();
  });

  it("runs the same policy decision on fal, replicate, http, and mock and changes only providerKey", async () => {
    const store = await useStorage();
    const cues = { requiredScopes: ["IDENTITY" as const], routingMode: "ENFORCED" as const };
    const registrySnapshot = {
      lanes: [
        {
          laneId: "swap-lane",
          laneClass: "standard" as const,
          providerKey: "open:model",
          enabled: true,
          healthy: false,
          gates: {
            HERO: "NOT_QUALIFIED" as const,
            IDENTITY: "NOT_QUALIFIED" as const,
            NON_IDENTITY: "NOT_QUALIFIED" as const,
          },
        },
      ],
    };
    const budgetSnapshot = {};
    const attemptsSoFar: [] = [];
    const decision = decide(cues, registrySnapshot, budgetSnapshot, attemptsSoFar);
    expect(decision).toEqual({
      treatment: "DEFER",
      laneClass: null,
      laneId: null,
      providerKey: null,
      decisionReason: "No eligible lane for the required scopes.",
      messageKey: "SG_NO_QUALIFIED_LANE",
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
        const baseEnv = `SG_LANE_SWAP_${backend.toUpperCase()}_BASE_URL`;
        const keyEnv = `SG_LANE_SWAP_${backend.toUpperCase()}_API_KEY`;
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
