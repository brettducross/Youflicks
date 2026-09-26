import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { prisma } from "@/server/db";
import { PrismaAiVideoBudget } from "@/server/sg/ai-video-budget";
import { attemptOutcomeFromSettlement } from "@/server/sg/attempt-outcome";
import { IdentityEvidenceError } from "@/server/sg/identity-evidence";
import {
  fulfillmentSlotKey,
  LEGACY_DECISION_REASON,
  PrismaShotFulfillment,
  readRegistryStamp,
  recordedLaneClass,
  ShotFulfillmentError,
  UNCLASSIFIED_LANE_CLASS,
} from "@/server/sg/shot-fulfillment";
import { ProjectService } from "@/server/services/projects";
import { WipeService } from "@/server/services/wipe";

const CREATIVE_PAYLOAD_SHA256 = {
  "src/server/story/schema.ts": "9fdfd62e1c2dbc8baf67aaf2286f029ac63f8f47e99f21221a5df5dd777b73aa",
  "src/server/timeline/schema.ts": "1597262cf3ba8156a6225294dd3de2c0d75fcde29de201839eda85f31d760f8a",
  "src/server/director/schema.ts": "335a5ea172adb78b131d06efe56900d8aea790a0812c825f01f5a7c405f4e93b",
  "src/server/assets/schema.ts": "7a4a3fb5eaf8903b557089725dc77fc3307147fc74d942bc47e10ba40b2119d4",
  "src/server/assets/input.ts": "cdc15e346d3d181513242174380b917d351c44ab87e3c166f00b3dcb0618b4db",
  "src/server/ports/asset-generator.ts": "a579f9766bcac113806aadaf88a40801fc13b322f298fa842aac1358322ddd82",
} as const;

const PRISMA_MODEL_SHA256 = {
  CreativePlan: "6a4349b91e0a299a5c5a583a26710d1371857139a8a5a6002031a3788b5694db",
  StoryStructure: "922106205972d1fd4e6dd85b0385208835949a8f1a8165e2ce2790f946be156f",
  Timeline: "54a6f24ef2faab8afecffb194ef5cef38b91c427826127f6f536f22dcd8f42db",
  GeneratedAsset: "6675a9425934d17d6b2b28497d0c5a2ffd087a530bd5d448b6f70f78c34b2d02",
} as const;

