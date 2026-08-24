import "server-only";

import path from "node:path";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { LocalStorageAdapter } from "@/server/adapters/storage/local";
import { PostgresJobQueue } from "@/server/adapters/jobs/postgres";
import type { StoragePort } from "@/server/ports/storage";
import type { JobQueuePort } from "@/server/ports/jobs";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { MediaAnalyzerPort } from "@/server/ports/media-analyzer";
import type { RendererPort } from "@/server/ports/renderer";
import { ProjectService } from "@/server/services/projects";

export type ServiceContainer = {
  storage: StoragePort;
  jobs: JobQueuePort;
  projects: ProjectService;
  aiDirector(): AiDirectorPort;
  mediaAnalyzer(): MediaAnalyzerPort;
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

  return {
    storage,
    jobs,
    projects,
    aiDirector() {
      throw AppError.providerNotConfigured("AiDirectorPort");
    },
    mediaAnalyzer() {
      throw AppError.providerNotConfigured("MediaAnalyzerPort");
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
