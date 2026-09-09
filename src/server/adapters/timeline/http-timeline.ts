import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { TimelineExecutionAttribution } from "@/server/adapters/timeline/attribution";
import { TimelineCapability } from "@/server/ports/capabilities";
import type { TimelineComposerPort } from "@/server/ports/timeline-composer";
import type { TimelineComposerInput } from "@/server/timeline/input";
import type { TimelineDocument } from "@/server/timeline/schema";
import { timelineDocumentSchema } from "@/server/timeline/schema";

export type HttpTimelineComposerConfig = {
  providerKey: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
};

/**
 * Replaceable HTTP timeline composer. Provider-neutral: any OpenAI-compatible
 * chat completions host. Configured only when URL, key, and model are set.
 * Attribution is adapter metadata — not part of TimelineComposerPort.composeTimeline.
 */
export class HttpTimelineComposerAdapter implements TimelineComposerPort {
  readonly production = true as const;

  constructor(private readonly config: HttpTimelineComposerConfig) {}

  get providerKey() {
    return this.config.providerKey;
  }

  get configured() {
    return Boolean(this.config.baseUrl && this.config.apiKey && this.config.model);
  }

  executionAttribution(): TimelineExecutionAttribution {
    return {
      providerKey: this.providerKey,
      capability: TimelineCapability.TIMELINE_COMPOSITION,
      modelId: this.config.model ?? null,
      modelVersion: null,
    };
  }

  async composeTimeline(input: TimelineComposerInput): Promise<TimelineDocument> {
    if (!this.configured) {
      throw AppError.timelineProviderUnavailable(
        "No production timeline composer adapter is configured.",
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
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: TIMELINE_SYSTEM_PROMPT,
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
        logger.error("timeline.http_failed", {
          providerKey: this.providerKey,
          status: response.status,
          body: redact(text, this.config.apiKey).slice(0, 500),
        });
        throw AppError.timelineProviderUnavailable("The timeline composer adapter failed.");
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
        throw AppError.timelineDocumentInvalid(
          "The timeline composer adapter returned no timeline JSON.",
        );
      }

      const parsed = timelineDocumentSchema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.timelineDocumentInvalid(
          "The timeline composer adapter returned a document outside the YouFlicks schema.",
          { issues: parsed.error.issues.map((issue) => issue.message) },
        );
      }

      return parsed.data;
    } catch (error) {
      if (isAppErrorLike(error)) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw AppError.timelineProviderUnavailable("The timeline composer adapter timed out.");
      }
      throw AppError.timelineProviderUnavailable(
        error instanceof Error ? error.message : "The timeline composer adapter failed.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

const TIMELINE_SYSTEM_PROMPT = `You are the YouFlicks timeline composer. Return ONLY JSON matching TimelineDocument schema v1:
{
  "schemaVersion": "1.0",
  "title"?: string,
  "totalDurationMs": number,
  "tracks": [{ "trackKey": "video.primary"|"audio.voice"|"audio.music"|"caption.main", "kind": "VIDEO"|"AUDIO"|"CAPTION", "label"?: string }],
  "clips": [{
    "id": string,
    "trackKey": "video.primary"|"audio.voice"|"audio.music"|"caption.main",
    "order": number,
    "assetId": string,
    "storySceneId"?: string,
    "mediaRole"?: string,
    "timelineStartMs": number,
    "timelineEndMs": number,
    "sourceInMs"?: number,
    "sourceOutMs"?: number,
    "transitionFromPrevious"?: "CUT"|"DISSOLVE"|"FADE",
    "captionText"?: string,
    "notes"?: string
  }],
  "unmetMediaRoles"?: [{ "role": string, "storySceneId"?: string, "reason"?: string }],
  "source": { "storyStructureId": string, "storyStructureVersion": number, "storyFingerprint"?: string },
  "rationale"?: string
}
Rules:
- Executable editorial cut only. Timing is legal here (timelineStartMs/timelineEndMs, source in/out).
- Place ONLY existing MediaAsset ids from mediaInventory. Never invent assets, never use GeneratedAsset ids, never emit clips with null/missing assetId.
- Unmet story mediaRoles go in unmetMediaRoles — not as placeholder clips.
- Track keys are the fixed YouFlicks vocabulary only. Light transitions only.
- captionText only on caption.main.
- Copy source from the input story identity.
- Respect priorTimeline when present (rebuild continuity of clip order / prior choices). Do not invent a chat.
- Do not include render, FFmpeg, VLC, sponsorship, billing, credentials, or user identity.`;

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
    throw AppError.timelineDocumentInvalid("The timeline composer adapter did not return JSON.");
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw AppError.timelineDocumentInvalid("The timeline composer adapter returned invalid JSON.");
  }
}

function isAppErrorLike(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AppError"
  );
}
