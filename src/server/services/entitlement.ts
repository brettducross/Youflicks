import "server-only";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import { PrismaAbuseSignalAdapter } from "@/server/adapters/platform/prisma-abuse";
import { PrismaRateLimitAdapter } from "@/server/adapters/platform/prisma-rate-limit";
import {
  BillingPrepaidResolver,
  BillingSubscriptionResolver,
} from "@/server/billing/resolvers";
import type { PrepaidResolver, SubscriptionResolver } from "@/server/entitlement/resolvers";
import {
  ENTITLEMENT_SNAPSHOT_SCHEMA_VERSION,
  EntitlementDenyCode,
  FREE_MAX_OUTPUT_DURATION_MS,
  FREE_MOVIE_GENERATIONS_PER_HOUR,
  MOVIE_GENERATION_WINDOW_MS,
  MeterKind,
  PlanKind,
  type AuthorizeGenerationIntent,
  type AuthorizeGenerationResult,
  type EntitlementSnapshot,
  type EntitlementSummary,
  type GenerationConstraintReceipt,
  type GenerationConstraints,
  type PlatformGate,
  type PrepaidGrant,
  type RemainingQuota,
  type SubscriptionGrant,
} from "@/server/entitlement/types";
import type { AbuseSignalPort } from "@/server/ports/abuse-signal";
import type { EntitlementPort } from "@/server/ports/entitlement";
import type { RateLimitPort } from "@/server/ports/rate-limit";
import { AccountLifecycleService } from "@/server/services/account-lifecycle";

const DENY_MESSAGES: Record<(typeof EntitlementDenyCode)[keyof typeof EntitlementDenyCode], string> =
  {
    EMAIL_UNVERIFIED: "Verify your email before starting a movie.",
    RATE_LIMITED: "You can start one free movie each hour. Try again when the hour is up.",
    DURATION_EXCEEDS_PLAN: "Free movies can be at most 5 minutes long.",
    SUSPENDED: "This account cannot start a movie right now.",
    INSUFFICIENT_CREDITS: "This account does not have enough credits to start a movie.",
  };

export class EntitlementService implements EntitlementPort {
  constructor(
    private readonly accounts: AccountLifecycleService = new AccountLifecycleService(),
    private readonly subscriptions: SubscriptionResolver = new BillingSubscriptionResolver(),
    private readonly prepaid: PrepaidResolver = new BillingPrepaidResolver(),
    private readonly rateLimit: RateLimitPort = new PrismaRateLimitAdapter(),
    private readonly abuse: AbuseSignalPort = new PrismaAbuseSignalAdapter(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(userId: string): Promise<EntitlementSnapshot> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw AppError.notFound("That account was not found.");
    }
    const [subscriptionGrants, prepaidGrants] = await Promise.all([
      this.subscriptions.resolve(userId),
      this.prepaid.resolve(userId),
    ]);
    return mergeSnapshot(userId, subscriptionGrants, prepaidGrants, this.now());
  }

  async getPlatformGate(userId: string): Promise<PlatformGate> {
    const account = await this.accounts.getAccountGate(userId);
    if (!account.emailVerified) {
      return {
        userId,
        emailVerified: false,
        canGenerate: false,
        denyCode: EntitlementDenyCode.EMAIL_UNVERIFIED,
      };
    }
    if (await this.abuse.isQuarantined(userId)) {
      return {
        userId,
        emailVerified: true,
        canGenerate: false,
        denyCode: EntitlementDenyCode.SUSPENDED,
      };
    }
    const snapshot = await this.resolve(userId);
    const used = await this.countMovieGenerations(userId);
    if (used >= snapshot.movieGenerationsPerHour) {
      return {
        userId,
        emailVerified: true,
        canGenerate: false,
        denyCode: EntitlementDenyCode.RATE_LIMITED,
      };
    }
    return {
      userId,
      emailVerified: true,
      canGenerate: true,
      denyCode: null,
    };
  }

  async authorizeGeneration(
    userId: string,
    intent: AuthorizeGenerationIntent = {},
  ): Promise<AuthorizeGenerationResult> {
    const account = await this.accounts.getAccountGate(userId);
    if (!account.emailVerified) {
      return this.deny(userId, EntitlementDenyCode.EMAIL_UNVERIFIED);
    }

    const snapshot = await this.resolve(userId);
    const requestedMaxDurationMs = await this.resolveRequestedDuration(intent);
    if (
      requestedMaxDurationMs != null &&
      requestedMaxDurationMs > snapshot.maxOutputDurationMs
    ) {
      return this.deny(userId, EntitlementDenyCode.DURATION_EXCEEDS_PLAN);
    }

    return this.consumeMovieGeneration(userId, snapshot, intent.projectId);
  }

  async requireGeneration(userId: string, intent: AuthorizeGenerationIntent = {}) {
    const decision = await this.authorizeGeneration(userId, intent);
    if (!decision.allowed) {
      throw denyToError(decision.code, decision.message);
    }
    return decision;
  }