describe("attempt outcome mapping", () => {
  it("maps PR-1 settlements onto attempt outcomes", () => {
    expect(
      attemptOutcomeFromSettlement({ spendCap: true, settlement: null, settleReason: null }),
    ).toEqual({ outcome: "CAP_DENIED", failureCode: "CAP_DENIED" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "RELEASED",
        settleReason: "CAP_DENIED",
      }),
    ).toEqual({ outcome: "CAP_DENIED", failureCode: "CAP_DENIED" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "UNRECONCILED",
        settleReason: "TIMEOUT",
      }),
    ).toEqual({ outcome: "TIMEOUT_UNRECONCILED", failureCode: "TIMEOUT" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "UNRECONCILED",
        settleReason: "ABORTED",
      }),
    ).toEqual({ outcome: "TIMEOUT_UNRECONCILED", failureCode: "ABORTED" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "UNRECONCILED",
        settleReason: "CANCELLED",
      }),
    ).toEqual({ outcome: "CANCELLED", failureCode: "CANCELLED" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "RELEASED",
        settleReason: "SUBMIT_REJECTED",
      }),
    ).toEqual({ outcome: "FAILED", failureCode: "SUBMIT_REJECTED" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "NONE",
        settleReason: null,
        gatewayStatus: 400,
        gatewayCode: "DURATION_UNSUPPORTED",
      }),
    ).toEqual({ outcome: "FAILED", failureCode: "SUBMIT_REJECTED" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "MISSING",
        settleReason: null,
        gatewayStatus: 404,
      }),
    ).toEqual({ outcome: "TIMEOUT_UNRECONCILED", failureCode: "SETTLEMENT_MISSING" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "MISSING",
        settleReason: null,
        gatewayStatus: 413,
      }),
    ).toEqual({ outcome: "TIMEOUT_UNRECONCILED", failureCode: "SETTLEMENT_MISSING" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "UNRECONCILED",
        settleReason: null,
        gatewayStatus: 400,
        gatewayCode: "BAD_REQUEST",
      }),
    ).toEqual({ outcome: "TIMEOUT_UNRECONCILED", failureCode: "BAD_REQUEST" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "UNRECONCILED",
        settleReason: "STATUS_UNKNOWN",
        gatewayStatus: 404,
      }),
    ).toEqual({ outcome: "TIMEOUT_UNRECONCILED", failureCode: "STATUS_UNKNOWN" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "RELEASED",
        settleReason: "RESULT_UNKNOWN",
        gatewayStatus: 400,
      }),
    ).toEqual({ outcome: "TIMEOUT_UNRECONCILED", failureCode: "RESULT_UNKNOWN" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "UNRECONCILED",
        settleReason: "SUBMIT_UNKNOWN",
        gatewayStatus: 408,
      }),
    ).toEqual({ outcome: "TIMEOUT_UNRECONCILED", failureCode: "SUBMIT_UNKNOWN" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "RECONCILED",
        settleReason: "DOWNLOAD_FAILURE_BILLED",
      }),
    ).toEqual({ outcome: "FAILED", failureCode: "DOWNLOAD_FAILURE_BILLED" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "RECONCILED",
        settleReason: "FAILURE_BILLABLE",
      }),
    ).toEqual({ outcome: "FAILED", failureCode: "FAILURE_BILLABLE" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "RELEASED",
        settleReason: "FAILURE_NOT_BILLABLE",
      }),
    ).toEqual({ outcome: "FAILED", failureCode: "FAILURE_NOT_BILLABLE" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "NONE",
        settleReason: null,
      }),
    ).toEqual({ outcome: "FAILED", failureCode: "GATEWAY_NONE" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "MISSING",
        settleReason: null,
      }),
    ).toEqual({ outcome: "TIMEOUT_UNRECONCILED", failureCode: "SETTLEMENT_MISSING" });
    expect(
      attemptOutcomeFromSettlement({
        spendCap: false,
        settlement: "UNRECONCILED",
        settleReason: "UNKNOWN",
      }),
    ).toEqual({ outcome: "TIMEOUT_UNRECONCILED", failureCode: "UNKNOWN" });
  });
});

describe("creative payloads and GeneratedAsset stay unchanged", () => {
  it("pins Story, Timeline, CreativePlan, and GeneratedAsset payload modules", () => {
    for (const [file, expected] of Object.entries(CREATIVE_PAYLOAD_SHA256)) {
      const body = readFileSync(file);
      expect(createHash("sha256").update(body).digest("hex")).toBe(expected);
    }
  });

  it("pins CreativePlan, StoryStructure, Timeline, and GeneratedAsset Prisma models", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).not.toMatch(/^enum /m);
    const parts = schema.split(/(?=^model )/m);
    for (const [name, expected] of Object.entries(PRISMA_MODEL_SHA256)) {
      const block = parts.find((part) => part.startsWith(`model ${name} {`));
      expect(block, name).toBeTruthy();
      expect(createHash("sha256").update(block ?? "").digest("hex")).toBe(expected);
    }
  });

  it("is not written by Director, Story, or Timeline services", () => {
    const files = [
      "src/server/services/director.ts",
      "src/server/services/director-contract.ts",
      "src/server/services/story.ts",
      "src/server/services/story-contract.ts",
      "src/server/services/timeline.ts",
      "src/server/services/timeline-contract.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("shot-fulfillment");
      expect(source).not.toContain("ShotFulfillment");
    }
    expect(readFileSync("src/server/sg/shot-fulfillment.ts", "utf8")).not.toContain(
      "@/server/sg/policy",
    );
    // PR-8: AssetService is the production policy caller. The store stays free of it.
    expect(readFileSync("src/server/services/asset.ts", "utf8")).toContain("@/server/sg/policy");
  });
});

