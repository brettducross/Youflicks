import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { StoryExecutionAttribution } from "@/server/adapters/story/attribution";
import { StoryCapability } from "@/server/ports/capabilities";
import type { StoryComposerPort } from "@/server/ports/story-composer";
import type { StoryComposerInput } from "@/server/story/input";
import type { StoryDocument } from "@/server/story/schema";
import { storyDocumentSchema } from "@/server/story/schema";

export type HttpStoryComposerConfig = {
  providerKey: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
};

/**
 * Replaceable HTTP story composer. Provider-neutral: any OpenAI-compatible
 * chat completions host. Configured only when URL, key, and model are set.
 * Attribution is adapter metadata — not part of StoryComposerPort.composeStory.
 */
export class HttpStoryComposerAdapter implements StoryComposerPort {
  readonly production = true as const;

  constructor(private readonly config: HttpStoryComposerConfig) {}

  get providerKey() {
    return this.config.providerKey;
  }

  get configured() {
    return Boolean(this.config.baseUrl && this.config.apiKey && this.config.model);
  }

  executionAttribution(): StoryExecutionAttribution {
    return {
      providerKey: this.providerKey,
      capability: StoryCapability.STORY_COMPOSITION,
      modelId: this.config.model ?? null,
      modelVersion: null,
    };
  }

  async composeStory(input: StoryComposerInput): Promise<StoryDocument> {
    if (!this.configured) {
      throw AppError.storyProviderUnavailable(
        "No production story composer adapter is configured.",
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
              content: STORY_SYSTEM_PROMPT,
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
        logger.error("story.http_failed", {
          providerKey: this.providerKey,
          status: response.status,
          body: redact(text, this.config.apiKey).slice(0, 500),
        });
        throw AppError.storyProviderUnavailable("The story composer adapter failed.");
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
        throw AppError.storyDocumentInvalid("The story composer adapter returned no story JSON.");
      }

      const parsed = storyDocumentSchema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.storyDocumentInvalid(
          "The story composer adapter returned a document outside the YouFlicks schema.",
          { issues: parsed.error.issues.map((issue) => issue.message) },
        );
      }

      return parsed.data;
    } catch (error) {
      if (isAppErrorLike(error)) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw AppError.storyProviderUnavailable("The story composer adapter timed out.");
      }
      throw AppError.storyProviderUnavailable(
        error instanceof Error ? error.message : "The story composer adapter failed.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

const STORY_SYSTEM_PROMPT = `You are the YouFlicks story composer. Return ONLY JSON matching StoryDocument schema v1:
{
  "schemaVersion": "1.0",
  "title"?: string,
  "logline"?: string,
  "spine": { "opening": string, "development": string, "resolution": string },
  "acts": [{
    "id": string,
    "order": number,
    "title"?: string,
    "purpose": string,
    "targetDurationMs"?: number,
    "scenes": [{
      "id": string,
      "order": number,
      "title"?: string,
      "purpose": string,
      "dramaticFunction": "exposition"|"inciting"|"development"|"turning"|"climax"|"resolution"|"motif"|"punctuation",
      "mood"?: string,
      "pacing"?: string,
      "mediaRoles": [{ "role": string, "purpose"?: string, "notes"?: string }],
      "voiceOverOutline"?: string,
      "dialogueOutline"?: string,
      "notes"?: string
    }]
  }],
  "source": { "creativePlanId": string, "creativePlanVersion": number, "planFingerprint"?: string },
  "rationale"?: string
}
Rules:
- Narrative structure only. No startMs, endMs, clip lists, tracks, transitions, render, codec, FFmpeg, or provider-host JSON.
- targetDurationMs is optional on acts only and is a narrative target, never editorial timing.
- mediaRoles describe roles media must play — not Timeline clip IDs.
- Copy source from the input CreativePlan identity.
- Respect priorStory when present (recomposition continuity). Do not invent a chat.
- Do not invent footage. Do not include sponsorship, billing, credentials, or user identity.`;

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
    throw AppError.storyDocumentInvalid("The story composer adapter did not return JSON.");
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw AppError.storyDocumentInvalid("The story composer adapter returned invalid JSON.");
  }
}

function isAppErrorLike(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AppError"
  );
}
