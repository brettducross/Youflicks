import "server-only";

import { z } from "zod";
import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_VIDEO_BYTES } from "@/server/media/constants";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().min(1),
  STORAGE_DRIVER: z.enum(["local", "r2", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./storage"),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().default("auto"),
  STORAGE_S3_ENDPOINT: z.string().optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_S3_FORCE_PATH_STYLE: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((value) => value === "true" || value === "1"),
  /**
   * Temporary closed-beta invite gate. Unset is fail-closed in production.
   * Explicit false restores public free-tier signup.
   */
  BETA_INVITE_ONLY: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((value) => {
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
      return undefined;
    }),
  BETA_OPS_SECRET: z.string().optional(),
  EMAIL_DRIVER: z.enum(["log", "none"]).default("log"),
  AI_CONSENT_POLICY_VERSION: z.string().default("beta-ai-v1"),
  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  MEDIA_MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(DEFAULT_MAX_IMAGE_BYTES),
  MEDIA_MAX_VIDEO_BYTES: z.coerce.number().int().positive().default(DEFAULT_MAX_VIDEO_BYTES),
  ANALYSIS_PROVIDER: z.string().optional(),
  ANALYSIS_HTTP_PROVIDER_KEY: z.string().default("http.vision"),
  ANALYSIS_HTTP_BASE_URL: z.string().optional(),
  ANALYSIS_HTTP_API_KEY: z.string().optional(),
  ANALYSIS_HTTP_MODEL: z.string().optional(),
  ANALYSIS_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  DIRECTOR_HTTP_PROVIDER_KEY: z.string().default("http.director"),
  DIRECTOR_HTTP_BASE_URL: z.string().optional(),
  DIRECTOR_HTTP_API_KEY: z.string().optional(),
  DIRECTOR_HTTP_MODEL: z.string().optional(),
  DIRECTOR_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * Explicit opt-in for local/deterministic Director in development/test.
   * Forced false in production regardless of the env var value.
   */
  DIRECTOR_ALLOW_LOCAL: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((value) => value === "true" || value === "1"),
  STORY_HTTP_PROVIDER_KEY: z.string().default("http.story"),
  STORY_HTTP_BASE_URL: z.string().optional(),
  STORY_HTTP_API_KEY: z.string().optional(),
  STORY_HTTP_MODEL: z.string().optional(),
  STORY_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * Explicit opt-in for local/deterministic story composition in development/test.
   * Forced false in production regardless of the env var value.
   */
  STORY_ALLOW_LOCAL: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((value) => value === "true" || value === "1"),
  TIMELINE_HTTP_PROVIDER_KEY: z.string().default("http.timeline"),
  TIMELINE_HTTP_BASE_URL: z.string().optional(),
  TIMELINE_HTTP_API_KEY: z.string().optional(),
  TIMELINE_HTTP_MODEL: z.string().optional(),
  TIMELINE_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * Explicit opt-in for local/deterministic timeline composition in development/test.
   * Forced false in production regardless of the env var value.
   */
  TIMELINE_ALLOW_LOCAL: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((value) => value === "true" || value === "1"),
  ASSET_HTTP_PROVIDER_KEY: z.string().default("http.asset"),
  ASSET_HTTP_BASE_URL: z.string().optional(),
  ASSET_HTTP_API_KEY: z.string().optional(),
  ASSET_HTTP_MODEL: z.string().optional(),
  ASSET_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  /**
   * Optional comma-separated YouFlicks capability strings the HTTP adapter covers.
   * Empty means VIDEO_GENERATION only (honest R1). Add IMAGE_GENERATION
   * explicitly if the gateway covers stills. Do not list VOICE/MUSIC/SFX
   * unless a real adapter covers them.
   */
  ASSET_HTTP_CAPABILITIES: z.string().optional(),
  /**
   * Explicit opt-in for local/deterministic asset generation in development/test.
   * Forced false in production regardless of the env var value.
   */
  ASSET_ALLOW_LOCAL: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((value) => value === "true" || value === "1"),
  RENDER_HTTP_PROVIDER_KEY: z.string().default("http.renderer"),
  RENDER_HTTP_BASE_URL: z.string().optional(),
  RENDER_HTTP_API_KEY: z.string().optional(),
  RENDER_HTTP_MODEL: z.string().optional(),
  RENDER_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /**
   * Explicit opt-in for local/deterministic rendering in development/test.
   * Forced false in production regardless of the env var value.
   */
  RENDER_ALLOW_LOCAL: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((value) => value === "true" || value === "1"),
  /**
   * HMAC secret for SHARE_LINK tokens. When unset, BETTER_AUTH_SECRET is used.
   * Empty string disables share links (canShareLink = false).
   */
  SHARE_TOKEN_SECRET: z.string().optional(),
  /** Soft default SHARE_LINK TTL (7 days). Expiry is always required. */
  SHARE_LINK_TTL_MS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60 * 1000),
});

