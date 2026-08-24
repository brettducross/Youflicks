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
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}

export const env = readEnv();