  async getEntitlementSummary(userId: string): Promise<EntitlementSummary> {
    const snapshot = await this.resolve(userId);
    const used = await this.countMovieGenerations(userId);
    return {
      watermarkRequired: snapshot.watermarkRequired,
      adsEnabled: snapshot.adsEnabled,
      maxOutputDurationMs: snapshot.maxOutputDurationMs,
      remainingMovieGenerations: Math.max(0, snapshot.movieGenerationsPerHour - used),
    };
  }

  async policyConstraints(userId: string, projectId?: string): Promise<GenerationConstraints> {
    const receipt = await this.latestConstraintReceipt(userId, projectId);
    if (receipt) {
      return {
        maxOutputDurationMs: receipt.maxOutputDurationMs,
        watermarkRequired: receipt.watermarkRequired,
        adsEnabled: receipt.adsEnabled,
      };
    }
    return constraintsFrom(await this.resolve(userId));
  }

  async latestConstraintReceipt(
    userId: string,
    projectId?: string,
  ): Promise<GenerationConstraintReceipt | null> {
    const row = projectId
      ? ((await prisma.generationAuthorization.findFirst({
          where: {
            userId,
            projectId,
            maxOutputDurationMs: { not: null },
          },
          orderBy: { recordedAt: "desc" },
        })) ??
        (await prisma.generationAuthorization.findFirst({
          where: {
            userId,
            maxOutputDurationMs: { not: null },
          },
          orderBy: { recordedAt: "desc" },
        })))
      : await prisma.generationAuthorization.findFirst({
          where: {
            userId,
            maxOutputDurationMs: { not: null },
          },
          orderBy: { recordedAt: "desc" },
        });
    if (
      !row ||
      row.maxOutputDurationMs == null ||
      row.watermarkRequired == null ||
      row.adsEnabled == null
    ) {
      return null;
    }
    return {
      userId: row.userId,
      projectId: row.projectId,
      maxOutputDurationMs: row.maxOutputDurationMs,
      watermarkRequired: row.watermarkRequired,
      adsEnabled: row.adsEnabled,
      recordedAt: row.recordedAt.toISOString(),
    };
  }

  async assertOutputDuration(
    userId: string,
    durationMs: number | null | undefined,
    projectId?: string,
  ) {
    const constraints = await this.policyConstraints(userId, projectId);
    if (durationMs == null) {
      throw AppError.outputDurationUnknown();
    }
    if (durationMs > constraints.maxOutputDurationMs) {
      throw AppError.durationExceedsPlan();
    }
  }

  async setQuarantined(userId: string, quarantined: boolean, reason?: string | null) {
    await this.abuse.setQuarantined(userId, quarantined, reason);
  }

  private async resolveRequestedDuration(intent: AuthorizeGenerationIntent) {
    if (intent.requestedMaxDurationMs != null) {
      return intent.requestedMaxDurationMs;
    }
    if (!intent.projectId) {
      return undefined;
    }
    const row = await prisma.projectCreativeIntent.findUnique({
      where: { projectId: intent.projectId },
      select: { desiredDurationMs: true },
    });
    return row?.desiredDurationMs ?? undefined;
  }

  private async countMovieGenerations(userId: string) {
    return this.rateLimit.countInWindow(
      userId,
      MeterKind.MOVIE_GENERATION,
      new Date(this.now().getTime() - MOVIE_GENERATION_WINDOW_MS),
    );
  }

  private async consumeMovieGeneration(
    userId: string,
    snapshot: EntitlementSnapshot,
    projectId?: string,
  ): Promise<AuthorizeGenerationResult> {
    const recordedAt = this.now();
    const since = new Date(recordedAt.getTime() - MOVIE_GENERATION_WINDOW_MS);

    const decision = await prisma.$transaction(async (tx) => {
      await tx.accountPlatformState.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      await tx.$executeRaw`SELECT 1 FROM "account_platform_state" WHERE "userId" = ${userId} FOR UPDATE`;

      const state = await tx.accountPlatformState.findUniqueOrThrow({
        where: { userId },
        select: { quarantined: true },
      });
      if (state.quarantined) {
        return { kind: "deny" as const, code: EntitlementDenyCode.SUSPENDED };
      }

      const used = await tx.generationAuthorization.count({
        where: {
          userId,
          kind: MeterKind.MOVIE_GENERATION,
          recordedAt: { gte: since },
        },
      });
      if (used >= snapshot.movieGenerationsPerHour) {
        return { kind: "deny" as const, code: EntitlementDenyCode.RATE_LIMITED };
      }

      await tx.generationAuthorization.create({
        data: {
          userId,
          kind: MeterKind.MOVIE_GENERATION,
          projectId: projectId ?? null,
          recordedAt,
          maxOutputDurationMs: snapshot.maxOutputDurationMs,
          watermarkRequired: snapshot.watermarkRequired,
          adsEnabled: snapshot.adsEnabled,
        },
      });
      return { kind: "allow" as const, used: used + 1 };
    });

    if (decision.kind === "deny") {
      return this.deny(userId, decision.code);
    }

    const remaining = Math.max(0, snapshot.movieGenerationsPerHour - decision.used);
    const remainingQuota = await this.remainingQuota(userId, snapshot, remaining);
    logger.info("entitlement.generation_authorized", {
      userId,
      kind: MeterKind.MOVIE_GENERATION,
      remaining: remainingQuota.remaining,
    });
    return {
      allowed: true,
      snapshot,
      remainingQuota,
      constraints: constraintsFrom(snapshot),
    };
  }

