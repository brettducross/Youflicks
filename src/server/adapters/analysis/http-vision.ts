import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { loadVisualObject } from "@/server/analysis/media-access";
import { AnalysisCapability } from "@/server/ports/capabilities";
import type {
  AdapterAnalyzeResult,
  AdapterHealth,
  MediaAnalysisAdapter,
} from "@/server/ports/media-analysis-adapter";
import type { AnalyzeMediaInput } from "@/server/ports/media-analyzer";
import type { StoragePort } from "@/server/ports/storage";

export type HttpVisionConfig = {
  providerKey: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
};

type ChatCompletionResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: unknown } }>;
};

const OBSERVATION_INSTRUCTIONS = `Return ONLY JSON for a YouFlicks media analysis observation object.
Use this shape when you can observe something; omit keys you cannot support:
{
  "visual": {
    "sceneDescription": string,
    "objects": string[],
    "environments": string[],
    "locations": string[],
    "activities": string[],
    "visualQuality": string,
    "composition": string,
    "cameraMovement": string,
    "estimatedImportance": number,
    "confidence": number
  },
  "people": {
    "count": number,
    "people": [{"anonymousPersonId":"p1","faceDetected":true,"confidence":number,"positionHint":string}],
    "confidence": number
  },
  "quality": {
    "overall": number,
    "blur": number,
    "exposure": number,
    "technicallyUsable": boolean,
    "editorialUsefulness": number
  }
}
Rules:
- Confidence values must be between 0 and 1 inclusive.
- Do not invent people, objects, or scores you cannot see.
- Do not infer identity, names, race, religion, health, or other sensitive attributes.
- Do not include markdown or extra prose.`;

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
    throw AppError.invalidAnalysis("The vision adapter did not return JSON observations.");
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw AppError.invalidAnalysis("The vision adapter returned invalid JSON observations.");
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

/**
 * HTTP vision adapter. Talks to any chat-completions host that accepts
 * multimodal image_url parts. The host is configuration, not the domain.
 * Bytes come from StoragePort — never from a filesystem path.
 */
export class HttpVisionAdapter implements MediaAnalysisAdapter {
  readonly capabilities = [
    AnalysisCapability.IMAGE_ANALYSIS,
    AnalysisCapability.VISION,
    AnalysisCapability.VIDEO_ANALYSIS,
  ] as const;
  readonly routing = {
    quality: 0.7,
    cost: 0.4,
    latency: 0.5,
    reliability: 0.6,
    qualityTier: "standard" as const,
    estimatedCost: 0.01,
    estimatedLatency: 4000,
  };

  constructor(
    private readonly storage: StoragePort,
    private readonly config: HttpVisionConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get providerKey() {
    return this.config.providerKey;
  }

  get configured() {
    return Boolean(this.config.baseUrl?.trim() && this.config.apiKey?.trim() && this.config.model?.trim());
  }

  get enabled() {
    return this.configured;
  }

  health(): AdapterHealth {
    return {
      providerKey: this.providerKey,
      configured: this.configured,
      enabled: this.enabled,
      available: this.configured,
      capabilities: this.capabilities,
      routing: this.routing,
    };
  }

  async analyze(input: AnalyzeMediaInput): Promise<AdapterAnalyzeResult> {
    if (!this.configured) {
      throw AppError.providerNotConfigured(this.providerKey);
    }
    if (input.kind === "VIDEO" && !input.previewStorageKey) {
      throw AppError.unsupportedMedia(
        "Video analysis through the HTTP vision adapter needs a stored poster.",
      );
    }

    const object = await loadVisualObject(this.storage, input);
    const mime = object.contentType.startsWith("image/")
      ? object.contentType
      : input.kind === "VIDEO"
        ? "image/jpeg"
        : input.mimeType;
    const dataUrl = `data:${mime};base64,${Buffer.from(object.body).toString("base64")}`;
    const endpoint = `${this.config.baseUrl!.replace(/\/$/, "")}/chat/completions`;
    const started = Date.now();

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: OBSERVATION_INSTRUCTIONS },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Analyze this ${input.kind === "VIDEO" ? "video poster frame" : "photograph"} for filmmaking notes.`,
                },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 45_000),
      });
    } catch (error) {
      throw AppError.providerUnavailable(
        redact(error instanceof Error ? error.message : "Vision host unreachable.", this.config.apiKey),
      );
    }

    const text = await response.text();
    if (!response.ok) {
      throw AppError.analysisFailed(
        `Vision host returned ${response.status}: ${redact(text.slice(0, 180), this.config.apiKey)}`,
      );
    }

    let payload: ChatCompletionResponse;
    try {
      payload = JSON.parse(text) as ChatCompletionResponse;
    } catch {
      throw AppError.invalidAnalysis("Vision host did not return JSON.");
    }

    const observations = extractJsonObject(contentToText(payload.choices?.[0]?.message?.content));
    logger.info("analysis.http_vision_completed", {
      providerKey: this.providerKey,
      assetId: input.assetId,
      durationMs: Date.now() - started,
      usedPreview: object.usedPreview,
    });

    return {
      providerKey: this.providerKey,
      modelId: payload.model ?? this.config.model ?? null,
      modelVersion: null,
      observations,
    };
  }
}
