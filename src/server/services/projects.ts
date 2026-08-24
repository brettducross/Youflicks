import "server-only";

import { z } from "zod";
import { prisma } from "@/server/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { ProjectStatus } from "@/server/domain/status";

const createProjectSchema = z.object({
  title: z.string().trim().min(1, "Give the film a title.").max(120),
  logline: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;

export class ProjectService {
  async listForUser(userId: string) {
    return prisma.project.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: "desc" },
    });
  }

  async getForUser(userId: string, projectId: string) {
    const project = await this.findForUser(userId, projectId);
    if (!project) {
      throw AppError.notFound("That project does not exist.");
    }
    return project;
  }

  async findForUser(userId: string, projectId: string) {
    return prisma.project.findFirst({
      where: { id: projectId, ownerId: userId },
    });
  }

  async create(userId: string, input: CreateProjectInput) {
    const parsed = createProjectSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw AppError.validation(first?.message ?? "Invalid project.", {
        issues: parsed.error.issues,
      });
    }

    const project = await prisma.project.create({
      data: {
        ownerId: userId,
        title: parsed.data.title,
        logline: parsed.data.logline,
        status: ProjectStatus.DRAFT,
      },
    });

    logger.info("projects.create", { userId, projectId: project.id });
    return project;
  }

  async countForUser(userId: string) {
    return prisma.project.count({ where: { ownerId: userId } });
  }
}
