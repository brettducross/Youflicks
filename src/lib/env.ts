import "server-only";

import { z } from "zod";
import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_VIDEO_BYTES } from "@/server/media/constants";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().min(1),
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./storage"),
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
   * Empty means all locked asset capabilities when the HTTP adapter is configured.
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
  return data;
}

export const env = readEnv();