export type AppEnv = z.infer<typeof envSchema>;

function readEnv(): AppEnv {
  const parsed = envSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? "local",
    STORAGE_LOCAL_PATH: process.env.STORAGE_LOCAL_PATH ?? "./storage",
    STORAGE_S3_BUCKET: process.env.STORAGE_S3_BUCKET || undefined,
    STORAGE_S3_REGION: process.env.STORAGE_S3_REGION ?? "auto",
    STORAGE_S3_ENDPOINT: process.env.STORAGE_S3_ENDPOINT || undefined,
    STORAGE_S3_ACCESS_KEY_ID: process.env.STORAGE_S3_ACCESS_KEY_ID || undefined,
    STORAGE_S3_SECRET_ACCESS_KEY: process.env.STORAGE_S3_SECRET_ACCESS_KEY || undefined,
    STORAGE_S3_FORCE_PATH_STYLE: process.env.STORAGE_S3_FORCE_PATH_STYLE ?? "",
    BETA_INVITE_ONLY: process.env.BETA_INVITE_ONLY ?? "",
    BETA_OPS_SECRET: process.env.BETA_OPS_SECRET || undefined,
    EMAIL_DRIVER:
      process.env.EMAIL_DRIVER ?? (process.env.NODE_ENV === "production" ? "none" : "log"),
    AI_CONSENT_POLICY_VERSION: process.env.AI_CONSENT_POLICY_VERSION ?? "beta-ai-v1",
    SENTRY_DSN: process.env.SENTRY_DSN || undefined,
    LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
    MEDIA_MAX_IMAGE_BYTES: process.env.MEDIA_MAX_IMAGE_BYTES ?? DEFAULT_MAX_IMAGE_BYTES,
    MEDIA_MAX_VIDEO_BYTES: process.env.MEDIA_MAX_VIDEO_BYTES ?? DEFAULT_MAX_VIDEO_BYTES,
    ANALYSIS_PROVIDER: process.env.ANALYSIS_PROVIDER || undefined,
    ANALYSIS_HTTP_PROVIDER_KEY: process.env.ANALYSIS_HTTP_PROVIDER_KEY ?? "http.vision",
    ANALYSIS_HTTP_BASE_URL: process.env.ANALYSIS_HTTP_BASE_URL || undefined,
    ANALYSIS_HTTP_API_KEY: process.env.ANALYSIS_HTTP_API_KEY || undefined,
    ANALYSIS_HTTP_MODEL: process.env.ANALYSIS_HTTP_MODEL || undefined,
    ANALYSIS_HTTP_TIMEOUT_MS: process.env.ANALYSIS_HTTP_TIMEOUT_MS ?? 45_000,
    DIRECTOR_HTTP_PROVIDER_KEY: process.env.DIRECTOR_HTTP_PROVIDER_KEY ?? "http.director",
    DIRECTOR_HTTP_BASE_URL: process.env.DIRECTOR_HTTP_BASE_URL || undefined,
    DIRECTOR_HTTP_API_KEY: process.env.DIRECTOR_HTTP_API_KEY || undefined,
    DIRECTOR_HTTP_MODEL: process.env.DIRECTOR_HTTP_MODEL || undefined,
    DIRECTOR_HTTP_TIMEOUT_MS: process.env.DIRECTOR_HTTP_TIMEOUT_MS ?? 60_000,
    DIRECTOR_ALLOW_LOCAL: process.env.DIRECTOR_ALLOW_LOCAL ?? "",
    STORY_HTTP_PROVIDER_KEY: process.env.STORY_HTTP_PROVIDER_KEY ?? "http.story",
    STORY_HTTP_BASE_URL: process.env.STORY_HTTP_BASE_URL || undefined,
    STORY_HTTP_API_KEY: process.env.STORY_HTTP_API_KEY || undefined,
    STORY_HTTP_MODEL: process.env.STORY_HTTP_MODEL || undefined,
    STORY_HTTP_TIMEOUT_MS: process.env.STORY_HTTP_TIMEOUT_MS ?? 60_000,
    STORY_ALLOW_LOCAL: process.env.STORY_ALLOW_LOCAL ?? "",
    TIMELINE_HTTP_PROVIDER_KEY: process.env.TIMELINE_HTTP_PROVIDER_KEY ?? "http.timeline",
    TIMELINE_HTTP_BASE_URL: process.env.TIMELINE_HTTP_BASE_URL || undefined,
    TIMELINE_HTTP_API_KEY: process.env.TIMELINE_HTTP_API_KEY || undefined,
    TIMELINE_HTTP_MODEL: process.env.TIMELINE_HTTP_MODEL || undefined,
    TIMELINE_HTTP_TIMEOUT_MS: process.env.TIMELINE_HTTP_TIMEOUT_MS ?? 60_000,
    TIMELINE_ALLOW_LOCAL: process.env.TIMELINE_ALLOW_LOCAL ?? "",
    ASSET_HTTP_PROVIDER_KEY: process.env.ASSET_HTTP_PROVIDER_KEY ?? "http.asset",
    ASSET_HTTP_BASE_URL: process.env.ASSET_HTTP_BASE_URL || undefined,
    ASSET_HTTP_API_KEY: process.env.ASSET_HTTP_API_KEY || undefined,
    ASSET_HTTP_MODEL: process.env.ASSET_HTTP_MODEL || undefined,
    ASSET_HTTP_TIMEOUT_MS: process.env.ASSET_HTTP_TIMEOUT_MS ?? 90_000,
    ASSET_HTTP_CAPABILITIES: process.env.ASSET_HTTP_CAPABILITIES || undefined,
    ASSET_ALLOW_LOCAL: process.env.ASSET_ALLOW_LOCAL ?? "",
    RENDER_HTTP_PROVIDER_KEY: process.env.RENDER_HTTP_PROVIDER_KEY ?? "http.renderer",
    RENDER_HTTP_BASE_URL: process.env.RENDER_HTTP_BASE_URL || undefined,
    RENDER_HTTP_API_KEY: process.env.RENDER_HTTP_API_KEY || undefined,
    RENDER_HTTP_MODEL: process.env.RENDER_HTTP_MODEL || undefined,
    RENDER_HTTP_TIMEOUT_MS: process.env.RENDER_HTTP_TIMEOUT_MS ?? 120_000,
    RENDER_ALLOW_LOCAL: process.env.RENDER_ALLOW_LOCAL ?? "",
    SHARE_TOKEN_SECRET: process.env.SHARE_TOKEN_SECRET || undefined,
    SHARE_LINK_TTL_MS: process.env.SHARE_LINK_TTL_MS ?? 7 * 24 * 60 * 60 * 1000,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const data = parsed.data;
  if (data.NODE_ENV === "production" && data.DIRECTOR_ALLOW_LOCAL) {
    data.DIRECTOR_ALLOW_LOCAL = false;
  }
  if (data.NODE_ENV === "production" && data.STORY_ALLOW_LOCAL) {
    data.STORY_ALLOW_LOCAL = false;
  }
  if (data.NODE_ENV === "production" && data.TIMELINE_ALLOW_LOCAL) {
    data.TIMELINE_ALLOW_LOCAL = false;
  }
  if (data.NODE_ENV === "production" && data.ASSET_ALLOW_LOCAL) {
    data.ASSET_ALLOW_LOCAL = false;
  }
  if (data.NODE_ENV === "production" && data.RENDER_ALLOW_LOCAL) {
    data.RENDER_ALLOW_LOCAL = false;
  }
  const skipBootGuard =
    process.env.VITEST === "true" || process.env.NEXT_PHASE === "phase-production-build";
  if (!skipBootGuard && data.NODE_ENV === "production" && data.EMAIL_DRIVER === "log") {
    const inviteOnly =
      data.BETA_INVITE_ONLY === true || data.BETA_INVITE_ONLY === undefined;
    if (inviteOnly) {
      throw new Error(
        "Invalid environment configuration: EMAIL_DRIVER=log is not allowed in production beta. Use Path B invite pre-verify (EMAIL_DRIVER=none) or a real mailer.",
      );
    }
  }
  if (
    (data.STORAGE_DRIVER === "r2" || data.STORAGE_DRIVER === "s3") &&
    (!data.STORAGE_S3_BUCKET ||
      !data.STORAGE_S3_ACCESS_KEY_ID ||
      !data.STORAGE_S3_SECRET_ACCESS_KEY)
  ) {
    throw new Error(
      "Invalid environment configuration: STORAGE_DRIVER r2|s3 requires STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, and STORAGE_S3_SECRET_ACCESS_KEY.",
    );
  }
  return data;
}

export const env = readEnv();
