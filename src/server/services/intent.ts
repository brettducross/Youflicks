import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import { resolveEffectiveCreativeBrief } from "@/server/personalization/brief";
import type { CreativeIntentView } from "@/server/personalization/views";
import { ProjectService } from "@/server/services/projects";
import { TasteService } from "@/server/services/taste";

const intentSchema = z.object({
  purpose: z.string().trim().max(240).optional().nullable(),
  audience: z.string().trim().max(240).optional().nullable(),
  mood: z.string().trim().max(240).optional().nullable(),
  desiredDurationMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional().nullable(),
  narrativeStyle: z.string().trim().max(240).optional().nullable(),
  visualStyle: z.string().trim().max(240).optional().nullable(),
  musicStyle: z.string().trim().max(240).optional().nullable(),
  explicitInstructions: z.string().trim().max(2000).optional().nullable(),
  extras: z.record(z.string(), z.unknown()).optional().nullable(),
});

export type CreativeIntentInput = z.input<typeof intentSchema>;

export class IntentService {
  constructor(
    private readonly projects: ProjectService = new ProjectService(),
    private readonly taste: TasteService = new TasteService(),
  ) {}

  toView(row: {
    projectId: string;
    purpose: string | null;
    audience: string | null;
    mood: string | null;
    desiredDurationMs: number | null;
    narrativeStyle: string | null;
    visualStyle: string | null;
    musicStyle: string | null;
    explicitInstructions: string | null;
    extras: unknown;
  }): CreativeIntentView {
    return {
      projectId: row.projectId,
      purpose: row.purpose,
      audience: row.audience,
      mood: row.mood,
      desiredDurationMs: row.desiredDurationMs,
      narrativeStyle: row.narrativeStyle,
      visualStyle: row.visualStyle,
      musicStyle: row.musicStyle,
      explicitInstructions: row.explicitInstructions,
      extras: (row.extras as Record<string, unknown> | null) ?? null,
    };
  }

  empty(projectId: string): CreativeIntentView {
    return {
      projectId,
      purpose: null,
      audience: null,
      mood: null,
      desiredDurationMs: null,
      narrativeStyle: null,
      visualStyle: null,
      musicStyle: null,
      explicitInstructions: null,
      extras: null,
    };
  }

  async getForProject(userId: string, projectId: string) {
    await this.projects.getForUser(userId, projectId);
    const row = await prisma.projectCreativeIntent.findUnique({ where: { projectId } });
    return row ? this.toView(row) : this.empty(projectId);
  }

  async upsert(userId: string, projectId: string, input: CreativeIntentInput) {
    await this.projects.getForUser(userId, projectId);
    const parsed = intentSchema.safeParse(input);
    if (!parsed.success) {
      throw AppError.validation(parsed.error.issues[0]?.message ?? "Invalid creative intent.");
    }
    const data = parsed.data;
    const row = await prisma.projectCreativeIntent.upsert({
      where: { projectId },
      create: {
        projectId,
        purpose: data.purpose ?? null,
        audience: data.audience ?? null,
        mood: data.mood ?? null,
        desiredDurationMs: data.desiredDurationMs ?? null,
        narrativeStyle: data.narrativeStyle ?? null,
        visualStyle: data.visualStyle ?? null,
        musicStyle: data.musicStyle ?? null,
        explicitInstructions: data.explicitInstructions ?? null,
        extras: (data.extras ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      update: {
        purpose: data.purpose ?? null,
        audience: data.audience ?? null,
        mood: data.mood ?? null,
        desiredDurationMs: data.desiredDurationMs ?? null,
        narrativeStyle: data.narrativeStyle ?? null,
        visualStyle: data.visualStyle ?? null,
        musicStyle: data.musicStyle ?? null,
        explicitInstructions: data.explicitInstructions ?? null,
        extras: (data.extras ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    logger.info("intent.updated", { userId, projectId });
    return this.toView(row);
  }

  async resolveBrief(userId: string, projectId: string) {
    const [taste, intent] = await Promise.all([
      this.taste.getForUser(userId, userId),
      this.getForProject(userId, projectId),
    ]);
    return {
      taste,
      intent,
      effective: resolveEffectiveCreativeBrief(taste, intent),
    };
  }
}
