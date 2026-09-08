import { AppError } from "@/lib/errors";
import { assertNoSmuggledEditorialFields } from "@/server/story/privacy";
import {
  STORY_DOCUMENT_SCHEMA_VERSION,
  storyDocumentSchema,
  type StoryDocument,
} from "@/server/story/schema";

export function validateStoryDocument(raw: unknown): StoryDocument {
  const parsed = storyDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.storyDocumentInvalid("Story document does not match the YouFlicks schema.", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  assertStoryDocumentSchemaVersion(parsed.data);
  assertNoSmuggledEditorialFields(parsed.data);
  assertNoDocumentLevelTiming(raw);
  assertTargetDurationActsOnly(raw);
  assertUniqueNarrativeIds(parsed.data);
  return parsed.data;
}

export function assertStoryDocumentSchemaVersion(document: StoryDocument) {
  if (document.schemaVersion !== STORY_DOCUMENT_SCHEMA_VERSION) {
    throw AppError.storyDocumentInvalid("Unsupported story document schema version.", {
      schemaVersion: document.schemaVersion,
    });
  }
}

function assertNoDocumentLevelTiming(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return;
  }
  const record = raw as Record<string, unknown>;
  if ("targetDurationMs" in record || "startMs" in record || "endMs" in record) {
    throw AppError.storyDocumentInvalid(
      "Story documents must not include document-level editorial timing fields.",
    );
  }
}

function assertTargetDurationActsOnly(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return;
  }
  const acts = (raw as { acts?: unknown }).acts;
  if (!Array.isArray(acts)) {
    return;
  }
  for (const act of acts) {
    if (!act || typeof act !== "object" || Array.isArray(act)) continue;
    const scenes = (act as { scenes?: unknown }).scenes;
    if (!Array.isArray(scenes)) continue;
    for (const scene of scenes) {
      if (!scene || typeof scene !== "object" || Array.isArray(scene)) continue;
      if ("targetDurationMs" in scene || "startMs" in scene || "endMs" in scene) {
        throw AppError.storyDocumentInvalid(
          "targetDurationMs is optional on acts only and must never become editorial timing.",
        );
      }
    }
  }
}

function assertUniqueNarrativeIds(document: StoryDocument) {
  const actIds = new Set<string>();
  for (const act of document.acts) {
    if (actIds.has(act.id)) {
      throw AppError.storyDocumentInvalid("Story acts must have unique ids.");
    }
    actIds.add(act.id);
    const sceneIds = new Set<string>();
    for (const scene of act.scenes) {
      if (sceneIds.has(scene.id)) {
        throw AppError.storyDocumentInvalid("Story scenes must have unique ids within an act.");
      }
      sceneIds.add(scene.id);
    }
  }
}
