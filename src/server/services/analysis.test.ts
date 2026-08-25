import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { LocalTechnicalAnalyzer } from "@/server/adapters/analysis/local-technical";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { ProviderRegistry } from "@/server/analysis/registry";
import { RegistryMediaAnalyzer } from "@/server/analysis/registry-analyzer";
import { prisma } from "@/server/db";
import { AnalysisStatus, JobType } from "@/server/domain/status";
import { AnalysisCapability } from "@/server/ports/capabilities";
import type { MediaAnalysisAdapter } from "@/server/ports/media-analysis-adapter";
import { AnalysisService } from "@/server/services/analysis";
import { AnalysisWorker } from "@/server/services/analysis-worker";
import { AttributionService } from "@/server/services/attribution";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function observationsAdapter(
  providerKey: string,
  observations: Record<string, unknown>,
  fail?: boolean,
): MediaAnalysisAdapter {
  return {
    providerKey,
    capabilities: [AnalysisCapability.IMAGE_ANALYSIS],
    configured: true,
    enabled: true,
    health() {
      return {
        providerKey,
        configured: true,
        enabled: true,
        available: true,
        capabilities: [AnalysisCapability.IMAGE_ANALYSIS],
      };
    },
    async analyze() {
      if (fail) {
        throw AppError.analysisFailed("adapter exploded");
      }
      return { providerKey, modelId: "fake-1", modelVersion: "0.1", observations };
    },
  };
}

