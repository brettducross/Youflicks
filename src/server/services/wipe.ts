import "server-only";

import { logger } from "@/lib/logger";
import { reportOpsAlert, OpsAlertKind } from "@/lib/ops-alerts";
import { prisma } from "@/server/db";
import type { StoragePort } from "@/server/ports/storage";
import { ProjectService } from "@/server/services/projects";

export type WipeResult = {
  deletedProjectIds: string[];
  storageKeysAttempted: number;
  storageKeysDeleted: number;
};

/**
 * M8.8-lite project / account delete + StoragePort GC.
 * Not a full PrivacyLifecyclePort.
 */
export class WipeService {
  constructor(
    private readonly storage: StoragePort,
    private readonly projects: ProjectService = new ProjectService(),
  ) {}

  async deleteProject(userId: string, projectId: string): Promise<WipeResult> {
    await this.projects.getForUser(userId, projectId);
    const keys = await collectProjectStorageKeys(projectId);
    await prisma.project.delete({ where: { id: projectId } });
    const storageKeysDeleted = await this.deleteKeys(keys);
    logger.info("wipe.project_deleted", {
      userId,
      projectId,
      storageKeysAttempted: keys.length,
      storageKeysDeleted,
    });
    return {
      deletedProjectIds: [projectId],
      storageKeysAttempted: keys.length,
      storageKeysDeleted,
    };
  }

  async deleteAccount(userId: string): Promise<WipeResult> {
    const projects = await prisma.project.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });
    const keys: string[] = [];
    for (const project of projects) {
      keys.push(...(await collectProjectStorageKeys(project.id)));
    }
    await prisma.user.delete({ where: { id: userId } });
    const storageKeysDeleted = await this.deleteKeys(keys);
    logger.info("wipe.account_deleted", {
      userId,
      projects: projects.length,
      storageKeysAttempted: keys.length,
      storageKeysDeleted,
    });
    return {
      deletedProjectIds: projects.map((project) => project.id),
      storageKeysAttempted: keys.length,
      storageKeysDeleted,
    };
  }

  private async deleteKeys(keys: string[]) {
    let deleted = 0;
    for (const key of keys) {
      try {
        await this.storage.delete(key);
        deleted += 1;
      } catch (error) {
        await reportOpsAlert({
          kind: OpsAlertKind.STORAGE_ERROR,
          message: "Storage GC failed during wipe.",
          context: {
            key,
            error: error instanceof Error ? error.message : "unknown",
          },
        });
      }
    }
    return deleted;
  }
}

export async function collectProjectStorageKeys(projectId: string): Promise<string[]> {
  const [media, generated, renders, movies] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: { projectId },
      select: { storageKey: true, previewKey: true },
    }),
    prisma.generatedAsset.findMany({
      where: { projectId },
      select: { storageKey: true, previewKey: true },
    }),
    prisma.renderJob.findMany({
      where: { projectId },
      select: { outputKey: true },
    }),
    prisma.finishedMovie.findMany({
      where: { projectId },
      select: { storageKey: true },
    }),
  ]);
  const keys = new Set<string>();
  for (const row of media) {
    if (row.storageKey) keys.add(row.storageKey);
    if (row.previewKey) keys.add(row.previewKey);
  }
  for (const row of generated) {
    if (row.storageKey) keys.add(row.storageKey);
    if (row.previewKey) keys.add(row.previewKey);
  }
  for (const row of renders) {
    if (row.outputKey) keys.add(row.outputKey);
  }
  for (const row of movies) {
    if (row.storageKey) keys.add(row.storageKey);
  }
  return [...keys];
}