describe("recorded lane class", () => {
  it("reads laneClass from the registry and uses unclassified only when it cannot", async () => {
    const filePath = path.join(process.cwd(), "config/sg-lane-registry.json");
    expect(recordedLaneClass("r1-wan27-replicate", filePath)).toBe("standard");
    expect(recordedLaneClass("boreal-720", filePath)).toBe("draft-cost");
    expect(recordedLaneClass("yf.kenburns.v1", filePath)).toBe("processor");
    expect(recordedLaneClass("not-a-lane", filePath)).toBe(UNCLASSIFIED_LANE_CLASS);
    expect(recordedLaneClass("r1-wan27-replicate", "/tmp/youflicks-missing-lane-registry.json")).toBe(
      UNCLASSIFIED_LANE_CLASS,
    );

    const dir = await mkdtemp(path.join(tmpdir(), "youflicks-lane-class-"));
    try {
      const doc = JSON.parse(readFileSync(filePath, "utf8")) as {
        lanes: Array<{ laneId: string; laneClass: string }>;
      };
      const row = doc.lanes.find((item) => item.laneId === "r1-wan27-replicate");
      expect(row).toBeTruthy();
      row!.laneClass = "draft-quality";
      const patched = path.join(dir, "registry.json");
      await writeFile(patched, JSON.stringify(doc), "utf8");
      expect(recordedLaneClass("r1-wan27-replicate", patched)).toBe("draft-quality");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("registry stamp", () => {
  it("does not invent a registry version when the file cannot be read", () => {
    const stamp = readRegistryStamp("/tmp/youflicks-no-such-lane-registry.json");
    expect(stamp).toEqual({ registryVersion: "", registrySha256: "" });
    expect(stamp.registryVersion).not.toBe("v0");
    expect(stamp.registrySha256).not.toBe("unavailable");
  });

  it("stamps an invalid registry as empty", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "youflicks-registry-stamp-bad-"));
    try {
      const file = path.join(dir, "registry.json");
      await writeFile(file, JSON.stringify({ registryVersion: "sg-lanes-v1" }), "utf8");
      expect(readRegistryStamp(file)).toEqual({ registryVersion: "", registrySha256: "" });
      await writeFile(file, "{not json", "utf8");
      expect(readRegistryStamp(file)).toEqual({ registryVersion: "", registrySha256: "" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records the in-file version and sha for a readable registry", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "youflicks-registry-stamp-"));
    try {
      const source = readFileSync(path.join(process.cwd(), "config/sg-lane-registry.json"));
      const file = path.join(dir, "registry.json");
      await writeFile(file, source);
      const stamp = readRegistryStamp(file);
      const doc = JSON.parse(source.toString("utf8")) as { registryVersion: string };
      expect(stamp.registryVersion).toBe(doc.registryVersion);
      expect(stamp.registrySha256).toBe(createHash("sha256").update(source).digest("hex"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("ShotFulfillment records", () => {
  const userId = `sg-pr2-${Date.now()}`;
  const projects = new ProjectService();
  const records = new PrismaShotFulfillment(prisma);
  let projectId = "";
  let dir = "";

  afterAll(async () => {
    if (projectId) {
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("creates one slot per key, records attempts without a ceiling, and rejects biometric evidence", async () => {
    await prisma.user.create({
      data: { id: userId, name: "Fulfillment", email: `${userId}@example.com`, emailVerified: true },
    });
    const project = await projects.create(userId, { title: "Shots", logline: "SG.0" });
    projectId = project.id;

    const slotKey = fulfillmentSlotKey({
      timelineId: "tl_1",
      timelineVersion: 1,
      role: "intimate_portrait",
      storySceneId: null,
    });
    expect(slotKey).toBe("tl_1:1:intimate_portrait:-");

    const first = await records.ensureSlot({
      projectId,
      timelineId: "tl_1",
      timelineVersion: 1,
      role: "intimate_portrait",
    });
    const again = await records.ensureSlot({
      projectId,
      timelineId: "tl_1",
      timelineVersion: 1,
      role: "intimate_portrait",
    });
    expect(again.id).toBe(first.id);
    expect(await prisma.shotFulfillment.count({ where: { projectId, slotKey } })).toBe(1);
    expect(first.routingMode).toBe("LEGACY");
    expect(first.shadowDecision).toBeNull();
    expect(first.scope).toBe("IDENTITY");
    expect(first.requiredScopes).toEqual(["IDENTITY"]);
    expect(first.identityState).toBe("UNKNOWN");
    expect(first.treatment).toBe("GENERATE");
    expect(first.decisionReason).toBe(LEGACY_DECISION_REASON);
    expect(first.identityEvidence).toBeNull();
    const registryFile = path.join(process.cwd(), "config/sg-lane-registry.json");
    const registryBytes = readFileSync(registryFile);
    const registryDoc = JSON.parse(registryBytes.toString("utf8")) as { registryVersion: string };
    expect(first.registryVersion).toBe(registryDoc.registryVersion);
    expect(first.registryVersion).toBe("sg-lanes-v1");
    expect(first.registryVersion).not.toBe("v0");
    expect(first.registrySha256).toBe(createHash("sha256").update(registryBytes).digest("hex"));
    expect(first.registrySha256).not.toBe("unavailable");

    const standard = await records.beginAttempt({
      shotFulfillmentId: first.id,
      laneClass: recordedLaneClass("r1-wan27-replicate"),
      laneId: "r1-wan27-replicate",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
      requiredScopes: first.requiredScopes,
      jobId: "job_1",
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    expect(standard.attemptNo).toBe(1);
    expect(standard.classAttemptNo).toBe(1);
    expect(recordedLaneClass("r1-wan27-replicate")).toBe("standard");
    expect(recordedLaneClass("not-a-lane")).toBe(UNCLASSIFIED_LANE_CLASS);

    for (let index = 0; index < 4; index += 1) {
      const row = await records.beginAttempt({
        shotFulfillmentId: first.id,
        laneClass: "draft-cost",
        laneId: "boreal-720",
        providerKey: "TBD:boreal-720",
        requiredScopes: ["IDENTITY"],
        estimatedBilledSeconds: 5,
        usdPerSecond: 0.01,
        estimatedUsd: 0.05,
      });
      expect(row.classAttemptNo).toBe(index + 1);
      expect(row.attemptNo).toBe(index + 2);
      await records.finishAttempt({ attemptId: row.id, outcome: "FAILED", failureCode: "RECORDED" });
    }
    const slot = await prisma.shotFulfillment.findUniqueOrThrow({ where: { id: first.id } });
    expect(slot.attemptsTotal).toBe(5);
    expect(await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: first.id } })).toBe(5);

    const nextVersion = await records.ensureSlot({
      projectId,
      timelineId: "tl_2",
      timelineVersion: 2,
      role: "intimate_portrait",
      storySceneId: "scene-arrive",
    });
    expect(nextVersion.slotKey).toBe("tl_2:2:intimate_portrait:scene-arrive");
    expect(nextVersion.status).toBe("PLANNED");
    const prior = await prisma.shotFulfillment.findUniqueOrThrow({ where: { id: first.id } });
    expect(prior.status).toBe("SUPERSEDED");

    await records.setIdentityEvidence(nextVersion.id, {
      faceCount: 1,
      faceDetected: false,
      recurringPersonCount: 0,
      analysisCompleted: true,
      detail: { faceCount: 0, faceDetected: false },
    });
    const accepted = await prisma.shotFulfillment.findUniqueOrThrow({ where: { id: nextVersion.id } });
    expect(accepted.identityEvidence).toEqual({
      faceCount: 1,
      faceDetected: false,
      recurringPersonCount: 0,
      analysisCompleted: true,
      detail: { faceCount: 0, faceDetected: false },
    });
    const quantized = Object.fromEntries(
      Array.from({ length: 128 }, (_, index) => [`e${index}`, index % 256]),
    );
    await expect(records.setIdentityEvidence(nextVersion.id, quantized)).rejects.toBeInstanceOf(
      IdentityEvidenceError,
    );
    let deep: Record<string, unknown> = { faceCount: 1 };
    for (let level = 0; level < 6; level += 1) {
      deep = { detail: deep };
    }
    await expect(records.setIdentityEvidence(nextVersion.id, deep)).rejects.toBeInstanceOf(
      IdentityEvidenceError,
    );
    await expect(
      records.setIdentityEvidence(nextVersion.id, { faceCount: Number.MAX_SAFE_INTEGER }),
    ).rejects.toBeInstanceOf(IdentityEvidenceError);

    await expect(
      records.setIdentityEvidence(nextVersion.id, { embedding: [0.12, -0.4, 1.5] }),
    ).rejects.toBeInstanceOf(IdentityEvidenceError);
    await expect(
      records.setIdentityEvidence(nextVersion.id, { crop: Buffer.from([0xff, 0xd8, 0xff]) }),
    ).rejects.toBeInstanceOf(IdentityEvidenceError);
    await expect(
      records.setIdentityEvidence(nextVersion.id, {
        crop: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
      }),
    ).rejects.toBeInstanceOf(IdentityEvidenceError);
    const unchanged = await prisma.shotFulfillment.findUniqueOrThrow({ where: { id: nextVersion.id } });
    expect(unchanged.identityEvidence).toEqual(accepted.identityEvidence);
  });

  it("gives classAttemptNo 1 when the only prior same-class row is CAP_DENIED", async () => {
    const slot = await records.ensureSlot({
      projectId,
      timelineId: "tl_cap",
      timelineVersion: 4,
      role: "intimate_portrait",
      storySceneId: "scene-cap",
    });
    const denied = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "standard",
      laneId: "r1-wan27-replicate",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
      requiredScopes: ["IDENTITY"],
      jobId: "job_cap",
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    await records.finishAttempt({
      attemptId: denied.id,
      outcome: "CAP_DENIED",
      failureCode: "CAP_DENIED",
    });
    const generation = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "standard",
      laneId: "r1-wan27-replicate",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
      requiredScopes: ["IDENTITY"],
      jobId: "job_generation",
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    expect(generation.attemptNo).toBe(2);
    expect(generation.classAttemptNo).toBe(1);
    await records.finishAttempt({
      attemptId: generation.id,
      outcome: "TIMEOUT_UNRECONCILED",
      failureCode: "TIMEOUT",
    });
    const afterTimeout = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "standard",
      laneId: "r1-wan27-replicate",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
      requiredScopes: ["IDENTITY"],
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    expect(afterTimeout.classAttemptNo).toBe(2);
  });

  it("closes an interrupted PENDING attempt as TIMEOUT_UNRECONCILED and marks its hold UNRECONCILED", async () => {
    const slot = await records.ensureSlot({
      projectId,
      timelineId: "tl_interrupt",
      timelineVersion: 5,
      role: "intimate_portrait",
      storySceneId: "scene-interrupt",
    });
    const budgets = new PrismaAiVideoBudget(prisma);
    const hold = await budgets.reserve({
      idempotencyKey: `${userId}-interrupted`,
      projectId,
      userId,
      windowKey: "2026-09-25",
      laneId: "r1-wan27-replicate",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
      caps: {},
    });
    const pending = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "standard",
      laneId: "r1-wan27-replicate",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
      requiredScopes: ["IDENTITY"],
      jobId: "job_interrupted",
      budgetReservationId: hold.id,
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    const other = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "standard",
      laneId: "r1-wan27-replicate",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
      requiredScopes: ["IDENTITY"],
      jobId: "job_other",
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    await records.abandonPendingAttempts({
      shotFulfillmentId: slot.id,
      jobId: "job_interrupted",
    });
    const closed = await prisma.shotFulfillmentAttempt.findUniqueOrThrow({ where: { id: pending.id } });
    expect(closed.outcome).toBe("TIMEOUT_UNRECONCILED");
    expect(closed.failureCode).toBe("INTERRUPTED");
    const settled = await prisma.aiVideoBudgetReservation.findUniqueOrThrow({ where: { id: hold.id } });
    expect(settled.status).toBe("UNRECONCILED");
    expect(settled.settleReason).toBe("INTERRUPTED");
    const untouched = await prisma.shotFulfillmentAttempt.findUniqueOrThrow({ where: { id: other.id } });
    expect(untouched.outcome).toBe("PENDING");
    await prisma.aiVideoBudgetLedger.deleteMany({
      where: { OR: [{ projectId }, { userId }] },
    });
  });

  it("assigns one attempt sequence when two workers record the same slot", async () => {
    const slot = await records.ensureSlot({
      projectId,
      timelineId: "tl_race",
      timelineVersion: 3,
      role: "broll",
      storySceneId: "scene-race",
    });
    const [left, right] = await Promise.all([
      records.beginAttempt({
        shotFulfillmentId: slot.id,
        laneClass: "standard",
        laneId: "r1-wan27-replicate",
        providerKey: "replicate:wan-video/wan-2.7-i2v",
        requiredScopes: ["IDENTITY"],
        jobId: "job_left",
        estimatedBilledSeconds: 5,
        usdPerSecond: 0.1,
        estimatedUsd: 0.5,
      }),
      records.beginAttempt({
        shotFulfillmentId: slot.id,
        laneClass: "standard",
        laneId: "r1-wan27-replicate",
        providerKey: "replicate:wan-video/wan-2.7-i2v",
        requiredScopes: ["IDENTITY"],
        jobId: "job_right",
        estimatedBilledSeconds: 5,
        usdPerSecond: 0.1,
        estimatedUsd: 0.5,
      }),
    ]);
    expect([left.attemptNo, right.attemptNo].sort()).toEqual([1, 2]);
    expect([left.classAttemptNo, right.classAttemptNo].sort()).toEqual([1, 2]);
    const after = await prisma.shotFulfillment.findUniqueOrThrow({ where: { id: slot.id } });
    expect(after.attemptsTotal).toBe(2);
    expect(await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: slot.id } })).toBe(2);
  });

  it("refuses a generatedAssetId from another project", async () => {
    const otherOwner = `${userId}-other`;
    await prisma.user.create({
      data: { id: otherOwner, name: "Other", email: `${otherOwner}@example.com`, emailVerified: true },
    });
    const other = await projects.create(otherOwner, { title: "Other", logline: "no" });
    const asset = await prisma.generatedAsset.create({
      data: {
        projectId: other.id,
        status: "FAILED",
        kind: "IMAGE",
        origin: "GENERATED",
        role: "x",
        mimeType: "application/octet-stream",
        byteSize: BigInt(0),
        storageKey: `projects/${other.id}/generated/x/failed`,
        payload: { schemaVersion: "1.0" },
        inputFingerprint: "other",
        providerKey: "none",
        capability: "IMAGE_GENERATION",
      },
    });
    const slot = await records.ensureSlot({
      projectId,
      timelineId: "tl_asset",
      timelineVersion: 4,
      role: "x",
    });
    const attempt = await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "standard",
      laneId: "r1-wan27-replicate",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
      requiredScopes: ["IDENTITY"],
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    await expect(
      records.finishAttempt({
        attemptId: attempt.id,
        outcome: "SUCCEEDED",
        generatedAssetId: asset.id,
      }),
    ).rejects.toBeInstanceOf(ShotFulfillmentError);
    const row = await prisma.shotFulfillmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.outcome).toBe("PENDING");
    expect(row.generatedAssetId).toBeNull();
    await prisma.project.delete({ where: { id: other.id } });
    await prisma.user.delete({ where: { id: otherOwner } });
  });

  it("cascades fulfillment rows when the project or account is wiped", async () => {
    dir = dir || (await mkdtemp(path.join(tmpdir(), "youflicks-sg-pr2-")));
    const wipe = new WipeService(new LocalStorageAdapter(dir));
    const owner = `${userId}-wipe`;
    await prisma.user.create({
      data: { id: owner, name: "Wipe", email: `${owner}@example.com`, emailVerified: true },
    });
    const project = await projects.create(owner, { title: "Wipe", logline: "cascade" });
    const slot = await records.ensureSlot({
      projectId: project.id,
      timelineId: "tl_wipe",
      timelineVersion: 1,
      role: "wide",
    });
    await records.beginAttempt({
      shotFulfillmentId: slot.id,
      laneClass: "standard",
      laneId: "r1-wan27-replicate",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
      requiredScopes: ["IDENTITY"],
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    await wipe.deleteProject(owner, project.id);
    expect(await prisma.shotFulfillment.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: slot.id } })).toBe(0);

    const accountProject = await projects.create(owner, { title: "Account", logline: "cascade" });
    const accountSlot = await records.ensureSlot({
      projectId: accountProject.id,
      timelineId: "tl_account",
      timelineVersion: 1,
      role: "wide",
    });
    await records.beginAttempt({
      shotFulfillmentId: accountSlot.id,
      laneClass: "standard",
      laneId: "r1-wan27-replicate",
      providerKey: "replicate:wan-video/wan-2.7-i2v",
      requiredScopes: ["IDENTITY"],
      estimatedBilledSeconds: 5,
      usdPerSecond: 0.1,
      estimatedUsd: 0.5,
    });
    await wipe.deleteAccount(owner);
    expect(await prisma.shotFulfillment.count({ where: { projectId: accountProject.id } })).toBe(0);
    expect(await prisma.shotFulfillmentAttempt.count({ where: { shotFulfillmentId: accountSlot.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: owner } })).toBe(0);
  });
});