describe("AnalysisService", () => {
  const ownerId = `analysis-owner-${Date.now()}`;
  const strangerId = `analysis-stranger-${Date.now()}`;
  let projectId = "";
  let dir = "";
  let media: MediaService;
  let jobs: PostgresJobQueue;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "youflicks-analysis-"));
    await prisma.user.createMany({
      data: [
        { id: ownerId, name: "Owner", email: `${ownerId}@example.com`, emailVerified: false },
        { id: strangerId, name: "Stranger", email: `${strangerId}@example.com`, emailVerified: false },
      ],
    });
    const project = await new ProjectService().create(ownerId, {
      title: "Intelligence tests",
      logline: "Analysis foundation.",
    });
    projectId = project.id;
    media = new MediaService(new LocalStorageAdapter(dir), new ProjectService());
    jobs = new PostgresJobQueue();
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  function harness(adapter: MediaAnalysisAdapter) {
    const registry = new ProviderRegistry().register(adapter);
    const analyzer = new RegistryMediaAnalyzer(registry);
    const analysis = new AnalysisService(media, jobs, analyzer);
    return { analysis, worker: new AnalysisWorker(jobs, analysis) };
  }

  it("creates a retryable analysis job and persists normalized analysis", async () => {
    const asset = await media.ingest(ownerId, projectId, {
      filename: "still.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    const { analysis, worker } = harness(
      observationsAdapter("test.vision", {
        technical: { mimeType: "image/png", width: 1, height: 1 },
        visual: { sceneDescription: "A test slate", confidence: 0.4 },
      }),
    );

    const queued = await analysis.requestAnalysis(ownerId, projectId, asset.id);
    expect(queued.analysisStatus).toBe(AnalysisStatus.QUEUED);
    const job = await jobs.get(queued.jobId);
    expect(job?.type).toBe(JobType.MEDIA_ANALYZE);

    await worker.processNext();
    const listed = await analysis.listForAsset(ownerId, projectId, asset.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.analysis?.analysisSchemaVersion).toBe("1.0");
    expect(listed[0]?.providerKey).toBe("test.vision");
    expect(listed[0]?.modelId).toBe("fake-1");
    expect(listed[0]?.status).toBe(AnalysisStatus.COMPLETED);
    const stored = await media.getOwnedAsset(ownerId, projectId, asset.id);
    expect(stored.analysisStatus).toBe(AnalysisStatus.COMPLETED);
    const attributions = await new AttributionService().listForProject(ownerId, projectId);
    expect(attributions.some((item) => item.assetId === asset.id && item.providerKey === "test.vision")).toBe(
      true,
    );
  });

  it("keeps previous analysis rows when re-analyzing", async () => {
    const asset = await media.ingest(ownerId, projectId, {
      filename: "again.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    const first = harness(observationsAdapter("test.one", { technical: { mimeType: "image/png" } }));
    await first.analysis.requestAnalysis(ownerId, projectId, asset.id);
    await first.worker.processNext();

    const second = harness(observationsAdapter("test.two", { technical: { mimeType: "image/png" } }));
    await second.analysis.requestAnalysis(ownerId, projectId, asset.id);
    await second.worker.processNext();

    const listed = await second.analysis.listForAsset(ownerId, projectId, asset.id);
    expect(listed.length).toBeGreaterThanOrEqual(2);
    expect(new Set(listed.map((row) => row.providerKey))).toEqual(new Set(["test.one", "test.two"]));
  });

  it("rejects a stranger requesting or reading analysis", async () => {
    const asset = await media.ingest(ownerId, projectId, {
      filename: "private.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    const { analysis } = harness(observationsAdapter("test.x", { technical: {} }));
    await expect(analysis.requestAnalysis(strangerId, projectId, asset.id)).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(analysis.listForAsset(strangerId, projectId, asset.id)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("records a failed analysis when the adapter throws", async () => {
    const asset = await media.ingest(ownerId, projectId, {
      filename: "fail.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    const { analysis, worker } = harness(
      observationsAdapter("test.fail", { technical: { mimeType: "image/png" } }, true),
    );
    await analysis.requestAnalysis(ownerId, projectId, asset.id);
    await worker.processNext();
    const stored = await media.getOwnedAsset(ownerId, projectId, asset.id);
    expect(stored.analysisStatus).toBe(AnalysisStatus.FAILED);
  });

  it("does not persist invalid adapter output as an analysis document", async () => {
    const asset = await media.ingest(ownerId, projectId, {
      filename: "invalid.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    const { analysis, worker } = harness(
      observationsAdapter("test.invalid", {
        technical: { width: "nope" },
      }),
    );
    await analysis.requestAnalysis(ownerId, projectId, asset.id);
    await worker.processNext();
    const listed = await analysis.listForAsset(ownerId, projectId, asset.id);
    const completed = listed.filter((row) => row.status === AnalysisStatus.COMPLETED);
    expect(completed).toHaveLength(0);
  });

  it("still persists local technical analysis", async () => {
    const asset = await media.ingest(ownerId, projectId, {
      filename: "local.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    const { analysis, worker } = harness(new LocalTechnicalAnalyzer());
    await analysis.requestAnalysis(ownerId, projectId, asset.id);
    await worker.processNext();
    const listed = await analysis.listForAsset(ownerId, projectId, asset.id);
    expect(listed[0]?.providerKey).toBe("youflicks.local.technical");
    expect(listed[0]?.status).toBe(AnalysisStatus.COMPLETED);
    expect(listed[0]?.analysis?.technical).toMatchObject({ mimeType: "image/png" });
    expect(listed[0]?.analysis?.visual).toBeUndefined();
  });

  it("fails the job when no ready adapter exists", async () => {
    const asset = await media.ingest(ownerId, projectId, {
      filename: "none.png",
      bytes: new Uint8Array(PNG_1X1),
    });
    const disabled: MediaAnalysisAdapter = {
      ...observationsAdapter("off", { technical: {} }),
      configured: false,
      enabled: false,
      health() {
        return {
          providerKey: "off",
          configured: false,
          enabled: false,
          available: false,
          capabilities: [AnalysisCapability.IMAGE_ANALYSIS],
        };
      },
    };
    const registry = new ProviderRegistry().register(disabled);
    const none = new AnalysisService(media, jobs, new RegistryMediaAnalyzer(registry));
    const workerNone = new AnalysisWorker(jobs, none);
    await none.requestAnalysis(ownerId, projectId, asset.id);
    await workerNone.processNext();
    const stored = await media.getOwnedAsset(ownerId, projectId, asset.id);
    expect(stored.analysisStatus).toBe(AnalysisStatus.FAILED);
  });
});
