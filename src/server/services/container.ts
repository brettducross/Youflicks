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
import { resolveDirectorAdapter } from "@/server/director/provider-config";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { JobQueuePort } from "@/server/ports/jobs";
import type { MediaAnalyzerPort } from "@/server/ports/media-analyzer";
import type { RendererPort } from "@/server/ports/renderer";
import type { StoragePort } from "@/server/ports/storage";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import { resolveStoryComposerAdapter } from "@/server/story/provider-config";
import { AnalysisService } from "@/server/services/analysis";
import { AnalysisWorker } from "@/server/services/analysis-worker";
import { AttributionService } from "@/server/services/attribution";
import { CreditsService } from "@/server/services/credits";
import { DirectorContractService } from "@/server/services/director-contract";
import { DirectorService } from "@/server/services/director";
import { DirectorWorker } from "@/server/services/director-worker";
import { IntentService } from "@/server/services/intent";
import { MediaService } from "@/server/services/media";
import { ProjectService } from "@/server/services/projects";
import { SponsorshipService } from "@/server/services/sponsorship";
import { StoryContractService } from "@/server/services/story-contract";
import { StoryService } from "@/server/services/story";
import { StoryWorker } from "@/server/services/story-worker";
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
  directorService: DirectorService;
  directorWorker: DirectorWorker;
  story: StoryContractService;
  storyService: StoryService;
  storyWorker: StoryWorker;
  providers: ProviderRegistry;
  mediaAnalyzer(): MediaAnalyzerPort;
  aiDirector(): AiDirectorPort;
  storyComposer(): StoryComposerPort;
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

  const directorService = new DirectorService(
    jobs,
    director,
    projects,
    attribution,
    () => {
      const resolved = resolveDirectorAdapter();
      if (!resolved) return null;
      return { adapter: resolved.adapter, attribution: resolved.attribution };
    },
    () => {
      const resolved = resolveDirectorAdapter();
      return {
        productionAvailable: Boolean(resolved?.productionAvailable),
        localDevAvailable: Boolean(resolved?.localDevAvailable),
        canCompose: Boolean(resolved),
      };
    },
  );
  const directorWorker = new DirectorWorker(jobs, directorService);
  const story = new StoryContractService(projects, taste, intent, media);
  const storyService = new StoryService(
    jobs,
    story,
    projects,
    attribution,
    () => {
      const resolved = resolveStoryComposerAdapter();
      if (!resolved) return null;
      return { adapter: resolved.adapter, attribution: resolved.attribution };
    },
    () => {
      const resolved = resolveStoryComposerAdapter();
      return {
        productionAvailable: Boolean(resolved?.productionAvailable),
        localDevAvailable: Boolean(resolved?.localDevAvailable),
        canCompose: Boolean(resolved),
      };
    },
  );
  const storyWorker = new StoryWorker(jobs, storyService);

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
    directorService,
    directorWorker,
    story,
    storyService,
    storyWorker,
    providers,
    mediaAnalyzer() {
      return analyzer;
    },
    aiDirector() {
      const resolved = resolveDirectorAdapter();
      if (!resolved) {
        throw AppError.providerNotConfigured("AiDirectorPort");
      }
      return resolved.adapter;
    },
    storyComposer() {
      const resolved = resolveStoryComposerAdapter();
      if (!resolved) {
        throw AppError.providerNotConfigured("StoryComposerPort");
      }
      return resolved.adapter;
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
