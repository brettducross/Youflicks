import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import type { RenderExecutionAttribution } from "@/server/adapters/renderer/attribution";
import { RenderCapability } from "@/server/ports/capabilities";
import type { RendererPort } from "@/server/ports/renderer";
import type { StoragePort } from "@/server/ports/storage";
import type { RenderComposerInput } from "@/server/render/input";
import type { RenderOutputProfile, RenderResultDocument } from "@/server/render/schema";
import { validateRenderResultDocument } from "@/server/render/validate";

/**
 * Deterministic renderer for tests and explicit local development.
 * Not a production renderer. Must never advertise production render availability.
 * Reads clip bytes through StoragePort and writes a placeholder assembly.
 * Attribution is adapter metadata — not part of RendererPort.render.
 */
export class LocalDeterministicRenderer implements RendererPort {
  readonly providerKey = "youflicks.local.renderer";
  readonly production = false as const;
  readonly modelId = "deterministic-render-v1";
  readonly modelVersion = "1.0";

  constructor(private readonly storage: StoragePort) {}

  executionAttribution(): RenderExecutionAttribution {
    return {
      providerKey: this.providerKey,
      capability: RenderCapability.VIDEO_RENDER,
      modelId: this.modelId,
      modelVersion: this.modelVersion,
    };
  }

  async render(input: RenderComposerInput): Promise<RenderResultDocument> {
    const sourceDigests: string[] = [];
    for (const clip of input.manifest.clips) {
      const stored = await this.storage.get(clip.storageKey);
      if (!stored || stored.body.byteLength === 0) {
        throw AppError.renderSourceUnresolved(
          "A clip source could not be read from storage for this render.",
          { clipId: clip.clipId, sourceKind: clip.sourceKind, sourceId: clip.sourceId },
        );
      }
      sourceDigests.push(createHash("sha256").update(stored.body).digest("hex"));
    }

    const header = Buffer.from(
      `YouFlicks local deterministic render\nprofile=${input.outputProfile}\ndurationMs=${input.manifest.totalDurationMs}\n`,
      "utf8",
    );
    const digestBlock = Buffer.from(sourceDigests.join("\n"), "utf8");
    const bytes = Uint8Array.from(Buffer.concat([header, digestBlock]));
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const storageKey = input.destinationKeyHint;
    await this.storage.put({
      key: storageKey,
      body: bytes,
      contentType: "video/mp4",
    });

    const size = profileSize(input.outputProfile);
    return validateRenderResultDocument({
      storageKey,
      mimeType: "video/mp4",
      durationMs: input.manifest.totalDurationMs,
      byteSize: bytes.byteLength,
      checksum,
      width: size.width,
      height: size.height,
    });
  }
}

function profileSize(profile: RenderOutputProfile) {
  switch (profile) {
    case "WEB_720":
      return { width: 1280, height: 720 };
    case "WEB_1080":
    case "MASTER":
      return { width: 1920, height: 1080 };
    default: {
      const exhaustive: never = profile;
      return exhaustive;
    }
  }
}
