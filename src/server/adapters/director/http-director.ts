import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { DirectorExecutionAttribution } from "@/server/adapters/director/attribution";
import type { AiDirectorPort } from "@/server/ports/ai-director";
import type { DirectorInput } from "@/server/director/input";
import type { CreativePlan } from "@/server/director/schema";
import { creativePlanSchema } from "@/server/director/schema";
import { DirectorCapability } from "@/server/ports/capabilities";

export type HttpDirectorConfig = {
  providerKey: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
};

/**
 * Replaceable HTTP Director adapter. Provider-neutral: any OpenAI-compatible
 * chat completions host. Configured only when URL, key, and model are set.
 * This is the production-capable path when credentials exist.
 * Attribution is adapter metadata — not part of AiDirectorPort.composePlan.
 */
export class HttpDirectorAdapter implements AiDirectorPort {
  readonly production = true as const;

  constructor(private readonly config: HttpDirectorConfig) {}

  get providerKey() {
    return this.config.providerKey;
  }

  get configured() {
    return Boolean(this.config.baseUrl && this.config.apiKey && this.config.model);
  }

  executionAttribution(): DirectorExecutionAttribution {
    return {
      providerKey: this.providerKey,
      capability: DirectorCapability.STORY_REASONING,
      modelId: this.config.model ?? null,
      modelVersion: null,
    };
  }

  async composePlan(input: DirectorInput): Promise<CreativePlan> {
    if (!this.configured) {
      throw AppError.directorProviderUnavailable(
        "No production Director adapter is configured.",
      );
    }

    const baseUrl = this.config.baseUrl!.replace(/\/$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60_000);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: DIRECTOR_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: JSON.stringify(input),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        logger.error("director.http_failed", {
          providerKey: this.providerKey,
          status: response.status,
          body: redact(text, this.config.apiKey).slice(0, 500),
        });
        throw AppError.directorProviderUnavailable(
          "The Director capability adapter failed.",
        );
      }

      const payload = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      const raw =
        typeof content === "string"
          ? extractJsonObject(content)
          : content && typeof content === "object"
            ? content
            : null;
      if (!raw) {
        throw AppError.directorPlanInvalid("The Director adapter returned no plan JSON.");
      }

      const parsed = creativePlanSchema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.directorPlanInvalid(
          "The Director adapter returned a plan outside the YouFlicks schema.",
          { issues: parsed.error.issues.map((issue) => issue.message) },
        );
      }

      return parsed.data;
    } catch (error) {
      if (isAppErrorLike(error)) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw AppError.directorProviderUnavailable("The Director adapter timed out.");
      }
      throw AppError.directorProviderUnavailable(
        error instanceof Error ? error.message : "The Director adapter failed.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

const DIRECTOR_SYSTEM_PROMPT = `You are the YouFlicks AI Director. Return ONLY JSON matching the CreativePlan schema:
{
  "schemaVersion": "1.0",
  "concept": string,
  "objective": string,
  "tone": string,
  "emotionalArc": string,
  "narrativeApproach": string,
  "pacing": string,
  "visualDirection": string,
  "musicDirection": string,
  "voiceDirection": string,
  "mediaStrategy": string,
  "constraints": string[],
  "decisions": [{"kind": string, "subject"?: string, "summary": string, "detail"?: object}],
  "rationale": string
}
Rules:
- Meaning-level creative intent only. No clip cut lists, absolute timeline timings, render specs, or NLE instructions.
- Do not invent confidence values.
- Do not invent footage that is not in mediaInventory.
- Respect priorDecisions when present (recomposition continuity).
- Do not include sponsorship, billing, credentials, or user identity.`;

function redact(text: string, secret?: string) {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw AppError.directorPlanInvalid("The Director adapter did not return JSON.");
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw AppError.directorPlanInvalid("The Director adapter returned invalid JSON.");
  }
}

function isAppErrorLike(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AppError"
  );
}
