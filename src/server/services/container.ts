import "server-only";

import path from "node:path";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
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
import type { PlaybackPort } from "@/server/ports/playback";
import type { RendererPort } from "@/server/ports/renderer";
import type { StoragePort } from "@/server/ports/storage";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import type { TimelineComposerPort } from "@/server/ports/timeline-composer";
import type { AssetGeneratorPort } from "@/server/ports/asset-generator";
import { resolveAssetGeneratorAdapter, describeAssetAvailability } from "@/server/assets/provider-config";
import { resolveRendererAdapter, describeRenderAvailability } from "@/server/render/provider-config";
import { resolveStoryComposerAdapter } from "@/server/story/provider-config";
import { resolveTimelineComposerAdapter } from "@/server/timeline/provider-config";
import { AccountLifecycleService } from "@/server/services/account-lifecycle";
import { EntitlementService } from "@/server/services/entitlement";
import { AssetContractService } from "@/server/services/asset-contract";
import { AssetService } from "@/server/services/asset";
import { AssetWorker } from "@/server/services/asset-worker";
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
import { TimelineContractService } from "@/server/services/timeline-contract";
import { TimelineService } from "@/server/services/timeline";
import { TimelineWorker } from "@/server/services/timeline-worker";
import { WebMediaPlaybackAdapter } from "@/server/adapters/playback/web-media";
import { VlcPlaybackAdapter } from "@/server/adapters/playback/vlc";
import { PlaybackSessionStore } from "@/server/playback/sessions";
import { RenderContractService } from "@/server/services/render-contract";
import { RenderService } from "@/server/services/render";
import { RenderWorker } from "@/server/services/render-worker";
import { PlaybackService } from "@/server/services/playback";
import { MovieService } from "@/server/services/movie";
import { MovieWorker } from "@/server/services/movie-worker";
import { PublicationAdapterRegistry } from "@/server/adapters/publication/registry";
import { ShareTokenStore } from "@/server/publication/tokens";
import { PublicationService } from "@/server/services/publication";
import { PublicationWorker } from "@/server/services/publication-worker";
import type { PublicationPort } from "@/server/ports/publication";

export type ServiceContainer = {
  storage: StoragePort;
  jobs: JobQueuePort;
  accountLifecycle: AccountLifecycleService;
  entitlements: EntitlementService;
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
  timeline: TimelineContractService;
  timelineService: TimelineService;
  timelineWorker: TimelineWorker;
  assets: AssetContractService;
  assetService: AssetService;
  assetWorker: AssetWorker;
  render: RenderContractService;
  renderService: RenderService;
  renderWorker: RenderWorker;
  playbackService: PlaybackService;
  movieService: MovieService;
  movieWorker: MovieWorker;
  publicationService: PublicationService;
  publicationWorker: PublicationWorker;
  providers: ProviderRegistry;
  mediaAnalyzer(): MediaAnalyzerPort;
  aiDirector(): AiDirectorPort;
  storyComposer(): StoryComposerPort;
  timelineComposer(): TimelineComposerPort;
  assetGenerator(): AssetGeneratorPort;
  renderer(): RendererPort;
  playback(): PlaybackPort;
  publication(): PublicationPort;
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

  const accountLifecycle = new AccountLifecycleService(async ({ email }) => {
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: "/verify-email" },
      headers: await headers(),
    });
  });
  const entitlements = new EntitlementService(accountLifecycle);
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
    entitlements,
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
  const timeline = new TimelineContractService(projects, taste, intent, media, analysis);
  const timelineService = new TimelineService(
    jobs,
    timeline,
    projects,
    attribution,
    () => {
      const resolved = resolveTimelineComposerAdapter();
      if (!resolved) return null;
      return { adapter: resolved.adapter, attribution: resolved.attribution };
    },
    () => {
      const resolved = resolveTimelineComposerAdapter();
      return {
        productionAvailable: Boolean(resolved?.productionAvailable),
        localDevAvailable: Boolean(resolved?.localDevAvailable),
        canCompose: Boolean(resolved),
      };
    },
  );
  const timelineWorker = new TimelineWorker(jobs, timelineService);
  const assets = new AssetContractService(projects, taste, intent);
  const assetService = new AssetService(
    jobs,
    storage,
    assets,
    projects,
    attribution,
    () => {
      const resolved = resolveAssetGeneratorAdapter(storage);
      if (!resolved) return null;
      return {
        adapter: resolved.adapter,
        attributionFor: resolved.attributionFor,
        supportedCapabilities: resolved.supportedCapabilities,
      };
    },
    () => describeAssetAvailability(resolveAssetGeneratorAdapter(storage)),
  );
  const assetWorker = new AssetWorker(jobs, assetService);
  const render = new RenderContractService(projects, storage);
  const renderService = new RenderService(
    jobs,
    storage,
    render,
    projects,
    attribution,
    () => {
      const resolved = resolveRendererAdapter(storage);
      if (!resolved) return null;
      return { adapter: resolved.adapter, attribution: resolved.attribution };
    },
    () => describeRenderAvailability(resolveRendererAdapter(storage)),
  );
  const renderWorker = new RenderWorker(jobs, renderService);
  const playbackSessions = new PlaybackSessionStore(env.BETTER_AUTH_SECRET);
  const webPlayback = new WebMediaPlaybackAdapter(playbackSessions);
  const vlcPlayback = new VlcPlaybackAdapter(playbackSessions);
  const shareSecret = env.SHARE_TOKEN_SECRET?.trim() || env.BETTER_AUTH_SECRET;
  const shareTokens = new ShareTokenStore(shareSecret, () => Date.now(), env.SHARE_LINK_TTL_MS);
  const publicationAdapters = new PublicationAdapterRegistry();
  const publicationService = new PublicationService(
    jobs,
    storage,
    projects,
    publicationAdapters,
    shareTokens,
    {
      publicOrigin: env.BETTER_AUTH_URL,
      shareTokenConfigured: () => shareTokens.configured,
    },
  );
  const publicationWorker = new PublicationWorker(jobs, publicationService);
  const playbackService = new PlaybackService(
    storage,
    projects,
    playbackSessions,
    webPlayback,
    vlcPlayback,
    () => vlcPlayback.available(),
    publicationService,
  );
  const movieService = new MovieService(jobs, storage, projects, () => true);
  const movieWorker = new MovieWorker(jobs, movieService);

  return {
    storage,
    jobs,
    accountLifecycle,
    entitlements,
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
    timeline,
    timelineService,
    timelineWorker,
    assets,
    assetService,
    assetWorker,
    render,
    renderService,
    renderWorker,
    playbackService,
    movieService,
    movieWorker,
    publicationService,
    publicationWorker,
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
    timelineComposer() {
      const resolved = resolveTimelineComposerAdapter();
      if (!resolved) {
        throw AppError.providerNotConfigured("TimelineComposerPort");
      }
      return resolved.adapter;
    },
    assetGenerator() {
      const resolved = resolveAssetGeneratorAdapter(storage);
      if (!resolved) {
        throw AppError.providerNotConfigured("AssetGeneratorPort");
      }
      return resolved.adapter;
    },
    renderer() {
      const resolved = resolveRendererAdapter(storage);
      if (!resolved) {
        throw AppError.providerNotConfigured("RendererPort");
      }
      return resolved.adapter;
    },
    playback() {
      return webPlayback;
    },
    publication() {
      return publicationAdapters.get("DOWNLOAD");
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
