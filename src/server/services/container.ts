import "server-only";

import path from "node:path";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { registerConfiguredAdapters } from "@/server/analysis/provider-config";
import { ProviderRegistry } from "@/server/analysis/registry";
import { RegistryMediaAnalyzer } from "@/server/analysis/registry-analyzer";
import { PreferredThenFirstPolicy } from "@/server/analysis/selection";
import { DirectorCapabilityGateway } from "@/server/director/capabilities";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { JobQueuePort } from "@/server/ports/jobs";
import type { MediaAnalyzerPort } from "@/server/ports/media-analyzer";
import type { RendererPort } from "@/server/ports/renderer";
import type { StoragePort } from "@/server/ports/storage";
import { AnalysisService } from "@/server/services/analysis";
import { AnalysisWorker } from "@/server/services/analysis-worker";
import { AttributionService } from "@/server/services/attribution";
import { CreditsService } from "@/server/services/credits";
import { DirectorContractService } from "@/server/services/director-contract";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { SponsorshipService } from "@/server/services/sponsorship";
import { TasteService } from "@/server/services/taste";

export type ServiceContainer = {
  storage: StoragePort;
  jobs: JobQueuePort;
  projects: ProjectService;
  media: MediaService;
  analysis: AnalysisService;
  analysisWorker: AnalysisWorker;
  taste: TasteService;
  intent: IntentService;
  attribution: AttributionService;
  credits: CreditsService;
  sponsorship: SponsorshipService;
  director: DirectorContractService;
  providers: ProviderRegistry;
  mediaAnalyzer(): MediaAnalyzerPort;
  aiDirector(): AiDirectorPort;
  renderer(): RendererPort;
};

function createStorage(): StoragePort {
  if (env.STORAGE_DRIVER === "local") {
    return new LocalStorageAdapter(path.resolve(env.STORAGE_LOCAL_PATH));
  }
  throw AppError.providerNotConfigured("StoragePort");
}

function createServices(): ServiceContainer {
  const storage = createStorage();
  const jobs = new PostgresJobQueue();
  const projects = new ProjectService();
  const media = new MediaService(storage, projects, {
    maxImageBytes: env.MEDIA_MAX_IMAGE_BYTES,
    maxVideoBytes: env.MEDIA_MAX_VIDEO_BYTES,
  });

  const providers = registerConfiguredAdapters(new ProviderRegistry(), storage);
  const analyzer = new RegistryMediaAnalyzer(
    providers,
    new PreferredThenFirstPolicy(),
    env.ANALYSIS_PROVIDER ?? null,
  );
  const taste = new TasteService();
  const intent = new IntentService(projects, taste);
  const attribution = new AttributionService(projects);
  const sponsorship = new SponsorshipService();
  const credits = new CreditsService(projects, attribution, taste, sponsorship);
  const analysis = new AnalysisService(media, jobs, analyzer, projects, attribution);
  const analysisWorker = new AnalysisWorker(jobs, analysis);
  const director = new DirectorContractService(
    projects,
    taste,
    intent,
    media,
    analysis,
    new DirectorCapabilityGateway(providers, new PreferredThenFirstPolicy()),
  );

  return {
    storage,
    jobs,
    projects,
    media,
    analysis,
    analysisWorker,
    taste,
    intent,
    attribution,
    credits,
    sponsorship,
    director,
    providers,
    mediaAnalyzer() {
      return analyzer;
    },
    aiDirector() {
      throw AppError.providerNotConfigured("AiDirectorPort");
    },
    renderer() {
      throw AppError.providerNotConfigured("RendererPort");
    },
  };
}

const globalForServices = globalThis as unknown as {
  youflicksServices?: ServiceContainer;
};

export function getServices(): ServiceContainer {
  if (!globalForServices.youflicksServices) {
    globalForServices.youflicksServices = createServices();
  }
  return globalForServices.youflicksServices;
}