  private async remainingQuota(
    userId: string,
    snapshot: EntitlementSnapshot,
    remaining: number,
  ): Promise<RemainingQuota> {
    const since = new Date(this.now().getTime() - MOVIE_GENERATION_WINDOW_MS);
    const oldest = await prisma.generationAuthorization.findFirst({
      where: {
        userId,
        kind: MeterKind.MOVIE_GENERATION,
        recordedAt: { gte: since },
      },
      orderBy: { recordedAt: "asc" },
      select: { recordedAt: true },
    });
    return {
      kind: MeterKind.MOVIE_GENERATION,
      remaining,
      limit: snapshot.movieGenerationsPerHour,
      windowMs: MOVIE_GENERATION_WINDOW_MS,
      windowResetsAt: oldest
        ? new Date(oldest.recordedAt.getTime() + MOVIE_GENERATION_WINDOW_MS).toISOString()
        : null,
    };
  }

  private deny(
    userId: string,
    code: (typeof EntitlementDenyCode)[keyof typeof EntitlementDenyCode],
  ): AuthorizeGenerationResult {
    logger.info("entitlement.generation_denied", { userId, code });
    return {
      allowed: false,
      code,
      message: DENY_MESSAGES[code],
    };
  }
}

export function denyToError(code: string, message: string) {
  switch (code) {
    case EntitlementDenyCode.EMAIL_UNVERIFIED:
      return AppError.emailUnverified(message);
    case EntitlementDenyCode.RATE_LIMITED:
      return AppError.rateLimited(message);
    case EntitlementDenyCode.DURATION_EXCEEDS_PLAN:
      return AppError.durationExceedsPlan(message);
    case EntitlementDenyCode.SUSPENDED:
      return AppError.suspended(message);
    case EntitlementDenyCode.INSUFFICIENT_CREDITS:
      return AppError.insufficientCredits(message);
    default:
      return AppError.forbidden(message);
  }
}

function constraintsFrom(snapshot: EntitlementSnapshot): GenerationConstraints {
  return {
    maxOutputDurationMs: snapshot.maxOutputDurationMs,
    watermarkRequired: snapshot.watermarkRequired,
    adsEnabled: snapshot.adsEnabled,
  };
}

export function mergeSnapshot(
  userId: string,
  subscriptions: SubscriptionGrant[],
  prepaid: PrepaidGrant[],
  resolvedAt: Date,
): EntitlementSnapshot {
  if (subscriptions.length === 0 && prepaid.length === 0) {
    return {
      schemaVersion: ENTITLEMENT_SNAPSHOT_SCHEMA_VERSION,
      userId,
      planKind: PlanKind.FREE,
      movieGenerationsPerHour: FREE_MOVIE_GENERATIONS_PER_HOUR,
      maxOutputDurationMs: FREE_MAX_OUTPUT_DURATION_MS,
      watermarkRequired: true,
      adsEnabled: true,
      resolvedAt: resolvedAt.toISOString(),
    };
  }

  const planKind =
    subscriptions.length > 0 && prepaid.length > 0
      ? PlanKind.HYBRID
      : subscriptions.length > 0
        ? PlanKind.SUBSCRIPTION
        : PlanKind.PREPAID;

  const rates = [
    ...subscriptions.map((grant) => grant.movieGenerationsPerHour),
    ...prepaid.map((grant) => grant.movieGenerationsPerHour),
  ].filter((value): value is number => value != null);
  const durations = [
    ...subscriptions.map((grant) => grant.maxOutputDurationMs),
    ...prepaid.map((grant) => grant.maxOutputDurationMs),
  ].filter((value): value is number => value != null);
  const watermarkFlags = [
    ...subscriptions.map((grant) => grant.watermarkRequired),
    ...prepaid.map((grant) => grant.watermarkRequired),
  ].filter((value): value is boolean => value != null);
  const adsFlags = [
    ...subscriptions.map((grant) => grant.adsEnabled),
    ...prepaid.map((grant) => grant.adsEnabled),
  ].filter((value): value is boolean => value != null);

  return {
    schemaVersion: ENTITLEMENT_SNAPSHOT_SCHEMA_VERSION,
    userId,
    planKind,
    movieGenerationsPerHour: rates.length > 0 ? Math.max(...rates) : FREE_MOVIE_GENERATIONS_PER_HOUR,
    maxOutputDurationMs: durations.length > 0 ? Math.max(...durations) : FREE_MAX_OUTPUT_DURATION_MS,
    watermarkRequired: watermarkFlags.length > 0 ? watermarkFlags.every(Boolean) : true,
    adsEnabled: adsFlags.length > 0 ? adsFlags.every(Boolean) : true,
    resolvedAt: resolvedAt.toISOString(),
  };
}
